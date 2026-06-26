import type { CompletionRequest, CostEstimate, TokenUsage } from "./types";
import type { ModelPricing } from "./pricing";

/** Rough token tahmini (~4 karakter/token) — gerçek usage yoksa kullanılır. */
export function estimateTokens(req: CompletionRequest): number {
  const chars =
    (req.system?.length ?? 0) + req.messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(chars / 4);
}

/** Pricing + (gerçek ya da tahmini) usage'dan USD maliyeti hesaplar. */
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
