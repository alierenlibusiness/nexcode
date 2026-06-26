import { describe, it, expect } from "vitest";
import { QuotaTracker, poolIdForProvider } from "./quota";

describe("QuotaTracker (PRD §9.3/9.4 kayan pencere)", () => {
  it("kota tanımsız havuz her zaman uygun", () => {
    const q = new QuotaTracker();
    expect(q.isAvailable("serbest")).toBe(true);
  });

  it("pencere içi kullanım sınırı aşınca uygun değil (API'ye geçiş sinyali)", () => {
    const t = 1000;
    const q = new QuotaTracker(() => t);
    q.configure("claude-code", { windowMs: 5 * 60 * 60 * 1000, maxTokens: 1000 });

    q.record("claude-code", 600);
    expect(q.isAvailable("claude-code")).toBe(true);
    q.record("claude-code", 500); // toplam 1100 > 1000
    expect(q.isAvailable("claude-code")).toBe(false);
    expect(q.usage("claude-code")).toBe(1100);
  });

  it("pencereden çıkan eski kullanım düşer (kota sıfırlanır)", () => {
    let t = 0;
    const q = new QuotaTracker(() => t);
    const windowMs = 5 * 60 * 60 * 1000;
    q.configure("claude-code", { windowMs, maxTokens: 1000 });

    q.record("claude-code", 900, 0);
    t = windowMs + 1; // pencere kaydı, eski olay düştü
    expect(q.usage("claude-code")).toBe(0);
    expect(q.isAvailable("claude-code")).toBe(true);
  });

  it("CEO ve Backend aynı Claude Code havuzunu paylaşır (§9.3)", () => {
    expect(poolIdForProvider("anthropic")).toBe("claude-code");
    expect(poolIdForProvider("openai")).toBe("codex");
    // API-only sağlayıcı (DeepSeek) havuzsuz
    expect(poolIdForProvider("deepseek")).toBeUndefined();
  });
});
