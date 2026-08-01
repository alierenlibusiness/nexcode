import { spawn } from "node:child_process";
import type { CompletionRequest } from "../types";

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * CLI çıktısı beklenen formatta parse edilemediğinde fırlatılır (PRD §6.3, R3).
 * Factory bunu yakalayıp agent'ı API moduna zarif geçirebilir.
 */
export class CliParseError extends Error {
  constructor(
    message: string,
    readonly provider: string,
  ) {
    super(message);
    this.name = "CliParseError";
  }
}

/** Rol etiketli düz-metin prompt: CLI'lar tek prompt string'i alır (sistem + mesajlar). */
export function buildTaggedPrompt(req: CompletionRequest): string {
  const parts: string[] = [];
  if (req.system) parts.push(`[system]\n${req.system}`);
  for (const message of req.messages) {
    parts.push(`[${message.role}]\n${message.content}`);
  }
  return parts.join("\n\n");
}

/** Bir CLI alt sürecini çalıştırıp stdout/stderr/exit toplar. */
export type CliRunner = (
  binary: string,
  args: string[],
  input?: string,
) => Promise<CliRunResult>;

/**
 * Gerçek alt süreç çalıştırıcısı (child_process).
 * NOT: PRD §5.2/§9.1 node-pty'den bahseder; headless `--print` modu için pty
 * gerekmez, ileride interaktif ihtiyaçta runner node-pty ile değiştirilebilir.
 */
export const spawnRunner: CliRunner = (binary, args, input) =>
  new Promise<CliRunResult>((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
