import { describe, it, expect } from "vitest";
import {
  PROVIDER_REGISTRY,
  getProvider,
  getModelInfo,
  listProviders,
  providerCliKind,
  supportsVision,
  isKnownModel,
} from "./registry";
import { getPricing } from "./pricing";

describe("Provider registry (single source of truth, extensible)", () => {
  it("registers every provider plus the extension examples (Kimi, GLM)", () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["anthropic", "openai", "google", "deepseek", "minimax", "kimi", "glm"]),
    );
  });

  it("maps providers that have a CLI to the right CLI kind", () => {
    expect(providerCliKind("anthropic")).toBe("claude-code");
    expect(providerCliKind("openai")).toBe("codex");
    expect(providerCliKind("google")).toBe("antigravity");
    expect(providerCliKind("deepseek")).toBeUndefined();
    expect(providerCliKind("kimi")).toBeUndefined();
  });

  it("reads pricing from the registry (single source of truth)", () => {
    const opus = getModelInfo("anthropic", "claude-opus-4-8");
    expect(opus?.pricing).toEqual({ inputPerMTok: 15, outputPerMTok: 75 });
    expect(getPricing("anthropic", "claude-opus-4-8")).toEqual(opus?.pricing);
    // The newly added GLM price also resolves
    expect(getPricing("glm", "glm-4.6").inputPerMTok).toBeGreaterThan(0);
  });

  it("returns zero for an unknown model price instead of throwing", () => {
    expect(getPricing("kimi", "no-such-model")).toEqual({ inputPerMTok: 0, outputPerMTok: 0 });
    expect(isKnownModel("kimi", "no-such-model")).toBe(false);
    expect(isKnownModel("kimi", "kimi-k2")).toBe(true);
  });

  it("resolves vision support as model override over provider default", () => {
    expect(supportsVision("openai", "gpt-5.5")).toBe(true);
    expect(supportsVision("deepseek", "deepseek-v4-flash")).toBe(false);
  });

  it("makes adding a new OpenAI-compatible provider a data change (baseUrl plus kind)", () => {
    const glm = getProvider("glm");
    expect(glm?.kind).toBe("openai-compatible");
    expect(glm?.baseUrl).toContain("bigmodel");
    // Registry referential integrity: every provider has at least one model
    for (const p of Object.values(PROVIDER_REGISTRY)) {
      expect(p.models.length).toBeGreaterThan(0);
    }
  });
});
