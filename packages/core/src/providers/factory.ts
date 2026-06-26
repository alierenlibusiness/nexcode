import type { ModelRef } from "../domain/agent";
import type { AIProviderAdapter } from "./types";
import type { ConnectionPreference } from "./connection";
import { AnthropicAdapter } from "./anthropic";
import { OpenAICompatibleAdapter, defaultBaseUrl } from "./openai-compatible";
import { GoogleAdapter } from "./google";
import { ClaudeCodeAdapter } from "./cli/claude-code";
import { CodexCliAdapter } from "./cli/codex";
import { AntigravityCliAdapter } from "./cli/antigravity";
import type { CliRunner } from "./cli/runner";
import { getProvider, providerCliKind, supportsVision } from "./registry";

export interface AdapterFactoryDeps {
  /** Sağlayıcı API anahtarını OS keychain'den getirir (yoksa null). */
  getApiKey: (provider: string) => string | null;
  /** CLI abonelik kotasının uygun olup olmadığı (PRD §9.4). Varsayılan: uygun. */
  isCliQuotaAvailable?: (provider: string) => boolean;
  cliRunner?: CliRunner;
  fetchFn?: typeof fetch;
}

/**
 * Bir agent'ın `ModelRef`'i ve kullanıcının `ConnectionPreference`'ına göre doğru
 * adapter'ı (API ya da CLI) üretir — "istersek API, istersek CLI" mantığının uygulandığı
 * tek nokta (PRD §6.3 provider-agnostic gateway, §9.3-§9.5).
 */
export class AdapterFactory {
  constructor(private readonly deps: AdapterFactoryDeps) {}

  resolve(model: ModelRef, preference: ConnectionPreference): AIProviderAdapter {
    switch (preference) {
      case "api_only":
        return this.buildApi(model);
      case "cli_only":
        return this.buildCli(model);
      case "cli_first": {
        // Sağlayıcının CLI'sı yoksa (DeepSeek/MiniMax) doğrudan API'ye düş.
        if (!this.hasCli(model.provider)) return this.buildApi(model);
        const quotaOk = this.deps.isCliQuotaAvailable?.(model.provider) ?? true;
        return quotaOk ? this.buildCli(model) : this.buildApi(model);
      }
    }
  }

  hasCli(provider: string): boolean {
    return providerCliKind(provider) !== undefined;
  }

  private buildApi(model: ModelRef): AIProviderAdapter {
    const provider = model.provider;
    const info = getProvider(provider);
    if (!info) throw new Error(`Bilinmeyen sağlayıcı: ${provider} (registry'de yok)`);
    const fetchOpt = this.deps.fetchFn ? { fetchFn: this.deps.fetchFn } : {};

    switch (info.kind) {
      case "anthropic":
        return new AnthropicAdapter({ apiKey: this.requireKey(provider), ...fetchOpt });
      case "google":
        return new GoogleAdapter({ apiKey: this.requireKey(provider), ...fetchOpt });
      case "openai-compatible":
        return new OpenAICompatibleAdapter({
          provider,
          apiKey: this.requireKey(provider),
          baseUrl: defaultBaseUrl(provider),
          vision: supportsVision(provider, model.modelId),
          ...fetchOpt,
        });
    }
  }

  private buildCli(model: ModelRef): AIProviderAdapter {
    const kind = providerCliKind(model.provider);
    if (!kind) {
      throw new Error(
        `'${model.provider}' için abonelik CLI'sı yok — bu agent'ı API moduna alın (PRD §9.2).`,
      );
    }
    const runnerOpt = this.deps.cliRunner ? { runner: this.deps.cliRunner } : {};
    switch (kind) {
      case "claude-code":
        return new ClaudeCodeAdapter(runnerOpt);
      case "codex":
        return new CodexCliAdapter(runnerOpt);
      case "antigravity":
        return new AntigravityCliAdapter(runnerOpt);
    }
  }

  private requireKey(provider: string): string {
    const apiKey = this.deps.getApiKey(provider);
    if (!apiKey) {
      throw new Error(`${provider} API anahtarı bulunamadı (OS keychain). Ayarlardan ekleyin.`);
    }
    return apiKey;
  }
}
