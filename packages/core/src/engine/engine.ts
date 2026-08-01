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
 * Motorun ana döngüsü.
 *
 * Bir görev için: checkpoint, operatör planı, (onay), paralel/zincirli delegasyon,
 * bağımsız inceleme, doğrulama kapısı, değerlendirme, yeni tur veya teslimat.
 *
 * Bu modül saftır (dosya sistemi, süreç ve veritabanı erişimi `EngineDeps` üzerinden
 * enjekte edilir), böylece tüm akış sahte agent'larla test edilebilir.
 */

export interface EngineTask {
  id: string;
  prompt: string;
  executionMode: ExecutionMode;
  /**
   * Agent süreçlerinin, snapshot'ın, canlı diff'in ve doğrulama kapısının hedefi.
   * Worktree izolasyonu açıkken bu, izole ağaçtır.
   */
  workingDir: string;
  /**
   * Özgün depo. Proje profili (`.nexcode/CONTEXT.md`) burada okunur ve buraya yazılır;
   * worktree'ye yazılırsa görev bitiminde ağaçla birlikte kaybolur. Verilmezse `workingDir`.
   */
  projectDir?: string;
  /** Proje profilini bu görev için atla. */
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
  /** Canlı terminal görünümü için akan çıktı. */
  onChunk: (chunk: string, stream: "stdout" | "stderr") => void;
}

export type InvokeResult =
  | { ok: true; text: string; calls: number; usdCost: number }
  | { ok: false; failure: FailureInput; calls: number; usdCost: number };

/** Motorun dış dünyaya bağlandığı tek nokta. */
export interface EngineDeps {
  config: () => NexcodeConfig;
  events: EngineEventBus;
  /** Bir agent'ı (API adapter ya da CLI süreci) çalıştırır. */
  invoke: (input: InvokeInput) => Promise<InvokeResult>;
  /** `roles/<file>` içeriğini döndürür. */
  loadRole: (roleFile: string) => Promise<string>;
  /** Göreve göre skorlanmış beceri kısa listesi. */
  matchSkills: (goal: string, kind: AssignmentKind) => Promise<SkillHint[]>;
  /** Çalışma klasörünün `.nexcode/CONTEXT.md` profili. */
  loadProjectContext: (workingDir: string) => Promise<string>;
  /** Bütçeyi aşan görev metnini çalışma klasörüne yazar. */
  writeSpill: (workingDir: string, relativePath: string, content: string) => Promise<void>;
  /** Görev öncesi checkpoint; `versioning` kapalıysa çağrılmaz. */
  createCheckpoint?: (taskId: string, workingDir: string) => Promise<void>;
  /** Canlı diff taramasını başlatır; durdurma fonksiyonu döner. */
  startLiveDiff?: (taskId: string, workingDir: string) => Promise<() => Promise<FileChangeSummary[]>>;
  /**
   * Doğrulama kapısı. Verilmezse kapı hiç çalışmaz ve önceki davranış birebir korunur.
   * Kapı, turun tüm atamaları bittikten sonra ve tamamlama kararlarından ÖNCE koşar.
   */
  verifyGate?: VerifyGate;
  /** Riskli plan için insan onayı ister. */
  requestApproval?: (input: { taskId: string; planSummary: string; planHash: string }) => Promise<boolean>;
  /** Görev bitiminde proje profilini revize eder. */
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
 * Kriptografik olmayan, kararlı 64-bit FNV-1a. Onay kuyruğundaki planın değişip
 * değişmediğini tespit etmek için kullanılır — güvenlik sınırı değil, kurcalama tespitidir.
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

/** Plan metni riskli bir işlem içeriyor mu (yalnızca `approvalMode: "ask"` için anlamlı). */
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

  /** Yeni bir oturum başlarken karantina ve sayaçları sıfırlar. */
  resetSession(callsToday = 0): void {
    this.quarantine.clear();
    this.callsToday = callsToday;
  }

  /**
   * Tek bir görevi uçtan uca yürütür.
   *
   * Otonom onay alınmadan çalıştırılamaz; günlük çağrı bütçesi aşıldığında görev
   * başlatılmaz. Her iki durumda da neden kullanıcıya `log` olayı olarak bildirilir.
   */
  async runTask(task: EngineTask): Promise<TaskOutcome> {
    const config = this.deps.config();
    const now = this.deps.now ?? (() => new Date());
    const sleep = this.deps.sleep ?? defaultSleep;
    const warnings: string[] = [];

    if (config.autonomousConsentAcceptedAt === null) {
      return this.abort(task, "Otonom çalışma onayı alınmadan motor başlatılamaz.", warnings);
    }
    if (this.callsToday >= config.dailyCallBudget) {
      return this.abort(
        task,
        `Günlük çağrı bütçesi (${String(config.dailyCallBudget)}) doldu; görev başlatılmadı.`,
        warnings,
      );
    }

    const operatorId = resolveOperatorId(config);
    const operator = operatorId === null ? undefined : config.agents[operatorId];
    if (operator === undefined) {
      return this.abort(task, "Etkin bir operatör agent'ı yok; görev başlatılamaz.", warnings);
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

      // Görev metni bütçeyi aşıyorsa tam metin çalışma klasörüne taşınır.
      const digest = digestTaskPrompt(task.id, task.prompt, config.taskPromptCharBudget);
      if (digest.spill !== null) {
        await this.deps.writeSpill(task.workingDir, digest.spill.relativePath, digest.spill.content);
        warnings.push(`Görev metni ${digest.spill.relativePath} dosyasına taşındı.`);
      }

      if (config.versioning && this.deps.createCheckpoint !== undefined) {
        await this.deps.createCheckpoint(task.id, task.workingDir);
      }
      if (config.liveDiff && this.deps.startLiveDiff !== undefined) {
        stopLiveDiff = await this.deps.startLiveDiff(task.id, task.workingDir);
      }

      const operatorRole = await this.deps.loadRole(config.operator.roleFile);
      // Proje profili özgün depoda tutulur; izole ağaç görev bitiminde silinebilir.
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

        const catalog = buildCatalog({ config, quarantined: this.quarantine.ids });
        const skills = config.skills.autoMatch ? await this.deps.matchSkills(task.prompt, "plan") : [];

        // ── Operatör kararı (protokol hatasında sınırlı tekrar) ──
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
            this.deps.events.emit("log", task.id, { level: "error", message: "Operatör çağrısı başarısız", detail: summary }, now);
            return this.finish(task, "failed", summary, "", "", round, delegations, calls, usdCost, files, warnings);
          }

          const parsed = parseOperatorDecision(result.text);
          if (parsed.ok) {
            decision = parsed.decision;
            break;
          }
          repair = protocolRepairInstruction(parsed.error);
          warnings.push(`Operatör protokol hatası (deneme ${String(attempt + 1)}): ${parsed.error}`);
          this.deps.events.emit("log", task.id, { level: "warn", message: "Protokol hatası", detail: parsed.error }, now);
        }

        if (decision === null) {
          const message = "Operatör, izin verilen deneme sayısında geçerli bir karar üretemedi.";
          return this.finish(task, "failed", message, "", "", round, delegations, calls, usdCost, files, warnings);
        }

        if (decision.status === "blocked") {
          const text = `${decision.blocked}${decision.needed === "" ? "" : `\n\nGereken: ${decision.needed}`}`;
          return this.finish(task, "blocked", text, "", "", round, delegations, calls, usdCost, files, warnings);
        }

        if (decision.status === "complete") {
          // Çalıştırılmış kanıt modelin beyanının önündedir: kırmızı kapıya rağmen verilen
          // "tamamlandı" kararı BİR kez reddedilir ve düzeltme turu zorlanır. İkinci kez
          // gelirse teslimat uyarıyla yapılır; saatlerce süren iş çöpe atılmaz.
          if (!completionRejected && this.deps.verifyGate?.isBlocking(config, verify) === true) {
            completionRejected = true;
            const reason = verifySummary(verify);
            warnings.push(`Kırmızı doğrulama kapısına rağmen tamamlama kararı reddedildi: ${reason}`);
            this.deps.events.emit(
              "log",
              task.id,
              { level: "warn", message: "Doğrulama kapısı teslimatı engelledi", detail: reason },
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

        // ── Atama normalizasyonu ve rol zinciri ──
        const normalized = normalizeAssignments(decision.assignments, catalog, policy);
        warnings.push(...normalized.warnings);
        const chained = enforceRoleChain(normalized.assignments, catalog, policy, round);
        warnings.push(...chained.warnings);
        const assignments = chained.assignments;

        if (assignments.length === 0) {
          const message = "Operatör planı yürütülebilir hiçbir atama içermiyor.";
          return this.finish(task, "failed", message, "", "", round, delegations, calls, usdCost, files, warnings);
        }

        // ── Onay kapısı ──
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
              "Riskli plan kullanıcı tarafından reddedildi.",
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

        // ── Delegasyonların yürütülmesi ──
        const roundRecords: AssignmentRecord[] = [];
        for (const batch of parallelBatches(assignments)) {
          const settled = await Promise.all(
            batch.map(async (assignment) => {
              // Bağımlı olduğu iş başarısızsa bu işi hiç başlatma.
              const blockedBy = assignment.dependsOn.filter((dep) =>
                [...history, ...roundRecords].some((r) => r.assignment.id === dep && r.status === "failed"),
              );
              if (blockedBy.length > 0) {
                return {
                  assignment,
                  status: "failed" as const,
                  output: `Bağımlı olduğu iş başarısız oldu: ${blockedBy.join(", ")}`,
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

        // ── Doğrulama kapısı: tek çağrı noktası, tamamlama kararlarından ÖNCE ──
        if (this.deps.verifyGate !== undefined) {
          verify = await this.deps.verifyGate.run(config, task.workingDir);
          if (verify.ran) {
            this.deps.events.emit(
              "log",
              task.id,
              {
                level: verify.ok ? "info" : "warn",
                message: "Doğrulama kapısı",
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

        // ── PASS hızlı yolu: ikinci operatör çağrısını atla ──
        // Kırmızı kapı bu kestirmeyi kapatır; karar operatöre gider.
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
            ? "Tur sınırına ulaşıldı; iş kısmen tamamlandı."
            : "Tur sınırına ulaşıldı; teslimat mevcut haliyle sunuluyor.";
          // Tur bütçesi bittiğinde kırmızı kapı işi çöpe atmaz, kalan riske yazılır.
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
        "Tur bütçesi tükendi.",
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

  /** Bir atamayı yürütür; kurtarma politikasını (yeniden deneme / devir) uygular. */
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
          output: "Agent profili bulunamadı.",
          verdict: null,
          calls,
          usdCost,
        };
      }

      // Rol metni agent profilinden çözülür; devir sonrası yeni agent'ın rolü geçerlidir.
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

      // ── Kurtarma ──
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
        { level: "warn", message: `Delegasyon başarısız (${failure})`, detail: decision.reason },
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
          instruction: `${current.instruction}\n\n[Not: önceki agent bu işi tamamlayamadı (${failure}). Baştan ele al.]`,
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

    // Günlük bütçe sayacı tek noktadan beslenir — operatör ve uzman çağrıları dahil.
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
    // Profil özgün depoya yazılır; izole ağaç görev sonrası kaldırılabilir.
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
// Yardımcılar
// ─────────────────────────────────────────────────────────────────────────────

/** Proje profilinin okunup yazılacağı dizin: izolasyon varken özgün depo. */
function projectDirOf(task: EngineTask): string {
  return task.projectDir ?? task.workingDir;
}

/** Modelin doğrulama beyanına, gerçekten çalıştırılmış kapının sonucunu ekler. */
function mergeVerification(modelClaim: string, verify: VerifyReport): string {
  if (!verify.ran) return modelClaim;
  const gate = verifySummary(verify);
  return modelClaim.trim() === "" ? gate : `${modelClaim.trim()}\n\n${gate}`;
}

/** Kırmızı kapı, teslim edilen işin kalan riskine açıkça yazılır. */
function mergeRisk(modelRisk: string, verify: VerifyReport): string {
  if (!verify.ran || verify.ok) return modelRisk;
  const gate = verifySummary(verify);
  return modelRisk.trim() === "" ? gate : `${modelRisk.trim()}; ${gate}`;
}

function describeFailure(failure: FailureInput, agent: AgentProfile): string {
  const parts = [`${agent.name} işi tamamlayamadı: ${failure.message}`];
  if (failure.stderr !== undefined && failure.stderr.trim() !== "") {
    parts.push(failure.stderr.trim().slice(0, 500));
  }
  return parts.join("\n");
}

function summarizeHistory(history: readonly AssignmentRecord[]): string {
  if (history.length === 0) return "";
  return history
    .map((record) => {
      const status = record.status === "completed" ? "TAMAMLANDI" : "BAŞARISIZ";
      const verdict = record.verdict === null ? "" : ` · VERDICT: ${record.verdict}`;
      return [
        `── ${record.assignment.id} (${record.assignment.kind} · ${record.assignment.agentName}) — ${status}${verdict}`,
        record.output.trim(),
      ].join("\n");
    })
    .join("\n\n");
}

function summarizeDelivery(records: readonly AssignmentRecord[]): string {
  const implementations = records.filter((r) => r.assignment.kind === "implement" && r.status === "completed");
  const source = implementations.length > 0 ? implementations : records.filter((r) => r.status === "completed");
  if (source.length === 0) return "Teslim edilebilir çıktı üretilmedi.";
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
