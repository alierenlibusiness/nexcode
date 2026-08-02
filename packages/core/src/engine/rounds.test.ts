import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { isFinalRound, resolveExecutionMode, roundPolicyFor } from "./rounds";

describe("resolveExecutionMode", () => {
  it("does not run the heuristic when the user chose a mode explicitly", () => {
    expect(resolveExecutionMode("fast", "do an architecture refactor")).toBe("fast");
    expect(resolveExecutionMode("deep", "fix a typo")).toBe("deep");
  });

  it("resolves risky, multi-component work to deep mode", () => {
    expect(resolveExecutionMode("auto", "Rewrite the authentication architecture")).toBe("deep");
    expect(resolveExecutionMode("auto", "Prepare the database schema migration")).toBe("deep");
    expect(resolveExecutionMode("auto", "x".repeat(1300))).toBe("deep");
  });

  it("resolves small, low risk fixes to fast mode", () => {
    expect(resolveExecutionMode("auto", "fix the typo in the README")).toBe("fast");
    expect(resolveExecutionMode("auto", "add comment to this function")).toBe("fast");
  });

  it("resolves the Turkish wording too, for tasks written in Turkish", () => {
    expect(resolveExecutionMode("auto", "Kimlik dogrulama mimarisini yeniden yaz")).toBe("deep");
    expect(resolveExecutionMode("auto", "Bu fonksiyona bir yorum ekle")).toBe("fast");
  });

  it("resolves everything else to balanced mode", () => {
    expect(resolveExecutionMode("auto", "Add avatar upload to the user profile page")).toBe("balanced");
  });
});

describe("roundPolicyFor", () => {
  it("uses at most three rounds in balanced mode and requires a review", () => {
    const policy = roundPolicyFor("balanced", "add a feature", FALLBACK_CONFIG);
    expect(policy.maxRounds).toBe(3);
    expect(policy.requireReview).toBe(true);
    expect(policy.separatePlanning).toBe(false);
  });

  it("does not require a review in fast mode", () => {
    const policy = roundPolicyFor("fast", "typo", FALLBACK_CONFIG);
    expect(policy.requireReview).toBe(false);
    expect(policy.maxRounds).toBe(2);
  });

  it("keeps separate planning in deep mode", () => {
    const policy = roundPolicyFor("deep", "architecture", FALLBACK_CONFIG);
    expect(policy.separatePlanning).toBe(true);
    expect(policy.maxRounds).toBe(6);
  });

  it("treats the config operator limits as a ceiling the mode policy cannot exceed", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      operator: { ...FALLBACK_CONFIG.operator, maxRounds: 2, maxDelegationsPerRound: 2 },
    });
    const policy = roundPolicyFor("deep", "architecture", config);
    expect(policy.maxRounds).toBe(2);
    expect(policy.maxDelegationsPerRound).toBe(2);
  });

  it("scales the context budget by mode", () => {
    const fast = roundPolicyFor("fast", "typo", FALLBACK_CONFIG);
    const deep = roundPolicyFor("deep", "architecture", FALLBACK_CONFIG);
    expect(fast.contextCharBudget).toBeLessThan(deep.contextCharBudget);
    expect(deep.contextCharBudget).toBe(FALLBACK_CONFIG.teamContextCharBudget);
  });
});

describe("isFinalRound", () => {
  it("reports that the round limit has been reached", () => {
    const policy = roundPolicyFor("balanced", "a feature", FALLBACK_CONFIG);
    expect(isFinalRound(2, policy)).toBe(false);
    expect(isFinalRound(3, policy)).toBe(true);
  });
});
