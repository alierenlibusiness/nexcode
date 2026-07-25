import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliAdapter } from "../../config/schema";
import { classifyFailure } from "../../engine/recovery";
import { effectiveInvocation, materializePrompt, specFor } from "./adapters";
import { logger } from "../../logger";

/**
 * CLI sağlık kontrolü.
 *
 * İki değişmez:
 * 1. Sağlık kontrolü, normal çalışma ile **aynı** argüman ve prompt materyalizasyonunu
 *    kullanır. Aksi halde `{PROMPT_FILE}` gibi yer tutucular literal olarak geçer ve
 *    sağlıklı bir CLI yanlışlıkla `failed` sayılıp katalogdan düşer.
 * 2. Geçici prompt dosyası **her çıkış yolunda** (başarı, hata, timeout) silinir.
 *
 * Önbellek sürümlüdür: yürütme sözleşmesi değiştiğinde `HEALTH_CONTRACT_VERSION` artırılır
 * ve eski kayıtlar startup'ta geçersizleşir — kullanıcının elle cache temizlemesi gerekmez.
 */

export const HEALTH_CONTRACT_VERSION = 1;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PROBE_PROMPT = "Reply with the single word: OK";
const PROBE_TIMEOUT_MS = 45_000;

export type HealthStatus = "ready" | "auth" | "model" | "timeout" | "failed";

export interface HealthResult {
  status: HealthStatus;
  checkedAt: string;
  contractVersion: number;
  detail: string;
}

export function isHealthy(result: HealthResult | undefined): boolean {
  return result?.status === "ready";
}

/** Sürümlü ve TTL'li sağlık önbelleği. */
export class HealthCache {
  private readonly entries = new Map<string, HealthResult>();

  constructor(initial: Readonly<Record<string, HealthResult>> = {}) {
    for (const [id, result] of Object.entries(initial)) {
      // Eski sözleşme sürümünden gelen kayıtlar hiç yüklenmez.
      if (result.contractVersion === HEALTH_CONTRACT_VERSION) this.entries.set(id, result);
    }
  }

  get(agentId: string, now: Date = new Date()): HealthResult | undefined {
    const entry = this.entries.get(agentId);
    if (entry === undefined) return undefined;
    if (now.getTime() - Date.parse(entry.checkedAt) > CACHE_TTL_MS) {
      this.entries.delete(agentId);
      return undefined;
    }
    return entry;
  }

  set(agentId: string, result: HealthResult): void {
    this.entries.set(agentId, result);
  }

  invalidate(agentId?: string): void {
    if (agentId === undefined) this.entries.clear();
    else this.entries.delete(agentId);
  }

  snapshot(): Record<string, HealthResult> {
    return Object.fromEntries(this.entries);
  }

  /** Motorun `buildCatalog` girdisi için `{ agentId: healthy }` haritası. */
  healthMap(now: Date = new Date()): Record<string, boolean> {
    const map: Record<string, boolean> = {};
    for (const id of this.entries.keys()) {
      const entry = this.get(id, now);
      if (entry !== undefined) map[id] = entry.status === "ready";
    }
    return map;
  }
}

export interface ProbeInput {
  adapter: CliAdapter | undefined;
  command: string;
  profileArgs: readonly string[];
  agentModel: string;
  globalModel: string;
  cwd?: string;
}

/** Bir CLI'ı gerçek çalışma yoluyla dener ve sonucu sınıflandırır. */
export async function probeCli(input: ProbeInput, now: () => Date = () => new Date()): Promise<HealthResult> {
  const spec = specFor(input.adapter);
  const invocation = effectiveInvocation({
    adapter: input.adapter,
    profileArgs: input.profileArgs,
    agentModel: input.agentModel,
    globalModel: input.globalModel,
  });

  let tempDir: string | null = null;
  let promptFile: string | null = null;

  try {
    if (invocation.promptMode === "file") {
      tempDir = mkdtempSync(join(tmpdir(), "nexcode-health-"));
      promptFile = join(tempDir, "prompt.md");
      writeFileSync(promptFile, PROBE_PROMPT, "utf8");
    }

    const args = materializePrompt(invocation.args, PROBE_PROMPT, promptFile);
    const outcome = await runProbe(input.command, args, {
      cwd: input.cwd,
      env: { ...process.env, ...invocation.env },
      stdin: invocation.promptMode === "stdin" ? PROBE_PROMPT : null,
    });

    const checkedAt = now().toISOString();
    if (outcome.timedOut) {
      return { status: "timeout", checkedAt, contractVersion: HEALTH_CONTRACT_VERSION, detail: "Yanıt süresi aşıldı." };
    }
    if (outcome.exitCode === 0) {
      return {
        status: "ready",
        checkedAt,
        contractVersion: HEALTH_CONTRACT_VERSION,
        detail: spec?.label ?? "CLI hazır",
      };
    }

    const failure = classifyFailure({ message: outcome.stdout, stderr: outcome.stderr, exitCode: outcome.exitCode });
    const status: HealthStatus = failure === "auth" ? "auth" : failure === "model" ? "model" : "failed";
    return {
      status,
      checkedAt,
      contractVersion: HEALTH_CONTRACT_VERSION,
      detail: (outcome.stderr || outcome.stdout).trim().slice(0, 300),
    };
  } catch (error) {
    logger.warn("cli.health.error", { adapter: input.adapter ?? "custom", error: String(error) });
    return {
      status: "failed",
      checkedAt: now().toISOString(),
      contractVersion: HEALTH_CONTRACT_VERSION,
      detail: String(error).slice(0, 300),
    };
  } finally {
    // Geçici prompt dosyası her çıkış yolunda temizlenir.
    if (tempDir !== null) rmSync(tempDir, { recursive: true, force: true });
  }
}

interface ProbeOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProbe(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; stdin: string | null },
): Promise<ProbeOutcome> {
  return new Promise<ProbeOutcome>((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ exitCode: -1, stdout, stderr, timedOut: true });
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: `${stderr}${String(error)}`, timedOut: false });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 0, stdout, stderr, timedOut: false });
    });

    if (options.stdin !== null) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    }
  });
}
