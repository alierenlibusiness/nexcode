import type {
  AIProviderAdapter,
  CompletionRequest,
  CompletionResult,
  CostEstimate,
  TokenUsage,
} from "../types";
import { type CliRunner, spawnRunner, buildTaggedPrompt, CliParseError } from "./runner";

export interface CodexCliAdapterOptions {
  /** CLI binary yolu (varsayılan "codex"). */
  binaryPath?: string;
  runner?: CliRunner;
}

/**
 * Codex CLI adapter'ı: OpenAI abonelik (ChatGPT Plus/Pro) modu, Frontend Agent için
 * (PRD §8.2, §9.2). `codex exec --json` headless çalışır ve JSONL olay akışı üretir;
 * son agent mesajı + usage'ı toleranslı şekilde toplarız.
 *
 * NOT (R3): JSONL şeması Codex sürümleriyle değişebilir. Parse hatasında `CliParseError`
 * fırlatılır; factory bunu yakalayıp agent'ı API moduna geçirir.
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
      throw new Error(`Codex CLI çıkış ${String(result.exitCode)}: ${result.stderr || result.stdout}`);
    }

    return parseCodexJsonl(result.stdout);
  }

  estimateCost(_req: CompletionRequest, usage?: TokenUsage): CostEstimate {
    // CLI abonelik modu: maliyet abonelik havuzuna yazılır, token-bazlı faturaya değil.
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

/** Codex `exec --json` JSONL çıktısını parse eder (saf fonksiyon: sözleşme testiyle sabitlenir). */
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
      continue; // JSON olmayan satırları (log vb.) atla
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
    throw new CliParseError(`Codex CLI JSONL parse edilemedi: ${stdout.slice(0, 200)}`, "openai");
  }

  return { text, usage: { inputTokens, outputTokens }, stopReason: null };
}
