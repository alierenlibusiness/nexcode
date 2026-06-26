import { describe, it, expect, vi } from "vitest";
import { runWithEscalation, escalationLadder } from "./escalation";
import { QA_AGENT } from "./definitions";
import type { ModelRef } from "../domain/agent";

describe("escalationLadder", () => {
  it("QA için DeepSeek → MiniMax → Sonnet sırası üretir", () => {
    const ladder = escalationLadder(QA_AGENT);
    expect(ladder.map((m) => m.provider)).toEqual(["deepseek", "minimax", "anthropic"]);
  });

  it("eskalasyon modeli olmayan agent için tek elemanlı merdiven", () => {
    const def = { ...QA_AGENT, escalationModels: undefined };
    expect(escalationLadder(def)).toHaveLength(1);
  });
});

describe("runWithEscalation (PRD §8.5 3-kademe)", () => {
  const ladder = escalationLadder(QA_AGENT);

  it("Tier 1 başarılıysa üst kademeye geçmez (en ucuz çözüm)", async () => {
    const attempt = vi.fn(async () => ({ ok: true, value: "geçti" }));
    const outcome = await runWithEscalation(ladder, attempt);

    expect(outcome.ok).toBe(true);
    expect(outcome.tier).toBe(1);
    expect(outcome.escalated).toBe(false);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(outcome.modelRef.provider).toBe("deepseek");
  });

  it("Tier 1 yetersizse Tier 2'ye eskale eder", async () => {
    const attempt = vi.fn(async (_m: ModelRef, tier: number) => ({
      ok: tier === 2,
      value: `tier-${String(tier)}`,
    }));
    const outcome = await runWithEscalation(ladder, attempt);

    expect(outcome.ok).toBe(true);
    expect(outcome.tier).toBe(2);
    expect(outcome.escalated).toBe(true);
    expect(outcome.modelRef.provider).toBe("minimax");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("tüm kademeler yetersizse ok:false ile son sonucu döner (açan agent'a geri gönderilir)", async () => {
    const attempt = vi.fn(async (_m: ModelRef, tier: number) => ({
      ok: false,
      value: `tier-${String(tier)}`,
    }));
    const outcome = await runWithEscalation(ladder, attempt);

    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toBe(3);
    expect(outcome.tier).toBe(3);
    expect(outcome.value).toBe("tier-3");
  });

  it("bir kademe exception fırlatırsa bir sonrakine geçer", async () => {
    const attempt = vi.fn(async (_m: ModelRef, tier: number) => {
      if (tier === 1) throw new Error("DeepSeek 500");
      return { ok: true, value: `tier-${String(tier)}` };
    });
    const outcome = await runWithEscalation(ladder, attempt);

    expect(outcome.ok).toBe(true);
    expect(outcome.tier).toBe(2);
  });

  it("tüm kademeler exception fırlatırsa son hata yükselir", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("hepsi patladı");
    });
    await expect(runWithEscalation(ladder, attempt)).rejects.toThrow(/hepsi patladı/);
  });
});
