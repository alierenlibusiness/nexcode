import type { AgentProfile, AssignmentKind, ExecutionMode, NexcodeConfig } from "../config/schema";
import { silenceSecondsFor } from "../config/schema";
import { EngineEventBus, type FileChangeSummary } from "./events";
import { buildOperatorPrompt, buildWorkerPrompt, digestTaskPrompt, type SkillHint } from "./prompt";
import { parseOperatorDecision, protocolRepairInstruction, type OperatorDecision } from "./protocol";
import {
  QuarantineRegistry,
  classifyFailure,
  decideRecovery,
  stalledSummary,
  type FailureInput,
} from "./recovery";
import { isFinalRound, roundPolicyFor, type RoundPolicy } from "./rounds";
import {
  buildCatalog,
  enforceRoleChain,
  normalizeAssignments,
  parallelBatches,
  resolveOperatorId,
  type NormalizedAssignment,
} from "./routing";
import {
  extractBlockingFindings,
  parseVerdict,
  shouldFastPathDeliver,
  type ReviewVerdict,
  type RoundOutcome,
} from "./verdict";
import {
  IDLE_VERIFY_REPORT,
  verifyEvidence,
  verifySummary,
  type VerifyGate,
  type VerifyReport,
} from "../verify/verify-gate";

/**
 * The main loop of the engine.
 *
 * For one task: checkpoint, operator plan, optional approval, parallel or chained
 * delegation, independent review, verification gate, evaluation, then another round or
 * delivery.
 *
 * This module is pure (file system, process and database access are injected through
 * `EngineDeps`), so the whole flow is testable with fake agents.
 */

export interface EngineTask {
  id: string;
  prompt: string;
  executionMode: ExecutionMode;
  /**
   * Target of the agent processes, the snapshot, the live diff and the verification gate.
   * While worktree isolation is on this is the isolated tree.
   */
  workingDir: string;
  /**
   * The original repository. The project profile (`.nexcode/CONTEXT.md`) is read from and
   * written to here; written into the worktree it would be lost with the tree at the end of
   * the task. Defaults to `workingDir`.
   */
  projectDir?: string;
  /** Skip the project profile for this task. */
  fresh?: boolean;
}

export interface InvokeInput {
  taskId: string;
  assignmentId: string;
  agent: AgentProfile;
  prompt: string;
  kind: AssignmentKind | "operator";
  workingDir: string;
  timeoutSeconds: number;
  silenceSeconds: number;
  /** Streaming output for the live terminal view. */
  onChunk: (chunk: string, stream: "stdout" | "stderr") => void;
}

export type InvokeResult =
  | { ok: true; text: string; calls: number; usdCost: number }
  | { ok: false; failure: FailureInput; calls: number; usdCost: number };

/** The single point where the engine connects to the outside world. */
export interface EngineDeps {
  config: () => NexcodeConfig;
  events: EngineEventBus;
  /** Runs an agent (an API adapter or a CLI process). */
  invoke: (input: InvokeInput) => Promise<InvokeResult>;
  /** Returns the contents of `roles/<file>`. */
  loadRole: (roleFile: string) => Promise<string>;
  /** Skill shortlist scored against the task. */
  matchSkills: (goal: string, kind: AssignmentKind) => Promise<SkillHint[]>;
  /**
   * Which agents can actually be executed (`id` -> is it runnable).
   *
   * Only `invoke` can know this: a profile cannot run without a CLI command or an API
   * path. When omitted, every agent counts as runnable. If a profile that cannot run stays
   * in the catalog, the operator assigns work to it and the round is wasted.
   */
  agentHealth?: () => Record<string, boolean>;
  /** The `.nexcode/CONTEXT.md` profile of the working directory. */
  loadProjectContext: (workingDir: string) => Promise<string>;
  /** Writes task text that exceeds the budget into the working directory. */
  writeSpill: (workingDir: string, relativePath: string, content: string) => Promise<void>;
  /** Pre-task checkpoint; not called while `versioning` is off. */
  createCheckpoint?: (taskId: string, workingDir: string) => Promise<void>;
  /** Starts the live diff scan; returns the stop function. */
  startLiveDiff?: (taskId: string, workingDir: string) => Promise<() => Promise<FileChangeSummary[]>>;
  /**
   * The verification gate. When omitted the gate never runs and the earlier behaviour is
   * preserved exactly. The gate runs after all assignments of the round finish and BEFORE
   * any completion decision.
   */
  verifyGate?: VerifyGate;
  /** Asks for human approval of a risky plan. */
  requestApproval?: (input: { taskId: string; planSummary: string; planHash: string }) => Promise<boolean>;
  /** Revises the project profile at the end of the task. */
  reviseProjectContext?: (workingDir: string, delivery: string) => Promise<void>;
  notify?: (input: { taskId: string; outcome: "done" | "failed"; text: string }) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface TaskOutcome {
  taskId: string;
  outcome: "done" | "failed" | "blocked";
  final: string;
  verification: string;
  remainingRisk: string;
  rounds: number;
  delegations: number;
  calls: number;
  usdCost: number;
  files: FileChangeSummary[];
  warnings: string[];
}

interface AssignmentRecord {
  assignment: NormalizedAssignment;
  status: "completed" | "failed";
  output: string;
  verdict: ReviewVerdict | null;
  calls: number;
  usdCost: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A non-cryptographic, stable 64-bit FNV-1a. Used to detect whether the plan in the
 * approval queue changed: it is tamper detection, not a security boundary.
 */
export function planHash(text: string): string {
  let hi = 0x811c9dc5;
  let lo = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    lo = Math.imul(lo ^ code, 0x01000193) >>> 0;
    hi = Math.imul(hi ^ (code + i), 0x01000193) >>> 0;
  }
  return `${hi.toString(16).padStart(8, "0")}${lo.toString(16).padStart(8, "0")}`;
}

/** Whether the plan text contains a risky operation (only meaningful for `approvalMode: "ask"`). */
export function isRiskyPlan(text: string, patterns: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return patterns.some((pattern) => pattern.trim() !== "" && haystack.includes(pattern.toLowerCase()));
}

export class Engine {
  private readonly quarantine = new QuarantineRegistry();
  private callsToday = 0;
  private running = false;

  constructor(private readonly deps: EngineDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Resets the quarantine and the counters when a new session starts. */
  resetSession(callsToday = 0): void {
    this.quarantine.clear();
    this.callsToday = callsToday;
  }

  /**
   * Runs a single task end to end.
   *
   * It cannot run without autonomous consent, and the task is not started once the daily
   * call budget is exceeded. In both cases the reason is reported to the user as a `log`
   * event.
   */
  async runTask(task: EngineTask): Promise<TaskOutcome> {
    const config = this.deps.config();
    const now = this.deps.now ?? (() => new Date());
    const sleep = this.deps.sleep ?? defaultSleep;
    const warnings: string[] = [];

    if (config.autonomousConsentAcceptedAt === null) {
      return this.abort(task, "The engine cannot start without autonomous execution consent.", warnings);
    }
    if (this.callsToday >= config.dailyCallBudget) {
      return this.abort(
        task,
        `The daily call budget (${String(config.dailyCallBudget)}) is exhausted; the task was not started.`,
        warnings,
      );
    }

    const operatorId = resolveOperatorId(config);
    const operator = operatorId === null ? undefined : config.agents[operatorId];
    if (operator === undefined) {
      return this.abort(task, "There is no enabled operator agent; the task cannot start.", warnings);
    }

    this.running = true;
    let calls = 0;
    let usdCost = 0;
    let delegations = 0;
    let files: FileChangeSummary[] = [];
    let stopLiveDiff: (() => Promise<FileChangeSummary[]>) | null = null;

    try {
      const policy = roundPolicyFor(task.executionMode, task.prompt, config);
      this.emitStatus(task.id, operator.id, 0, policy, config);

      // When the task text exceeds the budget the full text spills into the working directory.
      const digest = digestTaskPrompt(task.id, task.prompt, config.taskPromptCharBudget);
      if (digest.spill !== null) {
        await this.deps.writeSpill(task.workingDir, digest.spill.relativePath, digest.spill.content);
        warnings.push(`The task text was moved into ${digest.spill.relativePath}.`);
      }

      if (config.versioning && this.deps.createCheckpoint !== undefined) {
        await this.deps.createCheckpoint(task.id, task.workingDir);
      }
      if (config.liveDiff && this.deps.startLiveDiff !== undefined) {
        stopLiveDiff = await this.deps.startLiveDiff(task.id, task.workingDir);
      }

      const operatorRole = await this.deps.loadRole(config.operator.roleFile);
      // The project profile is kept in the original repository; the isolated tree may be removed after the task.
      const projectContext =
        config.projectContext && task.fresh !== true
          ? await this.deps.loadProjectContext(projectDirOf(task))
          : "";

      const history: AssignmentRecord[] = [];
      let round = 0;
      let latestVerdict: ReviewVerdict | null = null;
      let verify: VerifyReport = IDLE_VERIFY_REPORT;
      let completionRejected = false;
      this.deps.verifyGate?.reset();

      while (round < policy.maxRounds) {
        round++;
        this.emitStatus(task.id, operator.id, round, policy, config, delegations);

        const catalog = buildCatalog({
          config,
          quarantined: this.quarantine.ids,
          health: this.deps.agentHealth?.() ?? {},
        });
        const skills = config.skills.autoMatch ? await this.deps.matchSkills(task.prompt, "plan") : [];

        // ── Operator decision (bounded retries on a protocol error) ──
        let decision: OperatorDecision | null = null;
        let repair: string | undefined;
        for (let attempt = 0; attempt <= config.operator.protocolRetries; attempt++) {
          const prompt = buildOperatorPrompt({
            phase: round === 1 ? "plan" : "evaluate",
            roleText: operatorRole,
            goal: digest.text,
            policy,
            round,
            catalog,
            skills,
            projectContext,
            teamState: summarizeHistory(history),
            verifyEvidence: verifyEvidence(verify),
            ...(repair !== undefined ? { repairInstruction: repair } : {}),
          });

          const result = await this.invokeAgent(task, operator, `operator-r${String(round)}`, "operator", prompt);
          calls += result.calls;
          usdCost += result.usdCost;

          if (!result.ok) {
            const summary = describeFailure(result.failure, operator);
            this.deps.events.emit("log", task.id, { level: "error", message: "Operator call failed", detail: summary }, now);
            return this.finish(task, "failed", summary, "", "", round, delegations, calls, usdCost, files, warnings);
          }

          const parsed = parseOperatorDecision(result.text);
          if (parsed.ok) {
            decision = parsed.decision;
            break;
          }
          repair = protocolRepairInstruction(parsed.error);
          warnings.push(`Operator protocol error (attempt ${String(attempt + 1)}): ${parsed.error}`);
          this.deps.events.emit("log", task.id, { level: "warn", message: "Protocol error", detail: parsed.error }, now);
        }

        if (decision === null) {
          const message = "The operator could not produce a valid decision within the allowed attempts.";
          return this.finish(task, "failed", message, "", "", round, delegations, calls, usdCost, files, warnings);
        }

        if (decision.status === "blocked") {
          const text = `${decision.blocked}${decision.needed === "" ? "" : `\n\nNeeded: ${decision.needed}`}`;
          return this.finish(task, "blocked", text, "", "", round, delegations, calls, usdCost, files, warnings);
        }

        if (decision.status === "complete") {
          // Executed evidence comes ahead of the model's claim: a "complete" decision made
          // despite a red gate is rejected ONCE and a repair round is forced. If it comes a
          // second time the delivery happens with a warning; hours of work are not thrown away.
          if (!completionRejected && this.deps.verifyGate?.isBlocking(config, verify) === true) {
            completionRejected = true;
            const reason = verifySummary(verify);
            warnings.push(`Completion decision rejected despite a red verification gate: ${reason}`);
            this.deps.events.emit(
              "log",
              task.id,
              { level: "warn", message: "The verification gate blocked delivery", detail: reason },
              now,
            );
            continue;
          }

          files = stopLiveDiff === null ? files : await stopLiveDiff();
          stopLiveDiff = null;
          return this.finish(
            task,
            "done",
            decision.final,
            mergeVerification(decision.verification, verify),
            decision.remainingRisk,
            round,
            delegations,
            calls,
            usdCost,
            files,
            warnings,
          );
        }

        // ── Assignment normalisation and role chain ──
        const normalized = normalizeAssignments(decision.assignments, catalog, policy);
        warnings.push(...normalized.warnings);
        const chained = enforceRoleChain(normalized.assignments, catalog, policy, round);
        warnings.push(...chained.warnings);
        const assignments = chained.assignments;

        if (assignments.length === 0) {
          const message = "The operator plan contains no executable assignment.";
          return this.finish(task, "failed", message, "", "", round, delegations, calls, usdCost, files, warnings);
        }

        // ── Approval gate ──
        const planText = `${decision.planSummary}\n${assignments.map((a) => a.instruction).join("\n")}`;
        if (
          config.approvalMode === "ask" &&
          isRiskyPlan(planText, config.riskyPatterns) &&
          this.deps.requestApproval !== undefined
        ) {
          const approved = await this.deps.requestApproval({
            taskId: task.id,
            planSummary: decision.planSummary === "" ? planText.slice(0, 500) : decision.planSummary,
            planHash: planHash(planText),
          });
          if (!approved) {
            return this.finish(
              task,
              "blocked",
              "The risky plan was rejected by the user.",
              "",
              "",
              round,
              delegations,
              calls,
              usdCost,
              files,
              warnings,
            );
          }
        }

        // ── Executing the delegations ──
        const roundRecords: AssignmentRecord[] = [];
        for (const batch of parallelBatches(assignments)) {
          const settled = await Promise.all(
            batch.map(async (assignment) => {
              // Do not start this work at all when the work it depends on failed.
              const blockedBy = assignment.dependsOn.filter((dep) =>
                [...history, ...roundRecords].some((r) => r.assignment.id === dep && r.status === "failed"),
              );
              if (blockedBy.length > 0) {
                return {
                  assignment,
                  status: "failed" as const,
                  output: `The work it depends on failed: ${blockedBy.join(", ")}`,
                  verdict: null,
                  calls: 0,
                  usdCost: 0,
                };
              }
              delegations++;
              return this.runAssignment(task, assignment, digest.text, [...history, ...roundRecords], {
                config,
                policy,
                projectContext,
                catalog,
              });
            }),
          );
          roundRecords.push(...settled);
          for (const record of settled) {
            calls += record.calls;
            usdCost += record.usdCost;
          }
        }

        history.push(...roundRecords);
        const reviews = roundRecords.filter((r) => r.assignment.kind === "review" && r.verdict !== null);
        latestVerdict = reviews.length > 0 ? (reviews[reviews.length - 1]?.verdict ?? null) : null;

        // ── Verification gate: a single call site, BEFORE any completion decision ──
        if (this.deps.verifyGate !== undefined) {
          verify = await this.deps.verifyGate.run(config, task.workingDir);
          if (verify.ran) {
            this.deps.events.emit(
              "log",
              task.id,
              {
                level: verify.ok ? "info" : "warn",
                message: "Verification gate",
                detail: verifySummary(verify),
              },
              now,
            );
          }
        }

        const outcome: RoundOutcome = {
          allAssignmentsSettled: roundRecords.every((r) => r.status === "completed"),
          latestVerdict,
          hasFailure: roundRecords.some((r) => r.status === "failed"),
        };

        // ── PASS fast path: skip the second operator call ──
        // A red gate disables this shortcut; the decision goes to the operator.
        const fastPathAllowed = this.deps.verifyGate?.allowsFastPath(verify) ?? true;
        if (fastPathAllowed && shouldFastPathDeliver(outcome, config.operator.passFastPath)) {
          files = stopLiveDiff === null ? files : await stopLiveDiff();
          stopLiveDiff = null;
          return this.finish(
            task,
            "done",
            summarizeDelivery(roundRecords),
            mergeVerification(summarizeVerification(roundRecords), verify),
            "",
            round,
            delegations,
            calls,
            usdCost,
            files,
            warnings,
          );
        }

        if (isFinalRound(round, policy)) {
          files = stopLiveDiff === null ? files : await stopLiveDiff();
          stopLiveDiff = null;
          const partial = outcome.hasFailure
            ? "The round limit was reached; the work is partially complete."
            : "The round limit was reached; the delivery is presented as it stands.";
          // When the round budget runs out a red gate does not discard the work; it is recorded as remaining risk.
          if (verify.ran && !verify.ok) warnings.push(verifySummary(verify));
          return this.finish(
            task,
            outcome.hasFailure ? "failed" : "done",
            `${partial}\n\n${summarizeDelivery(roundRecords)}`,
            mergeVerification(summarizeVerification(roundRecords), verify),
            mergeRisk(
              latestVerdict === "FAIL" ? extractBlockingFindings(lastReviewText(roundRecords)).join("; ") : "",
              verify,
            ),
            round,
            delegations,
            calls,
            usdCost,
            files,
            warnings,
          );
        }

        await sleep(0);
      }

      files = stopLiveDiff === null ? files : await stopLiveDiff();
      stopLiveDiff = null;
      return this.finish(
        task,
        "failed",
        "The round budget is exhausted.",
        "",
        "",
        policy.maxRounds,
        delegations,
        calls,
        usdCost,
        files,
        warnings,
      );
    } finally {
      if (stopLiveDiff !== null) files = await stopLiveDiff();
      this.running = false;
    }
  }

  /** Runs an assignment and applies the recovery policy (retry or failover). */
  private async runAssignment(
    task: EngineTask,
    assignment: NormalizedAssignment,
    goal: string,
    upstreamRecords: readonly AssignmentRecord[],
    ctx: {
      config: NexcodeConfig;
      policy: RoundPolicy;
      projectContext: string;
      catalog: ReturnType<typeof buildCatalog>;
    },
  ): Promise<AssignmentRecord> {
    const now = this.deps.now ?? (() => new Date());
    const sleep = this.deps.sleep ?? defaultSleep;
    const { config, policy, projectContext, catalog } = ctx;

    const skills = config.skills.autoMatch
      ? (await this.deps.matchSkills(assignment.instruction, assignment.kind)).slice(
          0,
          config.skills.maxSkillsPerAssignment,
        )
      : [];

    const upstream = assignment.dependsOn
      .map((dep) => upstreamRecords.find((r) => r.assignment.id === dep))
      .filter((r): r is AssignmentRecord => r !== undefined)
      .map((r) => ({ id: r.assignment.id, kind: r.assignment.kind, output: r.output }));

    let current = assignment;
    let attempt = 0;
    let failoversUsed = 0;
    let calls = 0;
    let usdCost = 0;

    for (;;) {
      const profile = config.agents[current.agentId];
      if (profile === undefined) {
        return {
          assignment: current,
          status: "failed",
          output: "Agent profile not found.",
          verdict: null,
          calls,
          usdCost,
        };
      }

      // The role text is resolved from the agent profile; after a failover the new agent's role applies.
      const roleText = await this.deps.loadRole(profile.roleFile);

      this.deps.events.emit(
        "message",
        task.id,
        {
          assignmentId: current.id,
          kind: "delegation",
          from: config.operator.agentId,
          to: current.agentId,
          assignmentKind: current.kind,
          role: current.role,
          summary: current.instruction.slice(0, 200),
          round: 0,
        },
        now,
      );

      const prompt = buildWorkerPrompt({
        roleText,
        assignment: current,
        goal,
        upstream,
        skills,
        projectContext,
        workingDir: task.workingDir,
        sandboxed: config.sandbox.mode === "workspace",
        contextCharBudget: policy.contextCharBudget,
      });

      const result = await this.invokeAgent(task, profile, current.id, current.kind, prompt);
      calls += result.calls;
      usdCost += result.usdCost;

      if (result.ok) {
        const verdict = current.kind === "review" ? parseVerdict(result.text) : null;
        this.deps.events.emit(
          "message",
          task.id,
          {
            assignmentId: current.id,
            kind: "result",
            from: current.agentId,
            to: config.operator.agentId,
            assignmentKind: current.kind,
            role: current.role,
            summary: verdict !== null ? `VERDICT: ${verdict}` : result.text.slice(0, 200),
            round: 0,
          },
          now,
        );
        return { assignment: current, status: "completed", output: result.text, verdict, calls, usdCost };
      }

      // ── Recovery ──
      const failure = classifyFailure(result.failure);
      const alternative = catalog.find(
        (a) => a.id !== current.agentId && a.allowedKinds.includes(current.kind) && !this.quarantine.has(a.id),
      );
      const decision = decideRecovery({
        failure,
        attempt,
        failoversUsed,
        hasAlternative: alternative !== undefined,
        resilience: config.resilience,
      });

      if (decision.quarantine) {
        this.quarantine.quarantine(current.agentId, failure);
      }

      this.deps.events.emit(
        "log",
        task.id,
        { level: "warn", message: `Delegation failed (${failure})`, detail: decision.reason },
        now,
      );

      if (decision.action === "retry") {
        attempt++;
        await sleep(decision.delayMs);
        continue;
      }

      if (decision.action === "failover" && alternative !== undefined) {
        failoversUsed++;
        current = {
          ...current,
          agentId: alternative.id,
          agentName: alternative.name,
          adapter: alternative.adapter,
          role: alternative.role,
          instruction: `${current.instruction}\n\n[Note: the previous agent could not complete this work (${failure}). Approach it from scratch.]`,
        };
        attempt = 0;
        continue;
      }

      const summary =
        failure === "stalled"
          ? stalledSummary(config.cliSilenceTimeoutSeconds)
          : describeFailure(result.failure, profile);

      this.deps.events.emit(
        "message",
        task.id,
        {
          assignmentId: current.id,
          kind: "failure",
          from: current.agentId,
          to: config.operator.agentId,
          assignmentKind: current.kind,
          role: current.role,
          summary,
          round: 0,
        },
        now,
      );
      return { assignment: current, status: "failed", output: summary, verdict: null, calls, usdCost };
    }
  }

  private async invokeAgent(
    task: EngineTask,
    agent: AgentProfile,
    assignmentId: string,
    kind: AssignmentKind | "operator",
    prompt: string,
  ): Promise<InvokeResult> {
    const config = this.deps.config();
    const now = this.deps.now ?? (() => new Date());
    const started = Date.now();

    this.deps.events.emit(
      "activity",
      task.id,
      { assignmentId, agentId: agent.id, agentName: agent.name, adapter: agent.adapter, phase: "started" },
      now,
    );

    const result = await this.deps.invoke({
      taskId: task.id,
      assignmentId,
      agent,
      prompt,
      kind,
      workingDir: task.workingDir,
      timeoutSeconds: config.agentTimeoutSeconds,
      silenceSeconds: Math.min(config.cliSilenceTimeoutSeconds, silenceSecondsFor(agent.adapter)),
      onChunk: (chunk, stream) => {
        this.deps.events.emit(
          "activity",
          task.id,
          {
            assignmentId,
            agentId: agent.id,
            agentName: agent.name,
            adapter: agent.adapter,
            phase: stream === "stdout" ? "stdout" : "stderr",
            chunk,
          },
          now,
        );
      },
    });

    // The daily budget counter is fed from a single point, including operator and specialist calls.
    this.callsToday += result.calls;

    this.deps.events.emit(
      "activity",
      task.id,
      {
        assignmentId,
        agentId: agent.id,
        agentName: agent.name,
        adapter: agent.adapter,
        phase: "finished",
        durationMs: Date.now() - started,
      },
      now,
    );

    return result;
  }

  private emitStatus(
    taskId: string,
    agentId: string,
    round: number,
    policy: RoundPolicy,
    config: NexcodeConfig,
    delegations = 0,
  ): void {
    this.deps.events.emit(
      "status",
      taskId,
      {
        running: true,
        currentTaskId: taskId,
        currentAgentId: agentId,
        round,
        maxRounds: policy.maxRounds,
        delegations,
        callsToday: this.callsToday,
        dailyCallBudget: config.dailyCallBudget,
        approvalMode: config.approvalMode,
        activeTaskIds: [taskId],
        concurrency: config.maxConcurrentTasks,
      },
      this.deps.now,
    );
  }

  private abort(task: EngineTask, message: string, warnings: string[]): TaskOutcome {
    this.deps.events.emit("log", task.id, { level: "error", message }, this.deps.now);
    return {
      taskId: task.id,
      outcome: "failed",
      final: message,
      verification: "",
      remainingRisk: "",
      rounds: 0,
      delegations: 0,
      calls: 0,
      usdCost: 0,
      files: [],
      warnings,
    };
  }

  private finish(
    task: EngineTask,
    outcome: TaskOutcome["outcome"],
    final: string,
    verification: string,
    remainingRisk: string,
    rounds: number,
    delegations: number,
    calls: number,
    usdCost: number,
    files: FileChangeSummary[],
    warnings: string[],
  ): TaskOutcome {
    this.deps.events.emit(
      "result",
      task.id,
      { taskId: task.id, outcome, final, verification, remainingRisk, rounds, delegations, calls, usdCost, files },
      this.deps.now,
    );

    const config = this.deps.config();
    if (this.deps.notify !== undefined && outcome !== "blocked") {
      const wanted = outcome === "done" ? config.notify.onComplete : config.notify.onFailed;
      if (wanted && config.notify.webhookUrl !== "") {
        void this.deps.notify({ taskId: task.id, outcome, text: final });
      }
    }
    // The profile is written to the original repository; the isolated tree may be removed after the task.
    if (outcome === "done" && config.projectContext && this.deps.reviseProjectContext !== undefined) {
      void this.deps.reviseProjectContext(projectDirOf(task), final);
    }

    return {
      taskId: task.id,
      outcome,
      final,
      verification,
      remainingRisk,
      rounds,
      delegations,
      calls,
      usdCost,
      files,
      warnings,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Directory the project profile is read from and written to: the original repo while isolated. */
function projectDirOf(task: EngineTask): string {
  return task.projectDir ?? task.workingDir;
}

/** Appends the result of the gate that actually ran to the model's verification claim. */
function mergeVerification(modelClaim: string, verify: VerifyReport): string {
  if (!verify.ran) return modelClaim;
  const gate = verifySummary(verify);
  return modelClaim.trim() === "" ? gate : `${modelClaim.trim()}\n\n${gate}`;
}

/** A red gate is recorded explicitly in the remaining risk of the delivered work. */
function mergeRisk(modelRisk: string, verify: VerifyReport): string {
  if (!verify.ran || verify.ok) return modelRisk;
  const gate = verifySummary(verify);
  return modelRisk.trim() === "" ? gate : `${modelRisk.trim()}; ${gate}`;
}

function describeFailure(failure: FailureInput, agent: AgentProfile): string {
  const parts = [`${agent.name} could not complete the work: ${failure.message}`];
  if (failure.stderr !== undefined && failure.stderr.trim() !== "") {
    parts.push(failure.stderr.trim().slice(0, 500));
  }
  return parts.join("\n");
}

function summarizeHistory(history: readonly AssignmentRecord[]): string {
  if (history.length === 0) return "";
  return history
    .map((record) => {
      const status = record.status === "completed" ? "COMPLETED" : "FAILED";
      const verdict = record.verdict === null ? "" : ` · VERDICT: ${record.verdict}`;
      return [
        `── ${record.assignment.id} (${record.assignment.kind} · ${record.assignment.agentName}): ${status}${verdict}`,
        record.output.trim(),
      ].join("\n");
    })
    .join("\n\n");
}

function summarizeDelivery(records: readonly AssignmentRecord[]): string {
  const implementations = records.filter((r) => r.assignment.kind === "implement" && r.status === "completed");
  const source = implementations.length > 0 ? implementations : records.filter((r) => r.status === "completed");
  if (source.length === 0) return "No deliverable output was produced.";
  return source.map((r) => r.output.trim()).join("\n\n");
}

function summarizeVerification(records: readonly AssignmentRecord[]): string {
  const reviews = records.filter((r) => r.assignment.kind === "review" && r.status === "completed");
  if (reviews.length === 0) return "";
  return reviews.map((r) => r.output.trim()).join("\n\n");
}

function lastReviewText(records: readonly AssignmentRecord[]): string {
  const reviews = records.filter((r) => r.assignment.kind === "review");
  return reviews[reviews.length - 1]?.output ?? "";
}
