import type { ModelRef } from "../domain/agent";
import type { AIProviderAdapter } from "./types";
import type { ConnectionPreference } from "./connection";
import { AnthropicAdapter } from "./anthropic";
import { ClaudeCodeAdapter } from "./cli/claude-code";
import type { CliRunner } from "./cli/runner";

export interface AdapterFactoryDeps {
  /** Sağlayıcı API anahtarını OS keychain'den getirir (yoksa null). */
  getApiKey: (provider: string) => string | null;
  /** CLI abonelik kotasının uygun olup olmadığı (PRD §9.4). Varsayılan: uygun. */
  isCliQuotaAvailable?: (provider: string) => boolean;
  cliRunner?: CliRunner;
  fetchFn?: typeof fetch;
}

/**
 * Bir agent'ın `ModelRef`'i ve kullanıcının `ConnectionPreference`'ına göre
 * doğru adapter'ı (API ya da CLI) üretir — "istersek API, istersek CLI" mantığının
 * uygulandığı tek nokta (PRD §9.3-§9.5).
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
        const quotaOk = this.deps.isCliQuotaAvailable?.(model.provider) ?? true;
        return quotaOk ? this.buildCli(model) : this.buildApi(model);
      }
    }
  }

  private buildApi(model: ModelRef): AIProviderAdapter {
    if (model.provider !== "anthropic") {
      throw new Error(`Faz 1 API modu yalnızca anthropic destekler (gelen: ${model.provider})`);
    }
    const apiKey = this.deps.getApiKey("anthropic");
    if (!apiKey) {
      throw new Error("Anthropic API anahtarı bulunamadı (OS keychain). Ayarlardan ekleyin.");
    }
    return new AnthropicAdapter({
      apiKey,
      ...(this.deps.fetchFn ? { fetchFn: this.deps.fetchFn } : {}),
    });
  }

  private buildCli(_model: ModelRef): AIProviderAdapter {
    return new ClaudeCodeAdapter({
      ...(this.deps.cliRunner ? { runner: this.deps.cliRunner } : {}),
    });
  }
}
