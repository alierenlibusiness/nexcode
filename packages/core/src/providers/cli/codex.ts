import type {
  AIProviderAdapter,
  CompletionRequest,
  CompletionResult,
  CostEstimate,
  TokenUsage,
} from "../types";
import { type CliRunner, spawnRunner, buildTaggedPrompt, CliParseError } from "./runner";

export interface CodexCliAdapterOptions {
  /** CLI binary path (defaults to "codex"). */
  binaryPath?: string;
  runner?: CliRunner;
}

/**
 * Codex CLI adapter: OpenAI subscription (ChatGPT Plus/Pro) mode, used by the Frontend
 * Agent. `codex exec --json` runs headless and produces a JSONL event stream; the last
 * agent message and the usage figures are collected tolerantly.
 *
 * Note: the JSONL schema can change between Codex versions. A parse failure throws
 * `CliParseError`; the factory catches it and moves the agent into API mode.
 */
export class CodexCliAdapter implements AIProviderAdapter {
  readonly id = "codex";
  readonly connectionMode = "cli" as const;

  private readonly binary: string;
  private readonly runner: CliRunner;

  constructor(options: CodexCliAdapterOptions = {}) {
    this.binary = options.binaryPath ?? "codex";
    this.runner = options.runner ?? spawnRunner;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const args = ["exec", "--json", "--model", req.model];
    const result = await this.runner(this.binary, args, buildTaggedPrompt(req));

    if (result.exitCode !== 0) {
      throw new Error(`Codex CLI exited with ${String(result.exitCode)}: ${result.stderr || result.stdout}`);
    }

    return parseCodexJsonl(result.stdout);
  }

  estimateCost(_req: CompletionRequest, usage?: TokenUsage): CostEstimate {
    // CLI subscription mode: cost is charged to the subscription pool, not a per-token bill.
    return { usd: 0, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }
}

interface CodexEvent {
  type?: string;
  item?: { type?: string; text?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Parses Codex `exec --json` JSONL output (pure function, pinned by a contract test). */
export function parseCodexJsonl(stdout: string): CompletionResult {
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let sawEvent = false;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: CodexEvent;
    try {
      evt = JSON.parse(trimmed) as CodexEvent;
    } catch {
      continue; // Skip non-JSON lines (logs and similar)
    }
    sawEvent = true;
    if (evt.item?.type === "agent_message" && typeof evt.item.text === "string") {
      text = evt.item.text;
    }
    if (evt.usage) {
      inputTokens = evt.usage.input_tokens ?? inputTokens;
      outputTokens = evt.usage.output_tokens ?? outputTokens;
    }
  }

  if (!sawEvent) {
    throw new CliParseError(`Codex CLI JSONL could not be parsed: ${stdout.slice(0, 200)}`, "openai");
  }

  return { text, usage: { inputTokens, outputTokens }, stopReason: null };
}
