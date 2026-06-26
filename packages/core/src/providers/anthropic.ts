import type {
  AIProviderAdapter,
  CompletionRequest,
  CompletionResult,
  CostEstimate,
  TokenUsage,
} from "./types";
import { getPricing } from "./pricing";
import { computeCost } from "./cost";

export interface AnthropicAdapterOptions {
  apiKey: string;
  /** Test/özelleştirme için enjekte edilebilir fetch (varsayılan: global fetch). */
  fetchFn?: typeof fetch;
  baseUrl?: string;
  anthropicVersion?: string;
}

interface AnthropicResponseBody {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

/** Anthropic Messages API adapter'ı (API anahtarı modu, PRD §5.6, §8.1/8.3). */
export class AnthropicAdapter implements AIProviderAdapter {
  readonly id = "anthropic";
  readonly connectionMode = "api" as const;

  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly anthropicVersion: string;

  constructor(private readonly options: AnthropicAdapterOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.anthropicVersion = options.anthropicVersion ?? "2023-06-01";
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.options.apiKey,
        "anthropic-version": this.anthropicVersion,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        ...(req.system === undefined ? {} : { system: req.system }),
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        messages: req.messages.map((m) => {
          if (m.images && this.supportsVision() && m.images.length > 0) {
            return {
              role: m.role,
              content: [
                { type: "text", text: m.content },
                ...m.images.map((img) => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: img.mimeType,
                    data: img.data,
                  },
                })),
              ],
            };
          }
          return { role: m.role, content: m.content };
        }),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API ${String(res.status)}: ${body}`);
    }

    const json = (await res.json()) as AnthropicResponseBody;
    const text = json.content
      .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
      .join("");

    return {
      text,
      usage: {
        inputTokens: json.usage.input_tokens,
        outputTokens: json.usage.output_tokens,
      },
      stopReason: json.stop_reason,
    };
  }

  estimateCost(req: CompletionRequest, usage?: TokenUsage): CostEstimate {
    return computeCost(getPricing("anthropic", req.model), req, usage);
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }
}
