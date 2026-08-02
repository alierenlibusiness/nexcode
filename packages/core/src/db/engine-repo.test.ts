import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { EngineRepository } from "./engine-repo";

function repo(): EngineRepository {
  return new EngineRepository(openDatabase(":memory:"));
}

describe("EngineRepository: task queue", () => {
  it("derives the title from the first line of the prompt and opens it as pending", () => {
    const task = repo().create({ prompt: "Fix the login flow\n\nDetails here", workingDir: "/w" });
    expect(task.title).toBe("Fix the login flow");
    expect(task.status).toBe("pending");
    expect(task.executionMode).toBe("auto");
    expect(task.kind).toBe("task");
  });

  it("claimNext respects priority, then age on a tie", () => {
    const r = repo();
    r.create({ prompt: "older", workingDir: "/w" });
    const urgent = r.create({ prompt: "urgent", workingDir: "/w", priority: 5 });
    expect(r.claimNext()?.id).toBe(urgent.id);
  });

  it("claimNext skips running tasks (concurrent slot claiming)", () => {
    const r = repo();
    const first = r.create({ prompt: "A", workingDir: "/w" });
    const second = r.create({ prompt: "B", workingDir: "/w" });

    expect(r.claimNext()?.id).toBe(first.id);
    expect(r.claimNext([first.id])?.id).toBe(second.id);
    expect(r.claimNext([first.id, second.id])).toBeNull();
  });

  it("never queues operator-chat tasks", () => {
    const r = repo();
    const parent = r.create({ prompt: "main", workingDir: "/w" });
    r.complete(parent.id, completion());
    r.create({ prompt: "question", workingDir: "/w", kind: "operator-chat", parentTaskId: parent.id });
    expect(r.claimNext()).toBeNull();
    expect(r.listByStatus("pending")).toHaveLength(0);
  });

  it("markRunning writes startedAt and complete records the delivery summary", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    r.markRunning(task.id);
    expect(r.getById(task.id)?.startedAt).toBeTypeOf("string");

    r.complete(task.id, { ...completion(), delivery: "done", changedFiles: 3 });
    const done = r.getById(task.id);
    expect(done?.status).toBe("done");
    expect(done?.delivery).toBe("done");
    expect(done?.changedFiles).toBe(3);
    expect(done?.completedAt).toBeTypeOf("string");
  });

  it("does not delete a running task but does delete a pending one", () => {
    const r = repo();
    const running = r.create({ prompt: "A", workingDir: "/w" });
    r.markRunning(running.id);
    expect(r.remove(running.id)).toBe(false);

    const pending = r.create({ prompt: "B", workingDir: "/w" });
    expect(r.remove(pending.id)).toBe(true);
    expect(r.getById(pending.id)).toBeNull();
  });

  it("edits only a pending task and invalidates the plan when the goal changes", () => {
    const r = repo();
    const task = r.create({ prompt: "old goal", workingDir: "/w" });
    r.markAwaitingApproval(task.id, "hash-1");
    expect(r.getById(task.id)?.planHash).toBe("hash-1");

    // A task in the approval state cannot be edited.
    expect(r.updatePending(task.id, { prompt: "new" })).toBe(false);

    const editable = r.create({ prompt: "first", workingDir: "/w" });
    r.startRound(editable.id, 1, "plan", "summary");
    expect(r.updatePending(editable.id, { prompt: "new goal" })).toBe(true);

    const updated = r.getById(editable.id);
    expect(updated?.title).toBe("new goal");
    expect(updated?.planHash).toBeNull();
  });

  it("queueSnapshot collects failed and blocked tasks in the same bucket", () => {
    const r = repo();
    const failed = r.create({ prompt: "F", workingDir: "/w" });
    const blocked = r.create({ prompt: "B", workingDir: "/w" });
    r.complete(failed.id, { ...completion(), status: "failed" });
    r.complete(blocked.id, { ...completion(), status: "blocked" });

    expect(r.queueSnapshot().failed).toHaveLength(2);
  });

  it("replayTarget puts a running task ahead of completed ones", () => {
    const r = repo();
    const older = r.create({ prompt: "older", workingDir: "/w" });
    r.complete(older.id, completion());
    const active = r.create({ prompt: "active", workingDir: "/w" });
    r.markRunning(active.id);

    expect(r.replayTarget()?.id).toBe(active.id);
  });
});

describe("EngineRepository: event history", () => {
  it("stores events in seq order and reports the last number", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    r.appendEvent({ seq: 1, taskId: task.id, type: "log", payload: { level: "info", message: "started" }, ts: "t1" });
    r.appendEvent({ seq: 2, taskId: task.id, type: "log", payload: { level: "info", message: "finished" }, ts: "t2" });

    const events = r.eventsFor(task.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events[0]?.payload).toEqual({ level: "info", message: "started" });
    expect(r.lastEventSeq()).toBe(2);
  });

  it("does not duplicate when the same seq is written again (replay de-duplication)", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    const event = {
      seq: 7,
      taskId: task.id,
      type: "log",
      payload: { level: "warn", message: "x" },
      ts: "t",
    } as const;
    r.appendEvent(event);
    r.appendEvent(event);
    expect(r.eventsFor(task.id)).toHaveLength(1);
  });

  it("reports lastEventSeq as zero for an empty history", () => {
    expect(repo().lastEventSeq()).toBe(0);
  });
});

describe("EngineRepository: rounds, assignments, conversation and counters", () => {
  it("records an assignment and updates it when the same id is written again", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    r.startRound(task.id, 1, "implement", "plan summary");

    const assignment = {
      id: "a1",
      agentId: "exec",
      agentName: "Executor",
      adapter: "claude" as const,
      kind: "implement" as const,
      role: "executor" as const,
      instruction: "write it",
      dependsOn: [],
      skills: ["api-design"],
    };
    r.recordAssignment(task.id, 1, assignment, { status: "failed", output: "", verdict: null, durationMs: 10 });
    r.recordAssignment(task.id, 1, assignment, { status: "completed", output: "done", verdict: "PASS", durationMs: 20 });

    const rows = r.assignmentsFor(task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", verdict: "PASS", output: "done", durationMs: 20 });
    expect(rows[0]?.skills).toEqual(["api-design"]);
  });

  it("keeps the operator conversation in chronological order", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    r.appendConversation(task.id, "user", "why did you do it this way");
    r.appendConversation(task.id, "operator", "for this reason");

    expect(r.conversationFor(task.id).map((c) => c.role)).toEqual(["user", "operator"]);
  });

  it("resets the daily call counter when the day changes", () => {
    const r = repo();
    r.setCallsToday(12, "2026-08-01");
    expect(r.callsToday("2026-08-01")).toBe(12);
    expect(r.callsToday("2026-08-02")).toBe(0);
  });
});

function completion() {
  return {
    status: "done" as const,
    delivery: "",
    verification: "",
    remainingRisk: "",
    rounds: 1,
    delegations: 1,
    calls: 2,
    usdCost: 0,
    changedFiles: 0,
  };
}
