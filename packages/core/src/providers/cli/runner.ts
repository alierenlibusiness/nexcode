import { spawn } from "node:child_process";
import type { CompletionRequest } from "../types";

export interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Thrown when CLI output cannot be parsed in the expected format.
 * The factory can catch this and move the agent gracefully into API mode.
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

/** Role-tagged plain text prompt: CLIs take a single prompt string (system plus messages). */
export function buildTaggedPrompt(req: CompletionRequest): string {
  const parts: string[] = [];
  if (req.system) parts.push(`[system]\n${req.system}`);
  for (const message of req.messages) {
    parts.push(`[${message.role}]\n${message.content}`);
  }
  return parts.join("\n\n");
}

/** Runs a CLI child process and collects stdout, stderr and the exit code. */
export type CliRunner = (
  binary: string,
  args: string[],
  input?: string,
) => Promise<CliRunResult>;

/**
 * The real child process runner (child_process).
 * Note: a pty is not required for the headless `--print` mode; if an interactive need
 * comes up later, this runner can be swapped for a node-pty based one.
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
