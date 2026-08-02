import type { NexcodeConfig } from "../config/schema";
import type { CommandResult } from "../worktree/worktree";

/**
 * The verification gate.
 *
 * Delivery must not rest on the model's `VERDICT: PASS` claim alone. This layer actually
 * runs the commands the user defined (tests, type checking, lint) after the assignments of
 * each round finish, and hands the result to the operator as evidence.
 *
 * Invariants:
 *
 * 1. **Opt-in.** While `verify.commands` is empty the gate never runs and the earlier
 *    behaviour is preserved exactly.
 * 2. **Fail-fast.** Execution stops at the first red command; the rest are not run.
 * 3. **A red gate disables the shortcuts.** FAST early completion, the PASS fast path and the
 *    review governor are turned off; the decision goes to the operator.
 * 4. **Work is never thrown away.** The gate blocks delivery at most `verify.maxAttempts`
 *    times; after that delivery happens with a warning. A gate that never goes green does not
 *    erase hours of work.
 */

export interface VerifyPort {
  /** Runs the command the user wrote in a shell. */
  runShell: (input: { command: string; cwd: string; timeoutMs: number }) => Promise<CommandResult>;
}

export interface VerifyCommandReport {
  command: string;
  ok: boolean;
  /** Clipped combined output (stdout plus stderr). */
  output: string;
  timedOut: boolean;
  durationMs: number;
}

export interface VerifyReport {
  /** Whether the gate ran. False while `verify.commands` is empty. */
  ran: boolean;
  ok: boolean;
  commands: VerifyCommandReport[];
  /** Which attempt we are on; compared against `maxAttempts`. */
  attempt: number;
}

/** A gate that never ran: every shortcut stays open. */
export const IDLE_VERIFY_REPORT: VerifyReport = { ran: false, ok: true, commands: [], attempt: 0 };

export class VerifyGate {
  private attempts = 0;

  constructor(
    private readonly port: VerifyPort,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Resets the attempt counter when a new task starts. */
  reset(): void {
    this.attempts = 0;
  }

  /**
   * Runs the commands in order and stops at the first red one.
   *
   * When the gate is off (no commands) no process is started and `ran: false` is returned.
   */
  async run(cfg: NexcodeConfig, workingDir: string): Promise<VerifyReport> {
    const commands = cfg.verify.commands;
    if (commands.length === 0) return IDLE_VERIFY_REPORT;

    this.attempts += 1;
    const reports: VerifyCommandReport[] = [];
    const timeoutMs = cfg.verify.timeoutSeconds * 1000;

    for (const command of commands) {
      const startedAt = this.now();
      const result = await this.port.runShell({ command, cwd: workingDir, timeoutMs });
      const report: VerifyCommandReport = {
        command,
        ok: result.ok,
        output: clip(joinStreams(result), cfg.verify.maxOutputChars),
        timedOut: result.timedOut === true,
        durationMs: this.now() - startedAt,
      };
      reports.push(report);
      if (!report.ok) break;
    }

    return { ran: true, ok: reports.every((r) => r.ok), commands: reports, attempt: this.attempts };
  }

  /**
   * Whether the gate still blocks delivery.
   *
   * When `blockOnFailure` is off the gate only reports. The block is also lifted once the
   * attempts run out: the operator delivers with a warning and the work is not lost.
   */
  isBlocking(cfg: NexcodeConfig, report: VerifyReport): boolean {
    if (!report.ran || report.ok) return false;
    if (!cfg.verify.blockOnFailure) return false;
    return report.attempt < cfg.verify.maxAttempts;
  }

  /** Whether the shortcuts (FAST early finish, PASS fast path, review governor) are open. */
  allowsFastPath(report: VerifyReport): boolean {
    return !report.ran || report.ok;
  }
}

/**
 * The evidence block embedded into the operator prompt.
 *
 * The model reads which command failed and why from this text; it sees the real output
 * instead of trusting an "I ran the tests" claim.
 */
export function verifyEvidence(report: VerifyReport): string {
  if (!report.ran) return "";

  const lines = ["## Verification gate", ""];
  lines.push(report.ok ? "Status: GREEN (all commands passed)" : "Status: RED");
  lines.push("");

  for (const command of report.commands) {
    const status = command.ok ? "PASSED" : command.timedOut ? "TIMED OUT" : "FAILED";
    lines.push(`### ${command.command} [${status}]`);
    if (!command.ok && command.output.trim() !== "") {
      lines.push("", "```", command.output.trim(), "```");
    }
    lines.push("");
  }

  if (!report.ok) {
    lines.push(
      "The gate is red. Do not take a delivery shortcut: plan the fix that makes the failing",
      "command pass, or state clearly in the remaining risk why the problem cannot be resolved.",
    );
  }

  return lines.join("\n").trim();
}

/** The single line status written into the delivery summary. */
export function verifySummary(report: VerifyReport): string {
  if (!report.ran) return "No verification gate is defined.";
  if (report.ok) return `Verification gate green (${String(report.commands.length)} commands).`;

  const failed = report.commands.find((c) => !c.ok);
  return `Verification gate RED: ${failed?.command ?? "unknown command"}${failed?.timedOut === true ? " (timed out)" : ""}.`;
}

function joinStreams(result: CommandResult): string {
  return [result.stdout, result.stderr].filter((part) => part.trim() !== "").join("\n");
}

/**
 * Clips long output in the middle.
 *
 * The head carries what the command did and the tail carries the error itself; test runners
 * print their summary at the end, so trimming from the end would drop the most critical
 * information.
 */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.35);
  const tail = limit - head;
  const dropped = text.length - limit;
  return `${text.slice(0, head)}\n\n... ${String(dropped)} characters skipped ...\n\n${text.slice(-tail)}`;
}
