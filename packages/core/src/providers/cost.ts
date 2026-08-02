import type { CompletionRequest, CostEstimate, TokenUsage } from "./types";
import type { ModelPricing } from "./pricing";

/** Rough token estimate (~4 characters per token): used when real usage is unavailable. */
export function estimateTokens(req: CompletionRequest): number {
  const chars =
    (req.system?.length ?? 0) + req.messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(chars / 4);
}

/** Computes the USD cost from pricing plus real or estimated usage. */
export function computeCost(
  pricing: ModelPricing,
  req: CompletionRequest,
  usage?: TokenUsage,
): CostEstimate {
  const inputTokens = usage?.inputTokens ?? estimateTokens(req);
  const outputTokens = usage?.outputTokens ?? req.maxTokens ?? 1024;
  const usd =
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok;
  return { usd, inputTokens, outputTokens };
}
