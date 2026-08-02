import { getModelInfo } from "./registry";

/**
 * Model pricing in $/1M tokens. The SINGLE source of truth is `registry.ts`; this module
 * is only a thin helper for reading a price. The assumed values should be checked against
 * the real list price at the time of use.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

const ZERO_PRICING: ModelPricing = { inputPerMTok: 0, outputPerMTok: 0 };

/** Price for a provider and model (zero when unknown: cost is reported as 0, never thrown). */
export function getPricing(provider: string, modelId: string): ModelPricing {
  return getModelInfo(provider, modelId)?.pricing ?? ZERO_PRICING;
}

/** Backwards compatibility for earlier call sites. */
export function getAnthropicPricing(modelId: string): ModelPricing {
  return getPricing("anthropic", modelId);
}
