import { describe, expect, it } from "vitest";
import { FALLBACK_CONFIG } from "../config/defaults";
import { QuarantineRegistry, classifyFailure, decideRecovery, stalledSummary } from "./recovery";

const resilience = FALLBACK_CONFIG.resilience;

describe("classifyFailure", () => {
  it("geçici sağlayıcı hatalarını tanır", () => {
    expect(classifyFailure({ message: "429 Too Many Requests" })).toBe("transient");
    expect(classifyFailure({ message: "Overloaded" })).toBe("transient");
    expect(classifyFailure({ message: "x", stderr: "ECONNRESET" })).toBe("transient");
  });

  it("yetki hatalarını tanır", () => {
    expect(classifyFailure({ message: "401 Unauthorized" })).toBe("auth");
    expect(classifyFailure({ message: "You are not logged in" })).toBe("auth");
  });

  it("model hatalarını tanır", () => {
    expect(classifyFailure({ message: "model not found: gpt-9" })).toBe("model");
  });

  it("süre ve sessizlik aşımını önceliklendirir", () => {
    expect(classifyFailure({ message: "429", timedOut: true })).toBe("timeout");
    expect(classifyFailure({ message: "429", stalled: true })).toBe("stalled");
  });

  it("tanınmayan hatayı kalıcı sayar", () => {
    expect(classifyFailure({ message: "segmentation fault" })).toBe("permanent");
  });
});

describe("decideRecovery", () => {
  const base = { failoversUsed: 0, hasAlternative: true, resilience };

  it("geçici hatada aynı agent ile üstel bekleyerek yeniden dener", () => {
    const first = decideRecovery({ ...base, failure: "transient", attempt: 0 });
    const second = decideRecovery({ ...base, failure: "transient", attempt: 1 });
    expect(first.action).toBe("retry");
    expect(first.delayMs).toBe(3000);
    expect(second.delayMs).toBe(6000);
    expect(first.quarantine).toBe(false);
  });

  it("yeniden deneme hakkı bitince devreder", () => {
    const decision = decideRecovery({ ...base, failure: "transient", attempt: resilience.transientRetries });
    expect(decision.action).toBe("failover");
  });

  it("yetki ve model hatalarında agent'ı karantinaya alır", () => {
    expect(decideRecovery({ ...base, failure: "auth", attempt: 0 }).quarantine).toBe(true);
    expect(decideRecovery({ ...base, failure: "model", attempt: 0 }).quarantine).toBe(true);
  });

  it("süre ve sessizlik aşımında karantina uygulamaz — geçici koşul olabilir", () => {
    expect(decideRecovery({ ...base, failure: "timeout", attempt: 0 }).quarantine).toBe(false);
    expect(decideRecovery({ ...base, failure: "stalled", attempt: 0 }).quarantine).toBe(false);
  });

  it("alternatif agent yoksa vazgeçer", () => {
    const decision = decideRecovery({ ...base, failure: "permanent", attempt: 0, hasAlternative: false });
    expect(decision.action).toBe("give-up");
    expect(decision.reason).toContain("başka agent yok");
  });

  it("devir hakkı tükendiğinde vazgeçer", () => {
    const decision = decideRecovery({
      ...base,
      failure: "permanent",
      attempt: 0,
      failoversUsed: resilience.maxFailoverAgents,
    });
    expect(decision.action).toBe("give-up");
    expect(decision.reason).toContain("Devir hakkı tükendi");
  });
});

describe("stalledSummary", () => {
  it("sürecin hiç çalışmadığını söylemez — ilerlemenin korunduğunu bildirir", () => {
    const summary = stalledSummary(300);
    expect(summary).toContain("300 saniye");
    expect(summary).toContain("hiç çalışmadığı anlamına gelmez");
  });
});

describe("QuarantineRegistry", () => {
  it("agent'ı oturum boyunca tutar ve ilk gerekçeyi korur", () => {
    const registry = new QuarantineRegistry();
    registry.quarantine("qa", "auth");
    registry.quarantine("qa", "model");
    expect(registry.has("qa")).toBe(true);
    expect(registry.reasonFor("qa")).toBe("auth");
    expect([...registry.ids]).toEqual(["qa"]);
    registry.clear();
    expect(registry.has("qa")).toBe(false);
  });
});
