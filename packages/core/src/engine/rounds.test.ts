import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { isFinalRound, resolveExecutionMode, roundPolicyFor } from "./rounds";

describe("resolveExecutionMode", () => {
  it("kullanıcı açıkça mod seçtiyse sezgisel çalıştırmaz", () => {
    expect(resolveExecutionMode("fast", "mimari refactor yap")).toBe("fast");
    expect(resolveExecutionMode("deep", "typo düzelt")).toBe("deep");
  });

  it("riskli ve çok bileşenli işleri derin moda çözer", () => {
    expect(resolveExecutionMode("auto", "Kimlik doğrulama mimarisini yeniden yaz")).toBe("deep");
    expect(resolveExecutionMode("auto", "Veritabanı şeması migration'ı hazırla")).toBe("deep");
    expect(resolveExecutionMode("auto", "x".repeat(1300))).toBe("deep");
  });

  it("küçük ve düşük riskli düzeltmeleri hızlı moda çözer", () => {
    expect(resolveExecutionMode("auto", "README'deki typo düzelt")).toBe("fast");
    expect(resolveExecutionMode("auto", "Bu fonksiyona bir yorum ekle")).toBe("fast");
  });

  it("diğer her şeyi dengeli moda çözer", () => {
    expect(resolveExecutionMode("auto", "Kullanıcı profili sayfasına avatar yükleme ekle")).toBe("balanced");
  });
});

describe("roundPolicyFor", () => {
  it("dengeli mod en fazla üç tur kullanır ve incelemeyi zorunlu kılar", () => {
    const policy = roundPolicyFor("balanced", "özellik ekle", FALLBACK_CONFIG);
    expect(policy.maxRounds).toBe(3);
    expect(policy.requireReview).toBe(true);
    expect(policy.separatePlanning).toBe(false);
  });

  it("hızlı mod incelemeyi zorunlu kılmaz", () => {
    const policy = roundPolicyFor("fast", "typo", FALLBACK_CONFIG);
    expect(policy.requireReview).toBe(false);
    expect(policy.maxRounds).toBe(2);
  });

  it("derin mod ayrı planlamayı korur", () => {
    const policy = roundPolicyFor("deep", "mimari", FALLBACK_CONFIG);
    expect(policy.separatePlanning).toBe(true);
    expect(policy.maxRounds).toBe(6);
  });

  it("config operatör limitleri tavandır — mod politikası bunları aşamaz", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      operator: { ...FALLBACK_CONFIG.operator, maxRounds: 2, maxDelegationsPerRound: 2 },
    });
    const policy = roundPolicyFor("deep", "mimari", config);
    expect(policy.maxRounds).toBe(2);
    expect(policy.maxDelegationsPerRound).toBe(2);
  });

  it("context bütçesini moda göre ölçekler", () => {
    const fast = roundPolicyFor("fast", "typo", FALLBACK_CONFIG);
    const deep = roundPolicyFor("deep", "mimari", FALLBACK_CONFIG);
    expect(fast.contextCharBudget).toBeLessThan(deep.contextCharBudget);
    expect(deep.contextCharBudget).toBe(FALLBACK_CONFIG.teamContextCharBudget);
  });
});

describe("isFinalRound", () => {
  it("tur sınırına ulaşıldığını bildirir", () => {
    const policy = roundPolicyFor("balanced", "özellik", FALLBACK_CONFIG);
    expect(isFinalRound(2, policy)).toBe(false);
    expect(isFinalRound(3, policy)).toBe(true);
  });
});
