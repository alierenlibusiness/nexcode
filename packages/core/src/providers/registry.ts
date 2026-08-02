import type { ConnectionMode } from "../domain/agent";
import type { ModelPricing } from "./pricing";

/**
 * Provider and model registry: the SINGLE source of truth for provider independence.
 * Adding a new AI means adding a record here (data, not code). The user picks a model per
 * agent from this list, and the UI enumerates this registry.
 *
 * To add a new OpenAI-compatible provider (Kimi, GLM, Qwen, Cohere…): give `kind:
 * "openai-compatible"`, a `baseUrl` and `models`; the adapter is the existing
 * OpenAICompatibleAdapter.
 */
export type ProviderKind = "anthropic" | "openai-compatible" | "google";

/** The subscription CLI of a provider, when it has one. */
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
  /** API base URL for openai-compatible and google. */
  baseUrl?: string;
  /** The kind of subscription CLI, when there is one (otherwise API only). */
  cli?: CliKind;
  /** Whether this provider has vision (multimodal) capability; can be overridden per model. */
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
  // ── Extensibility example: additional OpenAI-compatible providers ──
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

/** For the UI: every provider, in a stable order. */
export function listProviders(): readonly ProviderInfo[] {
  return Object.values(PROVIDER_REGISTRY);
}

/** Whether a provider has a subscription CLI. */
export function providerCliKind(provider: string): CliKind | undefined {
  return PROVIDER_REGISTRY[provider]?.cli;
}

/** Vision support of a model and provider combination (model override > provider default). */
export function supportsVision(provider: string, modelId: string): boolean {
  const info = PROVIDER_REGISTRY[provider];
  if (!info) return false;
  const model = info.models.find((m) => m.modelId === modelId);
  return model?.vision ?? info.vision ?? false;
}

/** Whether a ModelRef is valid in the registry. */
export function isKnownModel(provider: string, modelId: string): boolean {
  return getModelInfo(provider, modelId) !== undefined;
}

/** Shorthand for building a ModelRef (the default connection mode is API). */
export function modelRef(
  provider: string,
  modelId: string,
  connectionMode: ConnectionMode = "api",
): { provider: string; modelId: string; connectionMode: ConnectionMode } {
  return { provider, modelId, connectionMode };
}
