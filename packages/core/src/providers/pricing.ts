import { getModelInfo } from "./registry";

/**
 * Model fiyatlandırması: $/1M token. TEK kaynak `registry.ts`'dir; bu modül yalnızca
 * fiyata erişim için ince bir yardımcıdır (PRD §9). Varsayım değerleri uygulama anında
 * gerçek liste fiyatıyla doğrulanmalı.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

const ZERO_PRICING: ModelPricing = { inputPerMTok: 0, outputPerMTok: 0 };

/** Sağlayıcı + model için fiyat (bilinmiyorsa sıfır: maliyet 0 raporlanır, hata fırlatmaz). */
export function getPricing(provider: string, modelId: string): ModelPricing {
  return getModelInfo(provider, modelId)?.pricing ?? ZERO_PRICING;
}

/** Geriye dönük uyumluluk (Faz 1 çağrıları). */
export function getAnthropicPricing(modelId: string): ModelPricing {
  return getPricing("anthropic", modelId);
}
