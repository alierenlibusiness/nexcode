import { describe, expect, it } from "vitest";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { Engine, type EngineDeps, type InvokeInput, type InvokeResult } from "./engine";
import { EngineEventBus, type EngineEvent } from "./events";
import { VerifyGate, type VerifyPort } from "../verify/verify-gate";

/**
 * Behaviour of the verification gate inside the engine.
 *
 * The contract under test: while the gate is red the delivery shortcuts close and the
 * operator's "complete" decision is rejected once; even so the work is never thrown away.
 */

const CONSENT = "2026-07-25T00:00:00.000Z";

const PLAN = JSON.stringify({
  status: "plan",
  planSummary: "Add the endpoint",
  acceptanceCriteria: ["POST /avatar returns 201"],
  assignments: [{ id: "impl", agentId: "backend", kind: "implement", instruction: "Add the endpoint" }],
});

const COMPLETE = JSON.stringify({ status: "complete", final: "Done", verification: "I ran the tests" });

const task = { id: "t1", prompt: "Add avatar upload", executionMode: "balanced" as const, workingDir: "C:/p" };

function makeConfig(over: Partial<NexcodeConfig> = {}): NexcodeConfig {
  return normalizeConfig({ ...FALLBACK_CONFIG, autonomousConsentAcceptedAt: CONSENT, ...over });
}

/** A fake gate port that returns red for the given commands. */
function gatePort(failing: string[]): { port: VerifyPort; ran: string[]; cwds: string[] } {
  const ran: string[] = [];
  const cwds: string[] = [];
  return {
    ran,
    cwds,
    port: {
      runShell: ({ command, cwd }) => {
        ran.push(command);
        cwds.push(cwd);
        const failed = failing.includes(command);
        return Promise.resolve({ ok: !failed, stdout: failed ? "2 tests failed" : "all passed", stderr: "" });
      },
    },
  };
}

function harness(
  responder: (input: InvokeInput, callIndex: number) => InvokeResult,
  options: { failing?: string[]; commands?: string[]; configOver?: Partial<NexcodeConfig> } = {},
) {
  const events: EngineEvent[] = [];
  const bus = new EngineEventBus();
  bus.subscribe((event) => events.push(event));

  const calls: InvokeInput[] = [];
  let index = 0;

  const { port, ran, cwds } = gatePort(options.failing ?? []);
  const config = makeConfig({
    verify: { ...FALLBACK_CONFIG.verify, commands: options.commands ?? ["pnpm test"] },
    ...options.configOver,
  });

  const deps: EngineDeps = {
    config: () => config,
    events: bus,
    invoke: (input) => {
      calls.push(input);
      return Promise.resolve(responder(input, index++));
    },
    loadRole: (file) => Promise.resolve(`# ${file}`),
    matchSkills: () => Promise.resolve([]),
    loadProjectContext: () => Promise.resolve(""),
    writeSpill: () => Promise.resolve(),
    verifyGate: new VerifyGate(port),
    sleep: () => Promise.resolve(),
    now: () => new Date("2026-07-25T12:00:00.000Z"),
  };

  return { engine: new Engine(deps), calls, events, gateRan: ran, gateCwds: cwds };
}

function ok(text: string): InvokeResult {
  return { ok: true, text, calls: 1, usdCost: 0.01 };
}

/** A stubborn operator that says "complete" on every call after the planning round. */
function stubbornOperator(input: InvokeInput, i: number): InvokeResult {
  if (input.kind === "operator") return i === 0 ? ok(PLAN) : ok(COMPLETE);
  if (input.kind === "implement") return ok("STATUS: COMPLETED");
  return ok("VERDICT: PASS");
}

describe("Verification gate: engine integration", () => {
  it("never runs the gate when no command is defined and preserves the PASS fast path", async () => {
    const { engine, calls, gateRan } = harness(
      (input) => {
        if (input.kind === "operator") return ok(PLAN);
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: PASS");
      },
      { commands: [] },
    );

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(gateRan).toHaveLength(0);
    // The fast path was preserved: there is no second operator evaluation.
    expect(calls.filter((c) => c.kind === "operator")).toHaveLength(1);
  });

  it("keeps the fast path on a green gate and writes the result into the verification", async () => {
    const { engine, calls, gateRan } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(gateRan).toEqual(["pnpm test"]);
    expect(calls.filter((c) => c.kind === "operator")).toHaveLength(1);
    expect(result.verification).toContain("green");
  });

  it("closes the PASS fast path on a red gate and hands the decision to the operator", async () => {
    const { engine, calls } = harness(stubbornOperator, { failing: ["pnpm test"] });

    await engine.runTask(task);
    // Because the fast path closed, a second operator evaluation happened.
    expect(calls.filter((c) => c.kind === "operator").length).toBeGreaterThan(1);
  });

  it("rejects a completion decision made despite a red gate exactly once", async () => {
    const { engine, events } = harness(stubbornOperator, { failing: ["pnpm test"] });

    const result = await engine.runTask(task);
    expect(result.warnings.some((w) => w.includes("Completion decision rejected"))).toBe(true);

    const blocked = events.filter(
      (e) => e.type === "log" && e.payload.message === "The verification gate blocked delivery",
    );
    expect(blocked).toHaveLength(1);
  });

  it("does not discard the work of a stubborn operator; it delivers with a warning", async () => {
    const { engine } = harness(stubbornOperator, { failing: ["pnpm test"] });

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(result.final).toBe("Done");
    // The model's claim is preserved but the real gate result is recorded in the verification too.
    expect(result.verification).toContain("I ran the tests");
    expect(result.verification).toContain("RED");
  });

  it("does not block delivery on a red gate while blockOnFailure is off", async () => {
    const { engine, events } = harness(stubbornOperator, {
      failing: ["pnpm test"],
      configOver: { verify: { ...FALLBACK_CONFIG.verify, commands: ["pnpm test"], blockOnFailure: false } },
    });

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(
      events.some((e) => e.type === "log" && e.payload.message === "The verification gate blocked delivery"),
    ).toBe(false);
  });

  it("embeds the gate result into the operator's next prompt as evidence", async () => {
    const { engine, calls } = harness(stubbornOperator, { failing: ["pnpm test"] });
    await engine.runTask(task);

    const secondOperatorPrompt = calls.filter((c) => c.kind === "operator")[1]?.prompt ?? "";
    expect(secondOperatorPrompt).toContain("VERIFICATION GATE");
    expect(secondOperatorPrompt).toContain("Status: RED");
    expect(secondOperatorPrompt).toContain("2 tests failed");
    expect(secondOperatorPrompt).toContain("Do not take a delivery shortcut");
  });

  it("runs the gate in the task working directory, including an isolated tree", async () => {
    const { engine, gateCwds } = harness(stubbornOperator, { failing: ["pnpm test"] });
    await engine.runTask({ ...task, workingDir: "C:/wt/t1", projectDir: "C:/repo" });

    // The gate verifies the isolated tree, not the original repository.
    expect(gateCwds).toEqual(["C:/wt/t1"]);
  });

  it("runs only in rounds that have assignments and retries in those rounds", async () => {
    // With a new implementation plan every round and a FAIL review, the gate runs every round.
    const { engine, gateRan } = harness(
      (input) => {
        if (input.kind === "operator") return ok(PLAN);
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: FAIL\nBLOCKING: missing test");
      },
      {
        failing: ["pnpm test"],
        configOver: { operator: { ...FALLBACK_CONFIG.operator, maxRounds: 3 } },
      },
    );

    await engine.runTask(task);
    expect(gateRan).toEqual(["pnpm test", "pnpm test", "pnpm test"]);
  });

  it("records a red gate in the remaining risk once the round budget runs out", async () => {
    const { engine } = harness(
      (input) => {
        if (input.kind === "operator") return ok(PLAN);
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: FAIL\nBLOCKING: missing test");
      },
      {
        failing: ["pnpm test"],
        configOver: { operator: { ...FALLBACK_CONFIG.operator, maxRounds: 1 } },
      },
    );

    const result = await engine.runTask(task);
    expect(result.remainingRisk).toContain("RED");
    expect(result.warnings.some((w) => w.includes("RED"))).toBe(true);
  });
});

describe("Project profile directory", () => {
  it("reads the profile from the original repository while isolated, not the isolated tree", async () => {
    const readFrom: string[] = [];
    const revisedIn: string[] = [];

    const deps: EngineDeps = {
      config: () => makeConfig({ verify: { ...FALLBACK_CONFIG.verify, commands: [] } }),
      events: new EngineEventBus(),
      invoke: () => Promise.resolve(ok(COMPLETE)),
      loadRole: () => Promise.resolve("# operator"),
      matchSkills: () => Promise.resolve([]),
      loadProjectContext: (dir) => {
        readFrom.push(dir);
        return Promise.resolve("profile");
      },
      reviseProjectContext: (dir) => {
        revisedIn.push(dir);
        return Promise.resolve();
      },
      writeSpill: () => Promise.resolve(),
      sleep: () => Promise.resolve(),
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    };

    await new Engine(deps).runTask({ ...task, workingDir: "C:/wt/t1", projectDir: "C:/repo" });

    expect(readFrom).toEqual(["C:/repo"]);
    expect(revisedIn).toEqual(["C:/repo"]);
  });

  it("falls back to the working directory when there is no isolation", async () => {
    const readFrom: string[] = [];

    const deps: EngineDeps = {
      config: () => makeConfig({ verify: { ...FALLBACK_CONFIG.verify, commands: [] } }),
      events: new EngineEventBus(),
      invoke: () => Promise.resolve(ok(COMPLETE)),
      loadRole: () => Promise.resolve("# operator"),
      matchSkills: () => Promise.resolve([]),
      loadProjectContext: (dir) => {
        readFrom.push(dir);
        return Promise.resolve("");
      },
      writeSpill: () => Promise.resolve(),
      sleep: () => Promise.resolve(),
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    };

    await new Engine(deps).runTask(task);
    expect(readFrom).toEqual(["C:/p"]);
  });
});
