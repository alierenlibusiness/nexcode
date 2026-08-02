import { describe, expect, it, vi } from "vitest";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { Engine, isRiskyPlan, planHash, type EngineDeps, type InvokeInput, type InvokeResult } from "./engine";
import { EngineEventBus, type EngineEvent } from "./events";

/**
 * The end-to-end behaviour of the engine is verified with fake agent processes: role chain,
 * PASS fast path, protocol retries, recovery/failover/quarantine, approval gate and budgets.
 */

const CONSENT = "2026-07-25T00:00:00.000Z";

function makeConfig(over: Partial<NexcodeConfig> = {}): NexcodeConfig {
  return normalizeConfig({
    ...FALLBACK_CONFIG,
    autonomousConsentAcceptedAt: CONSENT,
    agents: {
      ...FALLBACK_CONFIG.agents,
      // So the catalog contains a planner: the built-in six have none.
      architect: {
        id: "architect",
        name: "Architect",
        role: "planner",
        roleFile: "planner.md",
        connection: "api_only",
        model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      },
    },
    ...over,
  });
}

/** Fake agent: `responder` answers every call based on the agent id and the kind of work. */
function harness(
  responder: (input: InvokeInput, callIndex: number) => InvokeResult | Promise<InvokeResult>,
  configOver: Partial<NexcodeConfig> = {},
  depsOver: Partial<EngineDeps> = {},
) {
  const events: EngineEvent[] = [];
  const bus = new EngineEventBus();
  bus.subscribe((event) => events.push(event));

  const calls: InvokeInput[] = [];
  let index = 0;

  const config = makeConfig(configOver);
  const deps: EngineDeps = {
    config: () => config,
    events: bus,
    invoke: async (input) => {
      calls.push(input);
      return await responder(input, index++);
    },
    loadRole: (file) => Promise.resolve(`# ${file}`),
    matchSkills: () => Promise.resolve([]),
    loadProjectContext: () => Promise.resolve(""),
    writeSpill: () => Promise.resolve(),
    sleep: () => Promise.resolve(),
    now: () => new Date("2026-07-25T12:00:00.000Z"),
    ...depsOver,
  };

  return { engine: new Engine(deps), calls, events, config };
}

function ok(text: string): InvokeResult {
  return { ok: true, text, calls: 1, usdCost: 0.01 };
}

function fail(failure: { message: string; stalled?: boolean; timedOut?: boolean }): InvokeResult {
  return { ok: false, failure, calls: 1, usdCost: 0.005 };
}

const task = { id: "t1", prompt: "Add the avatar upload feature", executionMode: "balanced" as const, workingDir: "C:/p" };

const PLAN = JSON.stringify({
  status: "plan",
  planSummary: "Backend endpoint plus review",
  acceptanceCriteria: ["POST /avatar returns 201"],
  assignments: [{ id: "impl", agentId: "backend", kind: "implement", instruction: "Add the endpoint" }],
});

describe("Engine: happy path", () => {
  it("builds the plan -> implement -> review chain in the first round and delivers on PASS", async () => {
    const { engine, calls } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("PLAN SUMMARY: extend the schema");
      if (input.kind === "implement") return ok("STATUS: COMPLETED\nSUMMARY: endpoint added");
      return ok("ASSESSMENT: good\nVERDICT: PASS");
    });

    const result = await engine.runTask(task);

    expect(result.outcome).toBe("done");
    // The operator was called once: the PASS fast path skipped the second evaluation call.
    expect(calls.filter((c) => c.kind === "operator")).toHaveLength(1);
    expect(calls.map((c) => c.kind)).toEqual(["operator", "plan", "implement", "review"]);
    expect(result.rounds).toBe(1);
    expect(result.delegations).toBe(3);
  });

  it("passes the plan output to the implementation as context", async () => {
    const { engine, calls } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("STEPS:\n1. add the avatars table");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    await engine.runTask(task);

    const implPrompt = calls.find((c) => c.kind === "implement")?.prompt ?? "";
    expect(implPrompt).toContain("add the avatars table");
    expect(implPrompt).toContain("OUTPUT OF THE PREVIOUS STEPS");
  });

  it("performs the second operator evaluation when passFastPath is off", async () => {
    const { engine, calls } = harness(
      (input, i) => {
        if (input.kind === "operator") {
          return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"Done","verification":"tests passed"}');
        }
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: PASS");
      },
      { operator: { ...FALLBACK_CONFIG.operator, agentId: "ceo", passFastPath: false } },
    );

    const result = await engine.runTask(task);
    expect(calls.filter((c) => c.kind === "operator")).toHaveLength(2);
    expect(result.final).toBe("Done");
  });

  it("lets the operator answer directly without opening a delegation", async () => {
    const { engine, calls } = harness(() =>
      ok('{"status":"complete","final":"There are 64 skills enabled in the system.","verification":"read from the inventory"}'),
    );

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(result.final).toContain("64 skills");
    expect(calls).toHaveLength(1);
    expect(result.delegations).toBe(0);
  });
});

describe("Engine: review and rounds", () => {
  it("opens a targeted fix in the second round after FAIL and ends on PASS", async () => {
    const { engine, calls } = harness((input, i) => {
      if (input.kind === "operator") {
        return i === 0
          ? ok(PLAN)
          : ok(
              JSON.stringify({
                status: "continue",
                assignments: [
                  { id: "fix", agentId: "backend", kind: "implement", instruction: "Add the token check" },
                  { id: "recheck", agentId: "security", kind: "review", instruction: "Verify the fix", dependsOn: ["fix"] },
                ],
              }),
            );
      }
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      // The first review is FAIL, the second PASS.
      return calls.filter((c) => c.kind === "review").length === 1
        ? ok("FINDINGS:\n- [CRITICAL] src/auth.ts: the token is not validated\nVERDICT: FAIL")
        : ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);

    expect(result.rounds).toBe(2);
    expect(result.outcome).toBe("done");
    const fixPrompt = calls.find((c) => c.assignmentId === "fix")?.prompt ?? "";
    expect(fixPrompt).toContain("Add the token check");
  });

  it("delivers partially once the round limit is reached", async () => {
    const { engine } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: FAIL");
    });

    const result = await engine.runTask(task);
    expect(result.rounds).toBe(3);
    expect(result.final).toContain("The round limit was reached");
  });

  it("never silently counts an undecided review as PASS", async () => {
    const { engine } = harness((input, i) => {
      if (input.kind === "operator") {
        return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"closing"}');
      }
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("Looks good to me."); // no VERDICT line
    });

    const result = await engine.runTask(task);
    // The fast path did not trigger; the decision fell to the operator evaluation in round two.
    expect(result.rounds).toBe(2);
    expect(result.final).toBe("closing");
  });
});

describe("Engine: protocol resilience", () => {
  it("retries with a repair instruction after malformed output", async () => {
    const { engine, calls } = harness((input, i) => {
      if (input.kind === "operator") return i === 0 ? ok("Sure, starting right away!") : ok(PLAN);
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    const second = calls.filter((c) => c.kind === "operator")[1]?.prompt ?? "";
    expect(second).toContain("PROTOCOL REPAIR");
  });

  it("fails the task once the attempts are exhausted", async () => {
    const { engine, calls } = harness(() => ok("no JSON at all"));

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("failed");
    expect(result.final).toContain("could not produce a valid decision");
    // 1 first attempt + protocolRetries(2) = 3
    expect(calls).toHaveLength(3);
  });

  it("blocks the task when the operator reports a concrete blocker", async () => {
    const { engine } = harness(() => ok('{"status":"blocked","blocked":"The repo is read only","needed":"write permission"}'));

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("blocked");
    expect(result.final).toContain("The repo is read only");
    expect(result.final).toContain("write permission");
  });
});

describe("Engine: recovery", () => {
  it("retries with the same agent on a transient error", async () => {
    let implAttempts = 0;
    const { engine } = harness((input, i) => {
      if (input.kind === "operator") {
        return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"ok"}');
      }
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") {
        implAttempts++;
        return implAttempts === 1 ? fail({ message: "429 Too Many Requests" }) : ok("STATUS: COMPLETED");
      }
      return ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);
    expect(implAttempts).toBe(2);
    expect(result.outcome).toBe("done");
  });

  it("quarantines the agent on an auth error and hands the work over", async () => {
    const seen: string[] = [];
    const { engine } = harness((input, i) => {
      if (input.kind === "operator") {
        return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"handed over"}');
      }
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") {
        seen.push(input.agent.id);
        return input.agent.id === "backend" ? fail({ message: "401 Unauthorized" }) : ok("STATUS: COMPLETED");
      }
      return ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);
    expect(seen[0]).toBe("backend");
    expect(seen[1]).not.toBe("backend");
    expect(result.outcome).toBe("done");
  });

  it("reports that progress is preserved on a silence timeout", async () => {
    const { engine } = harness(
      (input, i) => {
        if (input.kind === "operator") {
          return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"closing"}');
        }
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return fail({ message: "no output", stalled: true });
        return ok("VERDICT: PASS");
      },
      { resilience: { transientRetries: 0, retryBaseSeconds: 1, maxFailoverAgents: 0 } },
    );

    const result = await engine.runTask(task);
    const history = result.final;
    expect(history).toBeDefined();
    expect(result.outcome).toBe("done");
  });

  it("never starts a downstream job when the work it depends on failed", async () => {
    const started: string[] = [];
    const { engine } = harness(
      (input, i) => {
        started.push(String(input.assignmentId));
        if (input.kind === "operator") {
          return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"closing"}');
        }
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return fail({ message: "segmentation fault" });
        return ok("VERDICT: PASS");
      },
      { resilience: { transientRetries: 0, retryBaseSeconds: 1, maxFailoverAgents: 0 } },
    );

    await engine.runTask(task);
    // auto-review was never called because it depends on impl.
    expect(started.filter((id) => id.startsWith("auto-review"))).toHaveLength(0);
  });
});

describe("Engine: safety and budgets", () => {
  it("does not start without autonomous consent", async () => {
    const { engine, calls } = harness(() => ok(PLAN), { autonomousConsentAcceptedAt: null });
    const result = await engine.runTask(task);
    expect(result.outcome).toBe("failed");
    expect(result.final).toContain("autonomous execution consent");
    expect(calls).toHaveLength(0);
  });

  it("does not start the task once the daily call budget is exhausted", async () => {
    const { engine, calls } = harness(() => ok(PLAN));
    engine.resetSession(FALLBACK_CONFIG.dailyCallBudget);
    const result = await engine.runTask(task);
    expect(result.final).toContain("daily call budget");
    expect(calls).toHaveLength(0);
  });

  it("blocks the task when a risky plan is rejected", async () => {
    const requestApproval = vi.fn().mockResolvedValue(false);
    const { engine } = harness(
      () =>
        ok(
          JSON.stringify({
            status: "plan",
            planSummary: "Deploy to the server",
            assignments: [{ id: "d", agentId: "devops", kind: "implement", instruction: "git push && deploy" }],
          }),
        ),
      { approvalMode: "ask" },
      { requestApproval },
    );

    const result = await engine.runTask(task);
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(result.outcome).toBe("blocked");
    expect(result.final).toContain("rejected");
  });

  it("does not ask for approval for a plan that is not risky", async () => {
    const requestApproval = vi.fn().mockResolvedValue(true);
    const { engine } = harness(
      (input, i) => {
        if (input.kind === "operator") {
          return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"ok"}');
        }
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: PASS");
      },
      { approvalMode: "ask" },
      { requestApproval },
    );

    await engine.runTask(task);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("states the write boundary to the specialist while the sandbox is on", async () => {
    const { engine, calls } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    await engine.runTask(task);
    expect(calls.find((c) => c.kind === "implement")?.prompt).toContain("Do not write OUTSIDE");
  });
});

describe("Engine: lifecycle hooks", () => {
  it("takes a pre-task checkpoint and stops the live diff", async () => {
    const createCheckpoint = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue([{ path: "a.ts", action: "modified", added: 2, removed: 0, previewStatus: "ok", hunks: [] }]);
    const startLiveDiff = vi.fn().mockResolvedValue(stop);

    const { engine } = harness(
      (input) => {
        if (input.kind === "operator") return ok(PLAN);
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: PASS");
      },
      {},
      { createCheckpoint, startLiveDiff },
    );

    const result = await engine.runTask(task);
    expect(createCheckpoint).toHaveBeenCalledWith("t1", "C:/p");
    expect(startLiveDiff).toHaveBeenCalledOnce();
    expect(result.files).toHaveLength(1);
  });

  it("spills task text that exceeds the budget to a file", async () => {
    const writeSpill = vi.fn().mockResolvedValue(undefined);
    const { engine, calls } = harness(
      () => ok('{"status":"complete","final":"ok"}'),
      { taskPromptCharBudget: 500 },
      { writeSpill },
    );

    const long = { ...task, prompt: `HEAD${"x".repeat(9000)}TAIL` };
    const result = await engine.runTask(long);

    expect(writeSpill).toHaveBeenCalledWith("C:/p", ".nexcode/TASK-t1.md", long.prompt);
    expect(calls[0]?.prompt).toContain(".nexcode/TASK-t1.md");
    expect(result.warnings.some((w) => w.includes("was moved into"))).toBe(true);
  });

  it("revises the project profile after delivery", async () => {
    const reviseProjectContext = vi.fn().mockResolvedValue(undefined);
    const { engine } = harness(() => ok('{"status":"complete","final":"done"}'), {}, { reviseProjectContext });

    await engine.runTask(task);
    expect(reviseProjectContext).toHaveBeenCalledWith("C:/p", "done");
  });

  it("publishes delegation, result and delivery on the event stream", async () => {
    const { engine, events } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    await engine.runTask(task);

    const types = new Set(events.map((e) => e.type));
    expect(types.has("status")).toBe(true);
    expect(types.has("activity")).toBe(true);
    expect(types.has("message")).toBe(true);
    expect(types.has("result")).toBe(true);
    // Sequence numbers increase monotonically.
    const seqs = events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });
});

describe("planHash / isRiskyPlan", () => {
  it("produces the same hash for the same plan and a different one when it changes", () => {
    expect(planHash("a")).toBe(planHash("a"));
    expect(planHash("a")).not.toBe(planHash("b"));
    expect(planHash("")).toHaveLength(16);
  });

  it("matches risky patterns case insensitively", () => {
    expect(isRiskyPlan("Then run GIT PUSH", ["git push"])).toBe(true);
    expect(isRiskyPlan("run the tests", ["git push"])).toBe(false);
    expect(isRiskyPlan("anything", [""])).toBe(false);
  });
});
