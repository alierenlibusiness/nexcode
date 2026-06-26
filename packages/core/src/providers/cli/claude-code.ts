import type {
  AIProviderAdapter,
  CompletionRequest,
  CompletionResult,
  CostEstimate,
  TokenUsage,
} from "../types";
import { type CliRunner, spawnRunner, buildTaggedPrompt, CliParseError } from "./runner";

export interface ClaudeCodeAdapterOptions {
  /** CLI binary yolu (varsayılan "claude"). */
  binaryPath?: string;
  /** Test/özelleştirme için enjekte edilebilir çalıştırıcı (varsayılan: gerçek spawn). */
  runner?: CliRunner;
}

interface ClaudeCliJson {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Claude Code CLI adapter'ı — abonelik (CLI) modu (PRD §6.3, §9.1).
 * `claude -p --output-format json` ile headless çalışır; prompt stdin'den verilir.
 * Maliyet abonelik havuzundan tüketilir (per-token API faturası değil) — `estimateCost`
 * öngörülen abonelik maliyetini 0 döner, gerçek maliyet CLI çıktısındaki cost ile gelir.
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
        `Claude Code CLI çıkış ${String(result.exitCode)}: ${result.stderr || result.stdout}`,
      );
    }

    let parsed: ClaudeCliJson;
    try {
      parsed = JSON.parse(result.stdout) as ClaudeCliJson;
    } catch {
      throw new CliParseError(
        `Claude Code CLI çıktısı parse edilemedi: ${result.stdout.slice(0, 200)}`,
        "anthropic",
      );
    }

    if (parsed.is_error) {
      throw new Error(`Claude Code CLI hata döndürdü: ${parsed.result ?? "bilinmeyen"}`);
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
    // CLI abonelik modu: maliyet token-bazlı faturaya değil, abonelik havuzuna yazılır.
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
