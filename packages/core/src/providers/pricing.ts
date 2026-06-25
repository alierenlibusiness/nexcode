/**
 * Model fiyatlandırması — $/1M token (PRD §9, varsayım değerleri; uygulama anında
 * gerçek liste fiyatıyla doğrulanmalı).
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const ANTHROPIC_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-opus-4-8": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 0.8, outputPerMTok: 4 },
};

export function getAnthropicPricing(modelId: string): ModelPricing {
  return ANTHROPIC_PRICING[modelId] ?? { inputPerMTok: 0, outputPerMTok: 0 };
}
