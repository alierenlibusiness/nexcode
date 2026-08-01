import type {
  AIProviderAdapter,
  CompletionRequest,
  CompletionResult,
  CostEstimate,
  TokenUsage,
} from "./types";
import { getPricing } from "./pricing";
import { getProvider } from "./registry";
import { computeCost } from "./cost";

/**
 * OpenAI-uyumlu Chat Completions API adapter'ı. OpenAI'nin yanı sıra DeepSeek ve
 * MiniMax aynı sözleşmeyi (`/chat/completions`) sunduğu için tek adapter üçünü de
 * karşılar: yalnızca `id`, `baseUrl` ve pricing tablosu (provider üzerinden) değişir
 * (PRD §6.3 provider-agnostic gateway, §8.2/8.5).
 */
export interface OpenAICompatibleOptions {
  /** Pricing/log için sağlayıcı kimliği: "openai" | "deepseek" | "minimax". */
  provider: string;
  apiKey: string;
  baseUrl: string;
  /** Görsel (multimodal) destekliyor mu (OpenAI GPT-5.x: evet; DeepSeek/MiniMax: hayır). */
  vision?: boolean;
  fetchFn?: typeof fetch;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string | null }; finish_reason: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** Sağlayıcı için OpenAI-uyumlu base URL (registry'den; bilinmiyorsa OpenAI). */
export function defaultBaseUrl(provider: string): string {
  return getProvider(provider)?.baseUrl ?? "https://api.openai.com/v1";
}

export class OpenAICompatibleAdapter implements AIProviderAdapter {
  readonly id: string;
  readonly connectionMode = "api" as const;

  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.id = options.provider;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const messages = [
      ...(req.system === undefined ? [] : [{ role: "system" as const, content: req.system }]),
      ...req.messages.map((m) => {
        if (m.images && this.supportsVision() && m.images.length > 0) {
          return {
            role: m.role,
            content: [
              { type: "text", text: m.content },
              ...m.images.map((img) => ({
                type: "image_url" as const,
                image_url: {
                  url: `data:${img.mimeType};base64,${img.data}`,
                },
              })),
            ],
          };
        }
        return { role: m.role, content: m.content };
      }),
    ];

    const res = await this.fetchFn(`${this.options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages,
        max_tokens: req.maxTokens ?? 1024,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${this.id} API ${String(res.status)}: ${body}`);
    }

    const json = (await res.json()) as ChatCompletionResponse;
    const choice = json.choices[0];
    const text = choice?.message.content ?? "";

    return {
      text,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      stopReason: choice?.finish_reason ?? null,
    };
  }

  estimateCost(req: CompletionRequest, usage?: TokenUsage): CostEstimate {
    return computeCost(getPricing(this.options.provider, req.model), req, usage);
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return this.options.vision ?? false;
  }
}
