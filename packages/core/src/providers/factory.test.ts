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
