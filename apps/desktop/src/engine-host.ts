import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Engine,
  EngineEventBus,
  EngineSupervisor,
  VerifyGate,
  WorktreeManager,
  Checkpoints,
  effectiveInvocation,
  materializePrompt,
  SkillRegistry,
  silenceSecondsFor,
  logger,
  type EngineDeps,
  type EngineEvent,
  type EngineTask,
  type InvokeInput,
  type InvokeResult,
  type NexcodeConfig,
  type TaskOutcome,
  type AgentProfile,
} from "@nexcode/core";
import type { ConfigRepository, EngineRepository, SqliteCheckpointStore } from "@nexcode/core/db";
import { nodeVerifyPort, nodeWorktreePort, runProcess } from "./process-ports";

/**
 * Motorun masaüstü konağı.
 *
 * Çekirdeğin saf parçalarını (motor, süpervizör, worktree, doğrulama kapısı, checkpoint)
 * gerçek süreçler, dosya sistemi ve veritabanıyla birleştirir. Bir görevin tam yaşam
 * döngüsü buradadır:
 *
 *   izole ağaç kur -> motoru çalıştır -> branch'e commit'le -> ağacı temizle
 *
 * Olaylar hem kalıcı geçmişe yazılır hem de renderer'a itilir; ikisi aynı `seq` numarasını
 * paylaşır, böylece sayfa açılışındaki replay canlı olayları tekilleştirebilir.
 */

export interface EngineHostOptions {
  repo: EngineRepository;
  configRepo: ConfigRepository;
  checkpointStore: SqliteCheckpointStore;
  /** İzole ağaçların açılacağı kök (kullanıcının proje klasörünün dışında). */
  worktreeRoot: string;
  /** Paketle gelen rol ve beceri dosyalarının kökü. */
  resourcesDir: string;
  /** Olayları renderer'a iletir. */
  broadcast: (event: EngineEvent) => void;
  /** Riskli plan onayı ister; kullanıcı yanıtlayana kadar bekler. */
  requestApproval: (input: { taskId: string; planSummary: string; planHash: string }) => Promise<boolean>;
}

export class EngineHost {
  readonly events = new EngineEventBus();
  private readonly supervisor: EngineSupervisor;
  private readonly worktree: WorktreeManager;
  private readonly verifyGate: VerifyGate;
  private readonly checkpoints: Checkpoints;
  private readonly skills: SkillRegistry;

  constructor(private readonly options: EngineHostOptions) {
    this.worktree = new WorktreeManager({ port: nodeWorktreePort, root: options.worktreeRoot });
    this.verifyGate = new VerifyGate(nodeVerifyPort);
    this.skills = new SkillRegistry(
      { listSkillFiles: () => Promise.resolve(readSkillFiles(path.join(options.resourcesDir, "skills"))) },
      () => this.config(),
    );
    this.checkpoints = new Checkpoints(options.checkpointStore, {
      retention: options.configRepo.load().versioningRetention,
    });

    // Olay akışı: önce kalıcı geçmişe, sonra arayüze.
    this.events.subscribe((event) => {
      try {
        this.options.repo.appendEvent(event);
      } catch (error) {
        logger.warn("engine.event.persist_failed", { seq: event.seq, error: String(error) });
      }
      this.options.broadcast(event);
    });

    this.supervisor = new EngineSupervisor({
      config: () => this.config(),
      events: this.events,
      claimNext: (activeIds) => Promise.resolve(this.claimNext(activeIds)),
      runTask: (task) => this.runTask(task),
    });
  }

  start(): void {
    this.supervisor.start();
  }

  stop(): Promise<void> {
    return this.supervisor.stop();
  }

  /** Yeni görev eklendiğinde bekleme aralığını keser. */
  wake(): void {
    this.supervisor.wake();
  }

  status() {
    return this.supervisor.status();
  }

  get isIdle(): boolean {
    return this.supervisor.status().activeIds.length === 0;
  }

  listCheckpoints(workingDir: string) {
    return this.checkpoints.list(workingDir);
  }

  /** Geri yükleme yalnızca motor boştayken yapılır; çalışan agent'ın altından dosya çekilmez. */
  restoreCheckpoint(id: string) {
    return this.checkpoints.restore(id, this.isIdle);
  }

  private config(): NexcodeConfig {
    return this.options.configRepo.load();
  }

  /** Kuyruktan sıradaki görevi alır ve running olarak işaretler. */
  private claimNext(activeIds: readonly string[]): EngineTask | null {
    const task = this.options.repo.claimNext(activeIds);
    if (task === null) return null;

    this.options.repo.markRunning(task.id);
    this.broadcastQueue();
    return {
      id: task.id,
      prompt: task.prompt,
      executionMode: task.executionMode,
      workingDir: task.workingDir === "" ? this.config().workingDir : task.workingDir,
    };
  }

  /**
   * Bir görevi uçtan uca yürütür.
   *
   * İzole ağaç kurulumu ve temizliği motorun dışındadır: motor yalnızca kendisine verilen
   * `workingDir` içinde çalışır ve izolasyonun varlığından habersizdir.
   */
  private async runTask(task: EngineTask): Promise<TaskOutcome> {
    const cfg = this.config();
    const setup = await this.worktree.setup(task.id, task.workingDir, cfg);

    for (const warning of setup.warnings) {
      this.events.emit("log", task.id, { level: "warn", message: "İzolasyon", detail: warning });
    }

    const engine = new Engine(this.buildDeps());
    engine.resetSession(this.options.repo.callsToday());

    const outcome = await engine.runTask({
      ...task,
      workingDir: setup.workingDir,
      projectDir: setup.projectDir,
    });

    const delivery = await this.worktree.finalize({
      setup,
      cfg,
      taskTitle: task.prompt.split(/\r?\n/)[0] ?? task.prompt,
      summary: outcome.final,
    });

    if (delivery !== null) {
      const detail =
        delivery.committed && delivery.commit !== null
          ? `${delivery.branch} (${delivery.commit.slice(0, 8)})`
          : delivery.branch;
      this.events.emit("log", task.id, { level: "info", message: "Teslimat branch'i", detail });
      for (const warning of delivery.warnings) {
        this.events.emit("log", task.id, { level: "warn", message: "Teslimat", detail: warning });
      }
    }

    await this.worktree.cleanup(setup, cfg, outcome.outcome);

    this.options.repo.complete(task.id, {
      status: outcome.outcome,
      delivery: outcome.final,
      verification: outcome.verification,
      remainingRisk: outcome.remainingRisk,
      rounds: outcome.rounds,
      delegations: outcome.delegations,
      calls: outcome.calls,
      usdCost: outcome.usdCost,
      changedFiles: outcome.files.length,
    });
    this.options.repo.setCallsToday(this.options.repo.callsToday() + outcome.calls);
    this.broadcastQueue();

    return outcome;
  }

  private broadcastQueue(): void {
    this.events.emit("queue", null, this.options.repo.queueSnapshot());
  }

  private buildDeps(): EngineDeps {
    return {
      config: () => this.config(),
      events: this.events,
      invoke: (input) => this.invoke(input),
      loadRole: (roleFile) => Promise.resolve(this.readRole(roleFile)),
      matchSkills: (goal, kind) => this.skills.match(goal, kind),
      loadProjectContext: (dir) => Promise.resolve(readTextOr(path.join(dir, ".nexcode", "CONTEXT.md"), "")),
      writeSpill: (dir, relativePath, content) => {
        const target = path.join(dir, relativePath);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
        return Promise.resolve();
      },
      createCheckpoint: async (taskId, workingDir) => {
        await this.checkpoints.capture(taskId, workingDir);
      },
      verifyGate: this.verifyGate,
      requestApproval: this.options.requestApproval,
      reviseProjectContext: (dir, delivery) => {
        const target = path.join(dir, ".nexcode", "CONTEXT.md");
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, delivery, "utf8");
        return Promise.resolve();
      },
    };
  }

  private readRole(roleFile: string): string {
    const cfg = this.config();
    const language = cfg.language === "tr" ? "tr" : "en";
    const localized = path.join(this.options.resourcesDir, "roles", language, roleFile);
    const fallback = path.join(this.options.resourcesDir, "roles", "en", roleFile);
    return readTextOr(localized, readTextOr(fallback, `# ${roleFile}`));
  }

  /**
   * Bir agent'ı çalıştırır.
   *
   * CLI profilleri kullanıcının kendi oturumuyla süreç olarak koşar; API profilleri
   * sağlayıcı adapter'ına gider. Hangi yolun seçileceği agent profilindeki `adapter`
   * alanına bağlıdır.
   */
  private async invoke(input: InvokeInput): Promise<InvokeResult> {
    const cfg = this.config();
    const agent = input.agent;

    if (agent.cmd === undefined || agent.cmd === "") {
      return { ok: false, failure: { message: `Agent profilinde komut tanımlı değil: ${agent.id}` }, calls: 0, usdCost: 0 };
    }

    const invocation = effectiveInvocation({
      adapter: agent.adapter,
      profileArgs: agent.args,
      // Keşfin yazdığı model önerisi global CLI ayarını ezemez; yalnızca açık kullanıcı
      // seçimi (`modelOverride`) override sayılır.
      agentModel: agent.modelOverride && agent.model !== undefined ? agent.model.modelId : "",
      globalModel: globalModelFor(cfg, agent),
    });

    // `{PROMPT_FILE}` kullanan adapter'lar için geçici dosya; her çıkış yolunda temizlenir.
    let promptDir: string | null = null;
    let promptFile: string | null = null;
    if (invocation.promptMode === "file") {
      promptDir = mkdtempSync(path.join(tmpdir(), "nexcode-prompt-"));
      promptFile = path.join(promptDir, "prompt.md");
      writeFileSync(promptFile, input.prompt, "utf8");
    }

    try {
      const args = materializePrompt(invocation.args, input.prompt, promptFile);
      const result = await runProcess({
        command: agent.cmd,
        args,
        cwd: input.workingDir,
        timeoutMs: input.timeoutSeconds * 1000,
        silenceMs: Math.min(input.silenceSeconds, silenceSecondsFor(agent.adapter)) * 1000,
        env: invocation.env,
        onChunk: input.onChunk,
        // `stdin` modunda prompt argümana değil standart girdiye yazılır.
        ...(invocation.promptMode === "stdin" ? { stdin: input.prompt } : {}),
      });

      if (!result.ok) {
        return {
          ok: false,
          failure: {
            message: result.stderr.trim() === "" ? result.stdout.trim() : result.stderr.trim(),
            timedOut: result.timedOut === true,
          },
          calls: 1,
          usdCost: 0,
        };
      }

      return { ok: true, text: result.stdout, calls: 1, usdCost: 0 };
    } finally {
      if (promptDir !== null) rmSync(promptDir, { recursive: true, force: true });
    }
  }
}

/** CLI-geneli model ayarı; katalog dışı adapter'larda boş kalır. */
function globalModelFor(cfg: NexcodeConfig, agent: AgentProfile): string {
  const adapter = agent.adapter;
  if (adapter === undefined || adapter === "custom") return "";
  return cfg.cliSettings[adapter]?.model ?? "";
}

/** Paketle gelen beceri dosyalarını okur; klasör yoksa boş katalogla devam edilir. */
function readSkillFiles(dir: string): Array<{ path: string; raw: string }> {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => ({ path: path.join(dir, name), raw: readFileSync(path.join(dir, name), "utf8") }));
  } catch {
    return [];
  }
}

function readTextOr(file: string, fallback: string): string {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : fallback;
  } catch {
    return fallback;
  }
}
