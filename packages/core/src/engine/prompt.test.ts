import { describe, expect, it } from "vitest";
import { FALLBACK_CONFIG } from "../config/defaults";
import { buildOperatorPrompt, buildWorkerPrompt, digestTaskPrompt, trimFromEnd, trimFromStart } from "./prompt";
import { roundPolicyFor } from "./rounds";
import { buildCatalog } from "./routing";

describe("trimFromEnd / trimFromStart", () => {
  it("leaves text within the budget untouched", () => {
    expect(trimFromEnd("short", 100)).toBe("short");
    expect(trimFromStart("short", 100)).toBe("short");
  });

  it("reports truncation visibly instead of trimming silently", () => {
    const long = "x".repeat(500);
    expect(trimFromEnd(long, 100)).toContain("characters trimmed");
    expect(trimFromStart(long, 100)).toContain("characters trimmed");
  });

  it("keeps the newest content when trimming from the end", () => {
    expect(trimFromEnd("oldNEW", 3)).toContain("NEW");
  });

  it("keeps the oldest content when trimming from the start", () => {
    expect(trimFromStart("OLDnew", 3)).toContain("OLD");
  });

  it("returns empty for a zero budget", () => {
    expect(trimFromEnd("x", 0)).toBe("");
  });
});

describe("digestTaskPrompt", () => {
  it("leaves task text within the budget as it is", () => {
    const digest = digestTaskPrompt("t1", "Short task", 6000);
    expect(digest.text).toBe("Short task");
    expect(digest.spill).toBeNull();
  });

  it("spills large text to a file and embeds a head plus tail summary", () => {
    const prompt = `BEGIN${"a".repeat(9000)}END`;
    const digest = digestTaskPrompt("task-42", prompt, 2000);

    expect(digest.spill).not.toBeNull();
    expect(digest.spill?.relativePath).toBe(".nexcode/TASK-task-42.md");
    expect(digest.spill?.content).toBe(prompt);

    expect(digest.text).toContain("BEGIN");
    expect(digest.text).toContain("END");
    expect(digest.text).toContain(".nexcode/TASK-task-42.md");
    expect(digest.text).toContain("READ");
    // The embedded summary is markedly smaller than the full text.
    expect(digest.text.length).toBeLessThan(prompt.length / 2);
  });
});

describe("buildOperatorPrompt", () => {
  const catalog = buildCatalog({ config: FALLBACK_CONFIG });
  const policy = roundPolicyFor("balanced", "add a feature", FALLBACK_CONFIG);

  const base = {
    roleText: "# Role: Team Operator",
    goal: "Add avatar upload",
    policy,
    round: 1,
    catalog,
    skills: [],
    projectContext: "",
    teamState: "",
  } as const;

  it("enforces the phase specific JSON schema", () => {
    const planPrompt = buildOperatorPrompt({ ...base, phase: "plan" });
    expect(planPrompt).toContain('"status":"plan"');
    expect(planPrompt).toContain("Produce NOTHING other than");

    const evalPrompt = buildOperatorPrompt({ ...base, phase: "evaluate" });
    expect(evalPrompt).toContain('"status":"continue"');
  });

  it("reports the kind of work every catalog agent can take", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "plan" });
    expect(prompt).toContain("backend");
    expect(prompt).toContain("can take: implement");
    expect(prompt).toContain("can take: review");
    // The operator itself is not in the catalog.
    expect(prompt).not.toContain("- ceo: ");
  });

  it("makes the round and mode budget visible", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "plan", round: 2 });
    expect(prompt).toContain("Round: 2 / 3");
    expect(prompt).toContain("Execution mode: balanced");
    expect(prompt).toContain("must pass an independent review");
  });

  it("marks the skill inventory as the authoritative source", () => {
    const prompt = buildOperatorPrompt({
      ...base,
      phase: "plan",
      skills: [{ name: "unit-testing", summary: "Writing unit tests", referencePath: "skills/unit-testing.md" }],
    });
    expect(prompt).toContain("AUTHORITATIVE source");
    expect(prompt).toContain("unit-testing");
  });

  it("tells the operator not to invent a result for an empty catalog", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "plan", catalog: [] });
    expect(prompt).toContain("Do not invent a result");
  });

  it("bounds the previous round state with the context budget", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "evaluate", teamState: "y".repeat(100_000) });
    expect(prompt).toContain("characters trimmed");
    expect(prompt.length).toBeLessThan(100_000);
  });

  it("adds the protocol repair instruction to the prompt", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "plan", repairInstruction: "Produce JSON only." });
    expect(prompt).toContain("PROTOCOL REPAIR");
  });
});

describe("buildWorkerPrompt", () => {
  const assignment = {
    id: "i1",
    agentId: "backend",
    kind: "implement" as const,
    instruction: "Add the POST /avatar endpoint",
    dependsOn: ["p1"],
    skills: [],
    role: "executor" as const,
    agentName: "Backend",
    adapter: undefined,
  };

  const base = {
    roleText: "# Role: Executor",
    assignment,
    goal: "Add avatar upload",
    upstream: [],
    skills: [],
    projectContext: "",
    workingDir: "C:/project",
    sandboxed: true,
    contextCharBudget: 5000,
  };

  it("passes the main goal and the delegated work separately", () => {
    const prompt = buildWorkerPrompt(base);
    expect(prompt).toContain("MAIN GOAL");
    expect(prompt).toContain("Add avatar upload");
    expect(prompt).toContain("POST /avatar");
  });

  it("carries the output of the previous steps", () => {
    const prompt = buildWorkerPrompt({
      ...base,
      upstream: [{ id: "p1", kind: "plan", output: "1. Update the schema" }],
    });
    expect(prompt).toContain("p1 (plan)");
    expect(prompt).toContain("Update the schema");
  });

  it("states the write boundary explicitly while the sandbox is on", () => {
    expect(buildWorkerPrompt(base)).toContain("Do not write OUTSIDE");
    expect(buildWorkerPrompt({ ...base, sandboxed: false })).not.toContain("Do not write OUTSIDE");
  });

  it("gives the file path of the skill guide", () => {
    const prompt = buildWorkerPrompt({
      ...base,
      skills: [{ name: "api-design", summary: "REST contract", referencePath: "skills/api-design.md" }],
    });
    expect(prompt).toContain("Full guide: skills/api-design.md");
  });

  it("splits the upstream outputs across the context budget", () => {
    const prompt = buildWorkerPrompt({
      ...base,
      contextCharBudget: 200,
      upstream: [
        { id: "a", kind: "plan", output: "z".repeat(5000) },
        { id: "b", kind: "implement", output: "w".repeat(5000) },
      ],
    });
    expect(prompt).toContain("characters trimmed");
    expect(prompt.length).toBeLessThan(3000);
  });
});
