import type {
  AIProviderAdapter,
  CompletionRequest,
  CompletionResult,
  CostEstimate,
  TokenUsage,
} from "../types";
import { type CliRunner, spawnRunner, buildTaggedPrompt } from "./runner";

export interface AntigravityCliAdapterOptions {
  /** CLI binary path (defaults to "antigravity"). Compatible with the older Gemini CLI. */
  binaryPath?: string;
  runner?: CliRunner;
}

/**
 * Antigravity CLI adapter: Google subscription and free tier mode, used by the DevOps
 * Agent. Google is migrating the Gemini CLI to Antigravity.
 * Parses the `--output-format json` envelope when present; otherwise it tolerantly treats
 * plain stdout as the result.
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
        `Antigravity CLI exited with ${String(result.exitCode)}: ${result.stderr || result.stdout}`,
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

/** Parses the JSON envelope ({response, stats}); falls back to the raw text when it is not JSON (pure function). */
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
    // Not JSON: fall back to plain text mode.
  }
  return { text: trimmed, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: null };
}
