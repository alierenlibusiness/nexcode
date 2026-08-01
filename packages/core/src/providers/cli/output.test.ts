import { describe, it, expect } from "vitest";
import { normalizeCliOutput } from "./output";

/**
 * CLI çıktısı normalizasyonu.
 *
 * Bu katman olmadan Claude Code'un JSON zarfı operatör kararı sanılır ve her görev
 * "şema uyuşmazlığı" ile düşer. Gerçek bir regresyon testidir.
 */

/** Claude Code `--output-format json` zarfının gerçek şekli. */
function claudeEnvelope(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "01506e2f-04a2-4b03-947a-ba33f7f6e004",
    total_cost_usd: 0.067252,
    duration_ms: 3382,
    api_error_status: null,
    result: '{"status":"complete","final":"Bitti"}',
    ...over,
  });
}

describe("normalizeCliOutput: Claude Code", () => {
  it("zarfın içindeki asıl metni çıkarır", () => {
    const output = normalizeCliOutput("claude", claudeEnvelope());
    expect(output.text).toBe('{"status":"complete","final":"Bitti"}');
    expect(output.error).toBeNull();
  });

  it("CLI'ın bildirdiği gerçek maliyeti taşır", () => {
    expect(normalizeCliOutput("claude", claudeEnvelope()).usdCost).toBeCloseTo(0.067252, 6);
  });

  it("is_error true iken hata olarak işaretler", () => {
    const output = normalizeCliOutput("claude", claudeEnvelope({ is_error: true, result: "kota doldu" }));
    expect(output.error).toBe("kota doldu");
  });

  it("api_error_status varsa onu sebep olarak kullanır", () => {
    const output = normalizeCliOutput(
      "claude",
      claudeEnvelope({ is_error: true, api_error_status: "rate_limit_error", result: "…" }),
    );
    expect(output.error).toBe("rate_limit_error");
  });

  it("maliyet alanı yoksa sıfır döner", () => {
    const envelope = JSON.stringify({ result: "metin", is_error: false });
    expect(normalizeCliOutput("claude", envelope).usdCost).toBe(0);
  });

  it("zarf beklenen biçimde değilse ham metni korur", () => {
    // Sürüm değişip biçim bozulursa sistem sessizce boş yanıt üretmemelidir.
    expect(normalizeCliOutput("claude", "düz metin yanıt").text).toBe("düz metin yanıt");
    expect(normalizeCliOutput("claude", '{"baska":"sema"}').text).toBe('{"baska":"sema"}');
    expect(normalizeCliOutput("claude", "[1,2,3]").text).toBe("[1,2,3]");
  });

  it("result string değilse ham metne düşer", () => {
    const envelope = JSON.stringify({ result: { nested: true }, is_error: false });
    expect(normalizeCliOutput("claude", envelope).text).toBe(envelope);
  });
});

describe("normalizeCliOutput: zarfsız adapter'lar", () => {
  it("codex, gemini ve opencode çıktısını olduğu gibi bırakır", () => {
    for (const adapter of ["codex", "gemini", "opencode", "antigravity", "custom"] as const) {
      expect(normalizeCliOutput(adapter, '  {"status":"plan"}  ').text).toBe('{"status":"plan"}');
    }
  });

  it("adapter bilinmiyorsa ham metni döndürür", () => {
    expect(normalizeCliOutput(undefined, "çıktı").text).toBe("çıktı");
  });

  it("boş çıktıda güvenli değer döner", () => {
    expect(normalizeCliOutput("claude", "   ")).toEqual({ text: "", usdCost: 0, error: null });
  });
});
