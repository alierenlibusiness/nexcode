import { describe, expect, it } from "vitest";
import { FALLBACK_CONFIG } from "../config/defaults";
import { QuarantineRegistry, classifyFailure, decideRecovery, stalledSummary } from "./recovery";

const resilience = FALLBACK_CONFIG.resilience;

describe("classifyFailure", () => {
  it("recognises transient provider errors", () => {
    expect(classifyFailure({ message: "429 Too Many Requests" })).toBe("transient");
    expect(classifyFailure({ message: "Overloaded" })).toBe("transient");
    expect(classifyFailure({ message: "x", stderr: "ECONNRESET" })).toBe("transient");
  });

  it("recognises auth errors", () => {
    expect(classifyFailure({ message: "401 Unauthorized" })).toBe("auth");
    expect(classifyFailure({ message: "You are not logged in" })).toBe("auth");
  });

  it("recognises model errors", () => {
    expect(classifyFailure({ message: "model not found: gpt-9" })).toBe("model");
  });

  it("prioritises the time and silence limits", () => {
    expect(classifyFailure({ message: "429", timedOut: true })).toBe("timeout");
    expect(classifyFailure({ message: "429", stalled: true })).toBe("stalled");
  });

  it("counts an unrecognised error as permanent", () => {
    expect(classifyFailure({ message: "segmentation fault" })).toBe("permanent");
  });
});

describe("decideRecovery", () => {
  const base = { failoversUsed: 0, hasAlternative: true, resilience };

  it("retries with the same agent using exponential backoff on a transient error", () => {
    const first = decideRecovery({ ...base, failure: "transient", attempt: 0 });
    const second = decideRecovery({ ...base, failure: "transient", attempt: 1 });
    expect(first.action).toBe("retry");
    expect(first.delayMs).toBe(3000);
    expect(second.delayMs).toBe(6000);
    expect(first.quarantine).toBe(false);
  });

  it("fails over once the retries are exhausted", () => {
    const decision = decideRecovery({ ...base, failure: "transient", attempt: resilience.transientRetries });
    expect(decision.action).toBe("failover");
  });

  it("quarantines the agent on auth and model errors", () => {
    expect(decideRecovery({ ...base, failure: "auth", attempt: 0 }).quarantine).toBe(true);
    expect(decideRecovery({ ...base, failure: "model", attempt: 0 }).quarantine).toBe(true);
  });

  it("does not quarantine on time or silence limits: the condition may be temporary", () => {
    expect(decideRecovery({ ...base, failure: "timeout", attempt: 0 }).quarantine).toBe(false);
    expect(decideRecovery({ ...base, failure: "stalled", attempt: 0 }).quarantine).toBe(false);
  });

  it("gives up when there is no alternative agent", () => {
    const decision = decideRecovery({ ...base, failure: "permanent", attempt: 0, hasAlternative: false });
    expect(decision.action).toBe("give-up");
    expect(decision.reason).toContain("No other agent");
  });

  it("gives up once the failover budget is exhausted", () => {
    const decision = decideRecovery({
      ...base,
      failure: "permanent",
      attempt: 0,
      failoversUsed: resilience.maxFailoverAgents,
    });
    expect(decision.action).toBe("give-up");
    expect(decision.reason).toContain("Failover budget exhausted");
  });
});

describe("stalledSummary", () => {
  it("does not claim the process never ran: it reports that progress is preserved", () => {
    const summary = stalledSummary(300);
    expect(summary).toContain("300 seconds");
    expect(summary).toContain("does not mean the process never ran");
  });
});

describe("QuarantineRegistry", () => {
  it("holds the agent for the session and keeps the first reason", () => {
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
