import { describe, it, expect } from "vitest";
import { AdapterFactory } from "./factory";
import type { ModelRef } from "../domain/agent";

const model: ModelRef = {
  provider: "anthropic",
  modelId: "claude-opus-4-8",
  connectionMode: "api",
};

function factory(opts: {
  apiKey?: string | null;
  quota?: boolean;
}) {
  return new AdapterFactory({
    getApiKey: () => opts.apiKey ?? null,
    ...(opts.quota === undefined ? {} : { isCliQuotaAvailable: () => opts.quota! }),
  });
}

describe("AdapterFactory: API and CLI selection", () => {
  it("api_only resolves to the Anthropic API adapter", () => {
    const adapter = factory({ apiKey: "sk-1" }).resolve(model, "api_only");
    expect(adapter.id).toBe("anthropic");
    expect(adapter.connectionMode).toBe("api");
  });

  it("cli_only resolves to the Claude Code CLI adapter", () => {
    const adapter = factory({}).resolve(model, "cli_only");
    expect(adapter.id).toBe("claude-code");
    expect(adapter.connectionMode).toBe("cli");
  });

  it("cli_first with quota available resolves to the CLI", () => {
    const adapter = factory({ apiKey: "sk-1", quota: true }).resolve(model, "cli_first");
    expect(adapter.connectionMode).toBe("cli");
  });

  it("cli_first with the quota exhausted falls back to the API", () => {
    const adapter = factory({ apiKey: "sk-1", quota: false }).resolve(model, "cli_first");
    expect(adapter.connectionMode).toBe("api");
  });

  it("api_only without a key raises a meaningful error", () => {
    expect(() => factory({ apiKey: null }).resolve(model, "api_only")).toThrow(/API key/);
  });
});

describe("AdapterFactory: multi-provider routing", () => {
  const cases: Array<[string, string, string]> = [
    ["openai", "gpt-5.5", "openai"],
    ["deepseek", "deepseek-v4-flash", "deepseek"],
    ["minimax", "minimax-m3", "minimax"],
    ["google", "gemini-3.5-flash", "google"],
  ];

  it.each(cases)("api_only %s resolves to the right API adapter", (provider, modelId, expectedId) => {
    const m: ModelRef = { provider, modelId, connectionMode: "api" };
    const adapter = factory({ apiKey: "k" }).resolve(m, "api_only");
    expect(adapter.id).toBe(expectedId);
    expect(adapter.connectionMode).toBe("api");
  });

  it("cli_only openai resolves to the Codex CLI adapter", () => {
    const m: ModelRef = { provider: "openai", modelId: "gpt-5.5", connectionMode: "cli" };
    expect(factory({}).resolve(m, "cli_only").id).toBe("codex");
  });

  it("cli_only google resolves to the Antigravity CLI adapter", () => {
    const m: ModelRef = { provider: "google", modelId: "gemini-3.5-flash", connectionMode: "cli" };
    expect(factory({}).resolve(m, "cli_only").id).toBe("antigravity");
  });

  it("cli_first with a provider that has no CLI (deepseek) falls through to the API", () => {
    const m: ModelRef = { provider: "deepseek", modelId: "deepseek-v4-flash", connectionMode: "cli" };
    const adapter = factory({ apiKey: "k", quota: true }).resolve(m, "cli_first");
    expect(adapter.connectionMode).toBe("api");
    expect(adapter.id).toBe("deepseek");
  });

  it("cli_only with a provider that has no CLI raises a meaningful error", () => {
    const m: ModelRef = { provider: "minimax", modelId: "minimax-m3", connectionMode: "cli" };
    expect(() => factory({}).resolve(m, "cli_only")).toThrow(/no subscription CLI/);
  });
});
