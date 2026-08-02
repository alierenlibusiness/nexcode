import type {
  AIProviderAdapter,
  CompletionRequest,
  CompletionResult,
  CostEstimate,
  TokenUsage,
} from "../types";
import { type CliRunner, spawnRunner, buildTaggedPrompt, CliParseError } from "./runner";

export interface ClaudeCodeAdapterOptions {
  /** CLI binary path (defaults to "claude"). */
  binaryPath?: string;
  /** Injectable runner for tests and customisation (defaults to a real spawn). */
  runner?: CliRunner;
}

interface ClaudeCliJson {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Claude Code CLI adapter: subscription (CLI) mode.
 * Runs headless through `claude -p --output-format json`; the prompt is passed on stdin.
 * Cost is drawn from the subscription pool rather than a per-token API bill, so
 * `estimateCost` returns 0 and the real cost arrives with the cost field in the CLI output.
 */
export class ClaudeCodeAdapter implements AIProviderAdapter {
  readonly id = "claude-code";
  readonly connectionMode = "cli" as const;

  private readonly binary: string;
  private readonly runner: CliRunner;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.binary = options.binaryPath ?? "claude";
    this.runner = options.runner ?? spawnRunner;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const args = ["-p", "--output-format", "json", "--model", req.model];
    const result = await this.runner(this.binary, args, buildTaggedPrompt(req));

    if (result.exitCode !== 0) {
      throw new Error(
        `Claude Code CLI exited with ${String(result.exitCode)}: ${result.stderr || result.stdout}`,
      );
    }

    let parsed: ClaudeCliJson;
    try {
      parsed = JSON.parse(result.stdout) as ClaudeCliJson;
    } catch {
      throw new CliParseError(
        `Claude Code CLI output could not be parsed: ${result.stdout.slice(0, 200)}`,
        "anthropic",
      );
    }

    if (parsed.is_error) {
      throw new Error(`Claude Code CLI returned an error: ${parsed.result ?? "unknown"}`);
    }

    return {
      text: parsed.result ?? "",
      usage: {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
      },
      stopReason: null,
    };
  }

  estimateCost(_req: CompletionRequest, usage?: TokenUsage): CostEstimate {
    // CLI subscription mode: cost is charged to the subscription pool, not a per-token bill.
    return {
      usd: 0,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    };
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }
}
