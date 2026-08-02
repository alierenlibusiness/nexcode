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
  /** Fetches the provider API key from the OS keychain (null when absent). */
  getApiKey: (provider: string) => string | null;
  /** Whether the CLI subscription quota is available. Defaults to available. */
  isCliQuotaAvailable?: (provider: string) => boolean;
  cliRunner?: CliRunner;
  fetchFn?: typeof fetch;
}

/**
 * Builds the right adapter (API or CLI) from an agent's `ModelRef` and the user's
 * `ConnectionPreference`: the single point where the "API when we want, CLI when we want"
 * decision is applied.
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
        // When the provider has no CLI (DeepSeek, MiniMax) fall straight through to the API.
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
    if (!info) throw new Error(`Unknown provider: ${provider} (not in the registry)`);
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
        `'${model.provider}' has no subscription CLI: switch this agent to API mode.`,
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
      throw new Error(`No ${provider} API key found in the OS keychain. Add one from settings.`);
    }
    return apiKey;
  }
}
