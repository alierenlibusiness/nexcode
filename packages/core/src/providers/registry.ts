import type { ConnectionMode } from "../domain/agent";
import type { ModelPricing } from "./pricing";

/**
 * Sağlayıcı/model kayıt defteri — TEK kaynak (PRD §5 sağlayıcı bağımsızlığı, §9.2).
 * Yeni bir AI eklemek = buraya bir kayıt eklemek (kod değil, veri). Kullanıcı her agent
 * için bu listeden model seçer; UI bu registry'yi numaralandırır.
 *
 * Yeni OpenAI-uyumlu sağlayıcı (Kimi, GLM, Qwen, Cohere…) eklemek için: `kind:
 * "openai-compatible"`, `baseUrl` ve `models` ver — adapter mevcut OpenAICompatibleAdapter'dır.
 */
export type ProviderKind = "anthropic" | "openai-compatible" | "google";

/** Bir sağlayıcının abonelik CLI'sı (varsa) — PRD §9.2. */
export type CliKind = "claude-code" | "codex" | "antigravity";

export interface ProviderModel {
  modelId: string;
  label: string;
  pricing: ModelPricing;
  vision?: boolean;
}

export interface ProviderInfo {
  id: string;
  label: string;
  kind: ProviderKind;
  /** openai-compatible & google için API base URL. */
  baseUrl?: string;
  /** Abonelik CLI'sı varsa türü (yoksa yalnızca API). */
  cli?: CliKind;
  /** Bu sağlayıcının görsel (multimodal) yeteneği var mı (model-bazlı override edilebilir). */
  vision?: boolean;
  models: readonly ProviderModel[];
}

export const PROVIDER_REGISTRY: Readonly<Record<string, ProviderInfo>> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    cli: "claude-code",
    vision: true,
    models: [
      { modelId: "claude-opus-4-8", label: "Claude Opus 4.8", pricing: { inputPerMTok: 15, outputPerMTok: 75 } },
      { modelId: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", pricing: { inputPerMTok: 3, outputPerMTok: 15 } },
      { modelId: "claude-haiku-4-5", label: "Claude Haiku 4.5", pricing: { inputPerMTok: 0.8, outputPerMTok: 4 } },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI (GPT)",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    cli: "codex",
    vision: true,
    models: [
      { modelId: "gpt-5.5", label: "GPT-5.5", pricing: { inputPerMTok: 5, outputPerMTok: 15 }, vision: true },
      { modelId: "gpt-5.3-codex", label: "GPT-5.3 Codex", pricing: { inputPerMTok: 2.5, outputPerMTok: 10 } },
    ],
  },
  google: {
    id: "google",
    label: "Google (Gemini)",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    cli: "antigravity",
    vision: true,
    models: [
      { modelId: "gemini-3.5-flash", label: "Gemini 3.5 Flash", pricing: { inputPerMTok: 0.3, outputPerMTok: 2.5 } },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { modelId: "deepseek-v4-flash", label: "DeepSeek V4 Flash", pricing: { inputPerMTok: 0.14, outputPerMTok: 0.28 } },
    ],
  },
  minimax: {
    id: "minimax",
    label: "MiniMax",
    kind: "openai-compatible",
    baseUrl: "https://api.minimax.io/v1",
    models: [
      { modelId: "minimax-m3", label: "MiniMax M3", pricing: { inputPerMTok: 0.3, outputPerMTok: 1.2 } },
    ],
  },
  // ── Genişletilebilirlik örneği: yeni OpenAI-uyumlu sağlayıcılar (kullanıcı isteği) ──
  kimi: {
    id: "kimi",
    label: "Kimi (Moonshot)",
    kind: "openai-compatible",
    baseUrl: "https://api.moonshot.ai/v1",
    models: [
      { modelId: "kimi-k2", label: "Kimi K2", pricing: { inputPerMTok: 0.6, outputPerMTok: 2.5 } },
    ],
  },
  glm: {
    id: "glm",
    label: "GLM (Zhipu)",
    kind: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { modelId: "glm-4.6", label: "GLM-4.6", pricing: { inputPerMTok: 0.6, outputPerMTok: 2.2 } },
      { modelId: "glm-4.5-air", label: "GLM-4.5 Air", pricing: { inputPerMTok: 0.2, outputPerMTok: 1.1 } },
    ],
  },
};

export function getProvider(provider: string): ProviderInfo | undefined {
  return PROVIDER_REGISTRY[provider];
}

export function getModelInfo(provider: string, modelId: string): ProviderModel | undefined {
  return PROVIDER_REGISTRY[provider]?.models.find((m) => m.modelId === modelId);
}

/** UI için: tüm sağlayıcılar (kararlı sırada). */
export function listProviders(): readonly ProviderInfo[] {
  return Object.values(PROVIDER_REGISTRY);
}

/** Bir sağlayıcının abonelik CLI'sı var mı (PRD §9.2). */
export function providerCliKind(provider: string): CliKind | undefined {
  return PROVIDER_REGISTRY[provider]?.cli;
}

/** Bir model+sağlayıcı kombosunun görsel desteği (model override > sağlayıcı varsayılanı). */
export function supportsVision(provider: string, modelId: string): boolean {
  const info = PROVIDER_REGISTRY[provider];
  if (!info) return false;
  const model = info.models.find((m) => m.modelId === modelId);
  return model?.vision ?? info.vision ?? false;
}

/** Bir ModelRef'in registry'de geçerli olup olmadığı. */
export function isKnownModel(provider: string, modelId: string): boolean {
  return getModelInfo(provider, modelId) !== undefined;
}

/** Faz 1/2 ModelRef üretimi için kısayol (varsayılan bağlantı modu API). */
export function modelRef(
  provider: string,
  modelId: string,
  connectionMode: ConnectionMode = "api",
): { provider: string; modelId: string; connectionMode: ConnectionMode } {
  return { provider, modelId, connectionMode };
}
