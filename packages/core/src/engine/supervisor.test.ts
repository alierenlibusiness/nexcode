import { describe, expect, it } from "vitest";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { EngineSupervisor, type SupervisorPorts } from "./supervisor";
import { EngineEventBus, type EngineEvent } from "./events";
import type { EngineTask, TaskOutcome } from "./engine";

/**
 * The supervisor only knows the concurrency policy: filling slots, claiming and stopping.
 * How a task is executed belongs to the `runTask` port.
 */

function config(over: Partial<NexcodeConfig> = {}): NexcodeConfig {
  return normalizeConfig({
    ...FALLBACK_CONFIG,
    autonomousConsentAcceptedAt: "2026-07-25T00:00:00.000Z",
    pollSeconds: 1,
    ...over,
  });
}

/** Configuration with isolation on and N slots (normalisation drops it to 1 otherwise). */
function concurrent(slots: number): NexcodeConfig {
  return config({ maxConcurrentTasks: slots, worktree: { ...FALLBACK_CONFIG.worktree, mode: "task" } });
}

function outcome(taskId: string): TaskOutcome {
  return {
    taskId,
    outcome: "done",
    final: "done",
    verification: "",
    remainingRisk: "",
    rounds: 1,
    delegations: 1,
    calls: 1,
    usdCost: 0,
    files: [],
    warnings: [],
  };
}

interface HarnessOptions {
  cfg?: NexcodeConfig;
  /** Task ids to place in the queue. */
  queue?: string[];
  /** runTask throws for these ids. */
  throwing?: string[];
}

function harness(options: HarnessOptions = {}) {
  const cfg = options.cfg ?? config();
  const queue = [...(options.queue ?? [])];
  const events: EngineEvent[] = [];
  const bus = new EngineEventBus();
  bus.subscribe((event) => events.push(event));

  const started: string[] = [];
  const finished: string[] = [];
  const claimSkips: string[][] = [];
  /** A "finish the work" trigger per task id, so concurrency is measured deterministically. */
  const release = new Map<string, () => void>();
  let peakInFlight = 0;
  let inFlight = 0;

  const ports: SupervisorPorts = {
    config: () => cfg,
    events: bus,
    claimNext: (activeIds) => {
      claimSkips.push([...activeIds]);
      const next = queue.find((id) => !activeIds.includes(id));
      if (next === undefined) return Promise.resolve(null);
      queue.splice(queue.indexOf(next), 1);
      return Promise.resolve<EngineTask>({
        id: next,
        prompt: `task ${next}`,
        executionMode: "auto",
        workingDir: "C:/p",
      });
    },
    runTask: async (task) => {
      started.push(task.id);
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);

      await new Promise<void>((resolve) => release.set(task.id, resolve));

      inFlight--;
      finished.push(task.id);
      if (options.throwing?.includes(task.id) === true) throw new Error(`blew up: ${task.id}`);
      return outcome(task.id);
    },
    sleep: () => Promise.resolve(),
    now: () => new Date("2026-07-25T12:00:00.000Z"),
  };

  const supervisor = new EngineSupervisor(ports);

  /** Completes the execution of a task and lets the event loop move forward. */
  async function finish(id: string): Promise<void> {
    release.get(id)?.();
    release.delete(id);
    await tick();
  }

  return { supervisor, started, finished, claimSkips, events, finish, peak: () => peakInFlight, queue };
}

/** Waits for the microtask queue to drain. */
async function tick(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("EngineSupervisor: slot management", () => {
  it("runs tasks sequentially in a single slot", async () => {
    const h = harness({ queue: ["a", "b"] });
    h.supervisor.start();
    await tick();

    expect(h.started).toEqual(["a"]);
    expect(h.supervisor.status().activeIds).toEqual(["a"]);

    await h.finish("a");
    expect(h.started).toEqual(["a", "b"]);
    expect(h.peak()).toBe(1);

    await h.finish("b");
    await h.supervisor.stop();
  });

  it("runs as many tasks in parallel as there are slots while isolation is on", async () => {
    const h = harness({ cfg: concurrent(3), queue: ["a", "b", "c", "d"] });
    h.supervisor.start();
    await tick();

    expect(h.started).toEqual(["a", "b", "c"]);
    expect(h.supervisor.status().activeIds).toEqual(["a", "b", "c"]);
    expect(h.supervisor.status().freeSlots).toBe(0);

    // As soon as a slot frees up the next task is claimed.
    await h.finish("a");
    expect(h.started).toEqual(["a", "b", "c", "d"]);
    expect(h.peak()).toBe(3);

    for (const id of ["b", "c", "d"]) await h.finish(id);
    await h.supervisor.stop();
  });

  it("drops to a single slot when isolation is off, even if parallelism is requested", async () => {
    // normalizeConfig already drops it to 1; the supervisor is defensive too.
    const h = harness({ cfg: config({ maxConcurrentTasks: 4 }), queue: ["a", "b", "c"] });
    h.supervisor.start();
    await tick();

    expect(h.supervisor.status().concurrency).toBe(1);
    expect(h.started).toEqual(["a"]);
    expect(h.peak()).toBe(1);

    await h.finish("a");
    await h.finish("b");
    await h.finish("c");
    await h.supervisor.stop();
  });

  it("never gives the same task to two slots: running ids are skipped when claiming", async () => {
    const h = harness({ cfg: concurrent(2), queue: ["a", "b"] });
    h.supervisor.start();
    await tick();

    // The second claim call already reports the first task as active.
    expect(h.claimSkips.some((skips) => skips.includes("a"))).toBe(true);
    expect(new Set(h.started).size).toBe(h.started.length);

    await h.finish("a");
    await h.finish("b");
    await h.supervisor.stop();
  });

  it("consumes no slot while the queue is empty", async () => {
    const h = harness({ cfg: concurrent(2) });
    h.supervisor.start();
    await tick();

    expect(h.started).toEqual([]);
    expect(h.supervisor.status().freeSlots).toBe(2);
    await h.supervisor.stop();
  });
});

describe("EngineSupervisor: resilience", () => {
  it("does not let one slot failure bring down the other slots or the queue", async () => {
    const h = harness({ cfg: concurrent(2), queue: ["bad", "good", "next"], throwing: ["bad"] });
    h.supervisor.start();
    await tick();

    expect(h.started).toEqual(["bad", "good"]);

    await h.finish("bad");
    // The error was caught, emitted as an event, and the slot was released.
    expect(
      h.events.some((e) => e.type === "log" && e.payload.message === "The task could not be executed"),
    ).toBe(true);
    expect(h.started).toContain("next");
    expect(h.supervisor.isRunning).toBe(true);

    await h.finish("good");
    await h.finish("next");
    await h.supervisor.stop();
  });

  it("does not interrupt an in-flight task on stop; it waits for it to finish", async () => {
    const h = harness({ queue: ["a"] });
    h.supervisor.start();
    await tick();
    expect(h.started).toEqual(["a"]);

    let stopped = false;
    const stopping = h.supervisor.stop().then(() => {
      stopped = true;
    });

    await tick();
    // The task is still running: stop is waiting.
    expect(stopped).toBe(false);
    expect(h.finished).toEqual([]);

    await h.finish("a");
    await stopping;

    expect(stopped).toBe(true);
    expect(h.finished).toEqual(["a"]);
    expect(h.supervisor.isRunning).toBe(false);
  });

  it("claims no new task from the queue after being stopped", async () => {
    const h = harness({ queue: ["a", "b"] });
    h.supervisor.start();
    await tick();

    const stopping = h.supervisor.stop();
    await h.finish("a");
    await stopping;

    expect(h.started).toEqual(["a"]);
    expect(h.queue).toEqual(["b"]);
  });

  it("does not open a second loop when start is called twice", async () => {
    const h = harness({ queue: ["a"] });
    h.supervisor.start();
    h.supervisor.start();
    await tick();

    expect(h.started).toEqual(["a"]);
    await h.finish("a");
    await h.supervisor.stop();
  });

  it("returns safely from stop on a supervisor that is not running", async () => {
    const h = harness();
    await expect(h.supervisor.stop()).resolves.toBeUndefined();
  });
});

describe("EngineSupervisor: status publishing", () => {
  it("reports the active tasks and the slot count in the status event", async () => {
    const h = harness({ cfg: concurrent(2), queue: ["a", "b"] });
    h.supervisor.start();
    await tick();

    const status = h.events.filter((e) => e.type === "status");
    const last = status[status.length - 1];
    expect(last?.payload).toMatchObject({ activeTaskIds: ["a", "b"], concurrency: 2, running: true });
    // The singular field is preserved for interfaces that assume a single task.
    expect(last?.payload).toMatchObject({ currentTaskId: "a" });

    await h.finish("a");
    await h.finish("b");
    await h.supervisor.stop();
  });

  it("reports an empty list in the status while idle", async () => {
    const h = harness();
    h.supervisor.start();
    await tick();

    const status = h.events.filter((e) => e.type === "status");
    expect(status[status.length - 1]?.payload).toMatchObject({ activeTaskIds: [], currentTaskId: null });
    await h.supervisor.stop();
  });
});
