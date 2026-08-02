import { createContext } from "../context";
import { EXECUTION_MODES, type ExecutionMode, type EngineEvent } from "@nexcode/core";

/** Task queue commands: task, run, status, approvals. */

type Flags = Record<string, string | boolean>;

export function runTaskCommand(positional: readonly string[], flags: Flags): number {
  const prompt = positional.join(" ").trim();
  if (prompt === "") {
    process.stderr.write('Task text is required. Example: nexcode task "fix the tests"\n');
    return 1;
  }

  const mode = readMode(flags);
  if (mode === null) {
    process.stderr.write(`Invalid mode. Options: ${EXECUTION_MODES.join(", ")}\n`);
    return 1;
  }

  const ctx = createContext();
  const workingDir = readString(flags, "dir") ?? ctx.workingDir;
  const task = ctx.tasks.create({ prompt, workingDir, executionMode: mode });

  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    `Task queued.\n  id    : ${task.id}\n  title : ${task.title}\n  mode  : ${task.executionMode}\n` +
      `  folder: ${task.workingDir}\n\nTo run it: nexcode run\n`,
  );
  return 0;
}

export function runStatusCommand(flags: Flags): number {
  const ctx = createContext();
  const queue = ctx.tasks.queueSnapshot();
  const status = ctx.engine.status();

  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify({ status, queue }, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    `Engine: ${status.running ? "running" : "stopped"}  (${String(status.activeIds.length)}/${String(status.concurrency)} slots)\n` +
      `Data  : ${ctx.dataDir}\n\n`,
  );

  const sections: Array<[string, typeof queue.pending]> = [
    ["Waiting", queue.pending],
    ["Awaiting approval", queue.approval],
    ["Completed", queue.done],
    ["Failed", queue.failed],
  ];

  for (const [label, tasks] of sections) {
    process.stdout.write(`${label} (${String(tasks.length)})\n`);
    if (tasks.length === 0) {
      process.stdout.write("  -\n");
      continue;
    }
    for (const task of tasks.slice(0, 10)) {
      process.stdout.write(`  ${task.id.slice(0, 8)}  ${truncate(task.prompt, 64)}\n`);
    }
    if (tasks.length > 10) process.stdout.write(`  ... ${String(tasks.length - 10)} more\n`);
  }
  return 0;
}

export async function runRunCommand(flags: Flags): Promise<number> {
  const once = flags.once === true;
  const ctx = createContext({ onEvent: (event) => printEvent(event) });

  const config = ctx.configRepo.load();
  if (config.autonomousConsentAcceptedAt === null) {
    process.stderr.write(
      "The engine cannot start without autonomous execution consent.\n" +
        "Accept it from the panel or set the `autonomousConsentAcceptedAt` field in the configuration.\n",
    );
    return 1;
  }

  if (once && ctx.tasks.queueSnapshot().pending.length === 0) {
    process.stdout.write("The queue is empty.\n");
    return 0;
  }

  process.stdout.write("Engine started. Press Ctrl+C to stop.\n\n");
  ctx.engine.start();

  // Ctrl+C does not interrupt an in-flight task; the exit is clean once the work finishes.
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    process.stdout.write("\nStopping (the in-flight task will be finished)...\n");
    await ctx.engine.stop();
    process.exitCode = 0;
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  if (once) {
    await waitForDrain(ctx);
    await ctx.engine.stop();
    process.stdout.write("\nThe queue has drained.\n");
  } else {
    await new Promise<void>(() => undefined);
  }
  return 0;
}

export function runApprovalsCommand(flags: Flags): number {
  const ctx = createContext();

  const approve = readString(flags, "approve");
  const reject = readString(flags, "reject");
  const target = approve ?? reject;

  if (target !== undefined) {
    const record = ctx.approvals.getById(target);
    if (record === null) {
      process.stderr.write(`Approval not found: ${target}\n`);
      return 1;
    }
    ctx.approvals.resolve(target, approve !== undefined ? "approved" : "rejected", "cli");
    process.stdout.write(`Approval ${approve !== undefined ? "accepted" : "rejected"}: ${target}\n`);
    return 0;
  }

  const pending = ctx.approvals.listPending();
  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify(pending, null, 2)}\n`);
    return 0;
  }

  if (pending.length === 0) {
    process.stdout.write("No plans are awaiting approval.\n");
    return 0;
  }

  process.stdout.write(`${String(pending.length)} plans awaiting approval:\n\n`);
  for (const record of pending) {
    process.stdout.write(`  ${record.id}\n    type: ${record.actionType}\n    task: ${record.taskId}\n\n`);
  }
  process.stdout.write("Decide with: nexcode approvals --approve <id>  |  --reject <id>\n");
  return 0;
}

/** Waits until the queue drains and every slot is finished. */
function waitForDrain(ctx: ReturnType<typeof createContext>): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const idle = ctx.engine.status().activeIds.length === 0;
      const empty = ctx.tasks.queueSnapshot().pending.length === 0;
      if (idle && empty) {
        clearInterval(timer);
        resolve();
      }
    }, 500);
  });
}

/** Reduces engine events to readable single lines; the raw stdout stream is not printed. */
function printEvent(event: EngineEvent): void {
  if (event.type === "log") {
    const detail = event.payload.detail === undefined ? "" : `: ${truncate(event.payload.detail, 120)}`;
    process.stdout.write(`[${event.payload.level}] ${event.payload.message}${detail}\n`);
    return;
  }

  if (event.type === "activity") {
    const phase = event.payload.phase;
    if (phase === "stdout" || phase === "stderr" || phase === "progress") return;
    process.stdout.write(`  ${event.payload.agentName} ${phase}\n`);
    return;
  }

  if (event.type === "message") {
    process.stdout.write(`  ${event.payload.from} -> ${event.payload.to}: ${truncate(event.payload.summary, 90)}\n`);
    return;
  }

  if (event.type === "result") {
    process.stdout.write(`\n[${event.payload.outcome}] ${truncate(event.payload.final, 400)}\n`);
    if (event.payload.verification !== "") {
      process.stdout.write(`  verification: ${truncate(event.payload.verification, 200)}\n`);
    }
    if (event.payload.remainingRisk !== "") {
      process.stdout.write(`  remaining risk: ${truncate(event.payload.remainingRisk, 200)}\n`);
    }
    process.stdout.write(
      `  rounds ${String(event.payload.rounds)} · delegations ${String(event.payload.delegations)} · ` +
        `files ${String(event.payload.files.length)}\n\n`,
    );
  }
}

function readMode(flags: Flags): ExecutionMode | null {
  const raw = readString(flags, "mode");
  if (raw === undefined) return "auto";
  return (EXECUTION_MODES as readonly string[]).includes(raw) ? (raw as ExecutionMode) : null;
}

function readString(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}
