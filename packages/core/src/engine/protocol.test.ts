import { describe, expect, it } from "vitest";
import { extractJsonObject, isDelegateDecision, parseOperatorDecision } from "./protocol";

describe("extractJsonObject", () => {
  it("takes a plain JSON object as it is", () => {
    expect(extractJsonObject('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("strips code fences", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("finds the first balanced object inside surrounding prose", () => {
    const text = 'Here is my plan:\n{"status":"plan","nested":{"x":1}}\nHope that works.';
    expect(extractJsonObject(text)).toBe('{"status":"plan","nested":{"x":1}}');
  });

  it("does not count braces inside a string", () => {
    const text = '{"instruction":"write this: } and {","id":"a"}';
    expect(extractJsonObject(text)).toBe(text);
  });

  it("handles escaped quotes correctly", () => {
    const text = '{"instruction":"they said \\"done}\\" ","id":"a"}';
    expect(extractJsonObject(text)).toBe(text);
  });

  it("returns null when there is no object", () => {
    expect(extractJsonObject("no JSON at all")).toBeNull();
  });
});

describe("parseOperatorDecision", () => {
  it("parses a plan decision and fills in the defaults", () => {
    const result = parseOperatorDecision(
      JSON.stringify({
        status: "plan",
        assignments: [{ id: "a1", agentId: "backend", kind: "implement", instruction: "Add the endpoint" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isDelegateDecision(result.decision)).toBe(true);
    if (!isDelegateDecision(result.decision)) return;
    expect(result.decision.assignments[0]?.dependsOn).toEqual([]);
    expect(result.decision.assignments[0]?.skills).toEqual([]);
    expect(result.decision.acceptanceCriteria).toEqual([]);
  });

  it("counts a continue decision as a delegation too", () => {
    const result = parseOperatorDecision(
      JSON.stringify({
        status: "continue",
        assignments: [{ id: "fix", agentId: "backend", kind: "implement", instruction: "Fix the findings" }],
      }),
    );
    expect(result.ok && isDelegateDecision(result.decision)).toBe(true);
  });

  it("parses a direct answer (complete) decision", () => {
    const result = parseOperatorDecision('{"status":"complete","final":"3 skills are enabled."}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.status).toBe("complete");
    expect(isDelegateDecision(result.decision)).toBe(false);
  });

  it("parses a blocked decision", () => {
    const result = parseOperatorDecision('{"status":"blocked","blocked":"The repo is read only"}');
    expect(result.ok && result.decision.status === "blocked").toBe(true);
  });

  it("rejects an empty assignment list", () => {
    const result = parseOperatorDecision('{"status":"plan","assignments":[]}');
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown kind of work", () => {
    const result = parseOperatorDecision(
      '{"status":"plan","assignments":[{"id":"a","agentId":"b","kind":"deploy","instruction":"x"}]}',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Schema mismatch");
  });

  it("returns a repairable error for non-JSON output", () => {
    const result = parseOperatorDecision("Sure, planning right away!");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No JSON object was found");
  });

  it("returns a parse error for malformed JSON", () => {
    const result = parseOperatorDecision('{"status":"plan", assignments: }');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("JSON could not be parsed");
  });
});
