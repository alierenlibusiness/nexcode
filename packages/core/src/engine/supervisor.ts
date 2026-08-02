import type { NexcodeConfig } from "../config/schema";
import type { EngineEventBus } from "./events";
import type { EngineTask, TaskOutcome } from "./engine";

/**
 * The queue supervisor.
 *
 * The engine itself runs a single task. The supervisor reads the queue, fills up to
 * `maxConcurrentTasks` worker slots and publishes the aggregate status. How a task is
 * executed (isolated tree setup, engine instance, delivery, cleanup) belongs to the
 * `runTask` port; this class only knows the concurrency policy.
 *
 * Invariants:
 *
 * 1. **The same task never lands in two slots.** `claimNext` receives the running ids and skips them.
 * 2. **A failure in one slot does not bring down the others.** A slot error is caught, emitted
 *    as an event, and the slot is released.
 * 3. **Parallelism requires isolation.** `maxConcurrentTasks > 1` only makes sense while
 *    `worktree.mode: "task"`; `normalizeConfig` already drops it to 1 and the supervisor is
 *    defensive about it too.
 * 4. **`stop()` does not interrupt work.** No new task is claimed and in-flight tasks are awaited.
 */

export interface SupervisorPorts {
  config: () => NexcodeConfig;
  events: EngineEventBus;
  /**
   * Claims the next waiting task from the queue. `activeIds` are the tasks already running
   * and must be skipped. Returns `null` when there is no suitable task.
   */
  claimNext: (activeIds: readonly string[]) => Promise<EngineTask | null>;
  /** Runs a single task end to end (including isolation setup and cleanup). */
  runTask: (task: EngineTask) => Promise<TaskOutcome>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface SupervisorStatus {
  running: boolean;
  /** Ids of the tasks currently executing. */
  activeIds: string[];
  /** Effective slot count coming from the configuration. */
  concurrency: number;
  freeSlots: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class EngineSupervisor {
  private readonly active = new Map<string, Promise<void>>();
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private wakeUp: (() => void) | null = null;

  constructor(private readonly ports: SupervisorPorts) {}

  get isRunning(): boolean {
    return this.running;
  }

  status(): SupervisorStatus {
    const concurrency = this.concurrency();
    return {
      running: this.running,
      activeIds: [...this.active.keys()],
      concurrency,
      freeSlots: Math.max(0, concurrency - this.active.size),
    };
  }

  /** Starts the queue loop. Does nothing when it is already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.emitStatus();
    this.loopPromise = this.loop();
  }

  /**
   * Stops claiming new tasks and waits for the in-flight ones to finish.
   *
   * Running agent processes are not interrupted: half-finished work means half-finished file
   * changes. If the user really wants to cancel, that is a separate action.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wake();
    await this.loopPromise;
    await Promise.allSettled([...this.active.values()]);
    this.loopPromise = null;
    this.emitStatus();
  }

  /** Cuts the wait interval short (called when a new task is added). */
  wake(): void {
    this.wakeUp?.();
  }

  private concurrency(): number {
    const cfg = this.ports.config();
    // Without isolation, parallelism corrupts the working tree; defensively drop it to 1.
    return cfg.worktree.mode === "task" ? Math.max(1, cfg.maxConcurrentTasks) : 1;
  }

  private async loop(): Promise<void> {
    const sleep = this.ports.sleep ?? defaultSleep;

    while (this.running) {
      let dispatched = false;

      while (this.running && this.active.size < this.concurrency()) {
        const task = await this.ports.claimNext([...this.active.keys()]);
        if (task === null) break;
        this.dispatch(task);
        dispatched = true;
      }

      if (!this.running) break;

      // If we dispatched work, look again immediately: the queue may have more and a slot may have freed up.
      if (dispatched) {
        await sleep(0);
        continue;
      }

      await this.sleepUntilWake(sleep, this.ports.config().pollSeconds * 1000);
    }
  }

  private dispatch(task: EngineTask): void {
    const slot = this.runSlot(task);
    this.active.set(task.id, slot);
    this.emitStatus();

    void slot.finally(() => {
      this.active.delete(task.id);
      this.emitStatus();
      // A slot freed up: if the loop is waiting, let it claim a new task right away.
      this.wake();
    });
  }

  private async runSlot(task: EngineTask): Promise<void> {
    try {
      await this.ports.runTask(task);
    } catch (error) {
      // One slot crashing does not bring down the other slots or the queue.
      this.ports.events.emit(
        "log",
        task.id,
        { level: "error", message: "The task could not be executed", detail: String(error) },
        this.ports.now,
      );
    }
  }

  /** Waits `pollSeconds`; returns early when `wake()` is called. */
  private async sleepUntilWake(sleep: (ms: number) => Promise<void>, ms: number): Promise<void> {
    let woken = false;
    const wakeSignal = new Promise<void>((resolve) => {
      this.wakeUp = () => {
        if (woken) return;
        woken = true;
        resolve();
      };
    });

    try {
      await Promise.race([sleep(ms), wakeSignal]);
    } finally {
      this.wakeUp = null;
    }
  }

  /**
   * Publishes the aggregate slot status.
   *
   * `currentTaskId` stays singular (the first active task) so interfaces that assume a
   * single task keep working; `activeTaskIds` and `concurrency` are added for the
   * concurrent view.
   */
  private emitStatus(): void {
    const status = this.status();
    const config = this.ports.config();

    this.ports.events.emit(
      "status",
      status.activeIds[0] ?? null,
      {
        running: this.running,
        currentTaskId: status.activeIds[0] ?? null,
        currentAgentId: null,
        round: 0,
        maxRounds: config.operator.maxRounds,
        delegations: 0,
        callsToday: 0,
        dailyCallBudget: config.dailyCallBudget,
        approvalMode: config.approvalMode,
        activeTaskIds: status.activeIds,
        concurrency: status.concurrency,
      },
      this.ports.now,
    );
  }
}
