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

describe("AdapterFactory — API/CLI seçimi", () => {
  it("api_only → Anthropic API adapter", () => {
    const adapter = factory({ apiKey: "sk-1" }).resolve(model, "api_only");
    expect(adapter.id).toBe("anthropic");
    expect(adapter.connectionMode).toBe("api");
  });

  it("cli_only → Claude Code CLI adapter", () => {
    const adapter = factory({}).resolve(model, "cli_only");
    expect(adapter.id).toBe("claude-code");
    expect(adapter.connectionMode).toBe("cli");
  });

  it("cli_first + kota uygun → CLI", () => {
    const adapter = factory({ apiKey: "sk-1", quota: true }).resolve(model, "cli_first");
    expect(adapter.connectionMode).toBe("cli");
  });

  it("cli_first + kota dolu → API'ye fallback (PRD §9.4)", () => {
    const adapter = factory({ apiKey: "sk-1", quota: false }).resolve(model, "cli_first");
    expect(adapter.connectionMode).toBe("api");
  });

  it("api_only + anahtar yok → anlamlı hata", () => {
    expect(() => factory({ apiKey: null }).resolve(model, "api_only")).toThrow(/API anahtarı/);
  });
});

describe("AdapterFactory — çoklu sağlayıcı yönlendirme (Faz 2)", () => {
  const cases: Array<[string, string, string]> = [
    ["openai", "gpt-5.5", "openai"],
    ["deepseek", "deepseek-v4-flash", "deepseek"],
    ["minimax", "minimax-m3", "minimax"],
    ["google", "gemini-3.5-flash", "google"],
  ];

  it.each(cases)("api_only %s → doğru API adapter", (provider, modelId, expectedId) => {
    const m: ModelRef = { provider, modelId, connectionMode: "api" };
    const adapter = factory({ apiKey: "k" }).resolve(m, "api_only");
    expect(adapter.id).toBe(expectedId);
    expect(adapter.connectionMode).toBe("api");
  });

  it("cli_only openai → Codex CLI adapter", () => {
    const m: ModelRef = { provider: "openai", modelId: "gpt-5.5", connectionMode: "cli" };
    expect(factory({}).resolve(m, "cli_only").id).toBe("codex");
  });

  it("cli_only google → Antigravity CLI adapter", () => {
    const m: ModelRef = { provider: "google", modelId: "gemini-3.5-flash", connectionMode: "cli" };
    expect(factory({}).resolve(m, "cli_only").id).toBe("antigravity");
  });

  it("cli_first + CLI'sı olmayan sağlayıcı (deepseek) → API'ye düşer", () => {
    const m: ModelRef = { provider: "deepseek", modelId: "deepseek-v4-flash", connectionMode: "cli" };
    const adapter = factory({ apiKey: "k", quota: true }).resolve(m, "cli_first");
    expect(adapter.connectionMode).toBe("api");
    expect(adapter.id).toBe("deepseek");
  });

  it("cli_only + CLI'sı olmayan sağlayıcı → anlamlı hata", () => {
    const m: ModelRef = { provider: "minimax", modelId: "minimax-m3", connectionMode: "cli" };
    expect(() => factory({}).resolve(m, "cli_only")).toThrow(/abonelik CLI/);
  });
});
