import type {
  AIProviderAdapter,
  CompletionRequest,
  CompletionResult,
  CostEstimate,
  TokenUsage,
} from "../types";
import { type CliRunner, spawnRunner, buildTaggedPrompt } from "./runner";

export interface AntigravityCliAdapterOptions {
  /** CLI binary yolu (varsayılan "antigravity"). Eski Gemini CLI ile uyumlu. */
  binaryPath?: string;
  runner?: CliRunner;
}

/**
 * Antigravity CLI adapter'ı: Google abonelik/ücretsiz katman modu, DevOps Agent için
 * (PRD §8.6, §9.2). Google, Gemini CLI'ı Antigravity'ye geçiriyor (tarih varsayım).
 * `--output-format json` zarfı varsa parse eder; yoksa düz stdout'u sonuç sayar (toleranslı).
 */
export class AntigravityCliAdapter implements AIProviderAdapter {
  readonly id = "antigravity";
  readonly connectionMode = "cli" as const;

  private readonly binary: string;
  private readonly runner: CliRunner;

  constructor(options: AntigravityCliAdapterOptions = {}) {
    this.binary = options.binaryPath ?? "antigravity";
    this.runner = options.runner ?? spawnRunner;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const args = ["--output-format", "json", "--model", req.model, "--prompt", buildTaggedPrompt(req)];
    const result = await this.runner(this.binary, args);

    if (result.exitCode !== 0) {
      throw new Error(
        `Antigravity CLI çıkış ${String(result.exitCode)}: ${result.stderr || result.stdout}`,
      );
    }

    return parseAntigravityOutput(result.stdout);
  }

  estimateCost(_req: CompletionRequest, usage?: TokenUsage): CostEstimate {
    return { usd: 0, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }
}

interface AntigravityJson {
  response?: string;
  stats?: { tokens?: { input?: number; output?: number } };
}

/** JSON zarfını ({response, stats}) parse eder; JSON değilse ham metni sonuç sayar (saf fonksiyon). */
export function parseAntigravityOutput(stdout: string): CompletionResult {
  const trimmed = stdout.trim();
  try {
    const json = JSON.parse(trimmed) as AntigravityJson;
    if (typeof json.response === "string") {
      return {
        text: json.response,
        usage: {
          inputTokens: json.stats?.tokens?.input ?? 0,
          outputTokens: json.stats?.tokens?.output ?? 0,
        },
        stopReason: null,
      };
    }
  } catch {
    // JSON değil: düz metin moduna düş.
  }
  return { text: trimmed, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: null };
}
