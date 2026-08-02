import { describe, it, expect } from "vitest";
import { QuotaTracker, poolIdForProvider } from "./quota";

describe("QuotaTracker (sliding window)", () => {
  it("treats a pool without a quota as always available", () => {
    const q = new QuotaTracker();
    expect(q.isAvailable("unbounded")).toBe(true);
  });

  it("becomes unavailable once in-window usage exceeds the limit (the API switch signal)", () => {
    const t = 1000;
    const q = new QuotaTracker(() => t);
    q.configure("claude-code", { windowMs: 5 * 60 * 60 * 1000, maxTokens: 1000 });

    q.record("claude-code", 600);
    expect(q.isAvailable("claude-code")).toBe(true);
    q.record("claude-code", 500); // 1100 in total, above 1000
    expect(q.isAvailable("claude-code")).toBe(false);
    expect(q.usage("claude-code")).toBe(1100);
  });

  it("drops usage that leaves the window so the quota resets", () => {
    let t = 0;
    const q = new QuotaTracker(() => t);
    const windowMs = 5 * 60 * 60 * 1000;
    q.configure("claude-code", { windowMs, maxTokens: 1000 });

    q.record("claude-code", 900, 0);
    t = windowMs + 1; // the window slid and the old event fell out
    expect(q.usage("claude-code")).toBe(0);
    expect(q.isAvailable("claude-code")).toBe(true);
  });

  it("makes CEO and Backend share the same Claude Code pool", () => {
    expect(poolIdForProvider("anthropic")).toBe("claude-code");
    expect(poolIdForProvider("openai")).toBe("codex");
    // An API-only provider (DeepSeek) has no pool
    expect(poolIdForProvider("deepseek")).toBeUndefined();
  });
});
