import { describe, it, expect } from "vitest";
import { normalizeCliOutput } from "./output";

/**
 * CLI output normalisation.
 *
 * Without this layer the Claude Code JSON envelope is mistaken for an operator decision
 * and every task fails with a "schema mismatch". This is a real regression test.
 */

/** The real shape of the Claude Code `--output-format json` envelope. */
function claudeEnvelope(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "01506e2f-04a2-4b03-947a-ba33f7f6e004",
    total_cost_usd: 0.067252,
    duration_ms: 3382,
    api_error_status: null,
    result: '{"status":"complete","final":"Done"}',
    ...over,
  });
}

describe("normalizeCliOutput: Claude Code", () => {
  it("extracts the actual text from inside the envelope", () => {
    const output = normalizeCliOutput("claude", claudeEnvelope());
    expect(output.text).toBe('{"status":"complete","final":"Done"}');
    expect(output.error).toBeNull();
  });

  it("carries the real cost reported by the CLI", () => {
    expect(normalizeCliOutput("claude", claudeEnvelope()).usdCost).toBeCloseTo(0.067252, 6);
  });

  it("marks the result as an error when is_error is true", () => {
    const output = normalizeCliOutput("claude", claudeEnvelope({ is_error: true, result: "quota exhausted" }));
    expect(output.error).toBe("quota exhausted");
  });

  it("uses api_error_status as the reason when it is present", () => {
    const output = normalizeCliOutput(
      "claude",
      claudeEnvelope({ is_error: true, api_error_status: "rate_limit_error", result: "…" }),
    );
    expect(output.error).toBe("rate_limit_error");
  });

  it("returns zero when the cost field is missing", () => {
    const envelope = JSON.stringify({ result: "text", is_error: false });
    expect(normalizeCliOutput("claude", envelope).usdCost).toBe(0);
  });

  it("preserves the raw text when the envelope is not in the expected shape", () => {
    // If a version change breaks the format, the system must not silently produce an empty answer.
    expect(normalizeCliOutput("claude", "plain text answer").text).toBe("plain text answer");
    expect(normalizeCliOutput("claude", '{"other":"schema"}').text).toBe('{"other":"schema"}');
    expect(normalizeCliOutput("claude", "[1,2,3]").text).toBe("[1,2,3]");
  });

  it("falls back to the raw text when result is not a string", () => {
    const envelope = JSON.stringify({ result: { nested: true }, is_error: false });
    expect(normalizeCliOutput("claude", envelope).text).toBe(envelope);
  });
});

describe("normalizeCliOutput: adapters without an envelope", () => {
  it("leaves codex, gemini and opencode output as it is", () => {
    for (const adapter of ["codex", "gemini", "opencode", "antigravity", "custom"] as const) {
      expect(normalizeCliOutput(adapter, '  {"status":"plan"}  ').text).toBe('{"status":"plan"}');
    }
  });

  it("returns the raw text when the adapter is unknown", () => {
    expect(normalizeCliOutput(undefined, "output").text).toBe("output");
  });

  it("returns a safe value for empty output", () => {
    expect(normalizeCliOutput("claude", "   ")).toEqual({ text: "", usdCost: 0, error: null });
  });
});
