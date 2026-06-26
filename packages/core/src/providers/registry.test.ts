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

describe("Provider registry (tek kaynak, genişletilebilir)", () => {
  it("Faz 2'nin tüm sağlayıcıları + genişletme örnekleri (Kimi, GLM) kayıtlı", () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(["anthropic", "openai", "google", "deepseek", "minimax", "kimi", "glm"]),
    );
  });

  it("CLI'sı olan sağlayıcılar doğru CLI türüne eşlenir (PRD §9.2)", () => {
    expect(providerCliKind("anthropic")).toBe("claude-code");
    expect(providerCliKind("openai")).toBe("codex");
    expect(providerCliKind("google")).toBe("antigravity");
    expect(providerCliKind("deepseek")).toBeUndefined();
    expect(providerCliKind("kimi")).toBeUndefined();
  });

  it("pricing registry'den okunur (tek kaynak)", () => {
    const opus = getModelInfo("anthropic", "claude-opus-4-8");
    expect(opus?.pricing).toEqual({ inputPerMTok: 15, outputPerMTok: 75 });
    expect(getPricing("anthropic", "claude-opus-4-8")).toEqual(opus?.pricing);
    // GLM (yeni eklenen) fiyatı da çözülebiliyor
    expect(getPricing("glm", "glm-4.6").inputPerMTok).toBeGreaterThan(0);
  });

  it("bilinmeyen model fiyatı sıfır döner (hata fırlatmaz)", () => {
    expect(getPricing("kimi", "yok-böyle-model")).toEqual({ inputPerMTok: 0, outputPerMTok: 0 });
    expect(isKnownModel("kimi", "yok-böyle-model")).toBe(false);
    expect(isKnownModel("kimi", "kimi-k2")).toBe(true);
  });

  it("görsel desteği model override > sağlayıcı varsayılanı", () => {
    expect(supportsVision("openai", "gpt-5.5")).toBe(true);
    expect(supportsVision("deepseek", "deepseek-v4-flash")).toBe(false);
  });

  it("yeni OpenAI-uyumlu sağlayıcı eklemek veri işidir (baseUrl + kind)", () => {
    const glm = getProvider("glm");
    expect(glm?.kind).toBe("openai-compatible");
    expect(glm?.baseUrl).toContain("bigmodel");
    // Registry değişmez referans bütünlüğü: her sağlayıcının en az bir modeli var
    for (const p of Object.values(PROVIDER_REGISTRY)) {
      expect(p.models.length).toBeGreaterThan(0);
    }
  });
});
