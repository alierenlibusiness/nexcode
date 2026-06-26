import type {
  AIProviderAdapter,
  CompletionRequest,
  CompletionResult,
  CostEstimate,
  TokenUsage,
} from "./types";
import { getPricing } from "./pricing";
import { computeCost } from "./cost";

/**
 * Google Gemini (`generateContent`) API adapter'ı — DevOps Agent için (PRD §8.6).
 * Not: Google, Gemini CLI'ı Antigravity CLI'a geçiriyor; CLI tarafı ayrı adapter'da
 * (`cli/antigravity`). Bu adapter API anahtarı modudur (ücretsiz katman da bu yol).
 */
export interface GoogleAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GoogleAdapter implements AIProviderAdapter {
  readonly id = "google";
  readonly connectionMode = "api" as const;

  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: GoogleAdapterOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const contents = req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 1024,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      },
    };
    if (req.system !== undefined) {
      body["systemInstruction"] = { parts: [{ text: req.system }] };
    }

    const url = `${this.baseUrl}/models/${req.model}:generateContent?key=${this.options.apiKey}`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Gemini API ${String(res.status)}: ${errText}`);
    }

    const json = (await res.json()) as GeminiResponse;
    const candidate = json.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");

    return {
      text,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
      stopReason: candidate?.finishReason ?? null,
    };
  }

  estimateCost(req: CompletionRequest, usage?: TokenUsage): CostEstimate {
    return computeCost(getPricing("google", req.model), req, usage);
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }
}
