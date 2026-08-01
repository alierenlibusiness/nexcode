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
  normalizeCliOutput,
  SkillRegistry,
  LiveDiffTracker,
  buildFileChangeEvent,
  silenceSecondsFor,
  logger,
  type FileChangeSummary,
  type WorkspaceReader,
  type EngineDeps,
  type EngineEvent,
  type EngineTask,
  type InvokeInput,
  type InvokeResult,
  type NexcodeConfig,
  type TaskOutcome,
  type AgentProfile,
} from "../index";
import { discoverClis, syncDiscoveredAgents } from "../providers/node";
import type { ConfigRepository, EngineRepository, SqliteCheckpointStore } from "../db/index";
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

    this.refreshAgents();
  }

  /**
   * Kurulu CLI'ları tarar ve agent kataloğunu tazeler.
   *
   * Paketle gelen profiller yalnızca hangi adapter'ı kullanacaklarını bilir; komut yolu
   * makineye göre değişir. Bu adım olmadan her görev "komut tanımlı değil" diyerek düşer.
   * Kurulum sırasında bir kez değil, her açılışta çalışır: CLI yolu güncellemeyle değişebilir.
   */
  refreshAgents(): void {
    try {
      const config = this.config();
      const result = syncDiscoveredAgents(config, discoverClis());
      if (result.added.length === 0 && result.removed.length === 0 && result.linked.length === 0) return;

      this.options.configRepo.save({ ...config, agents: result.agents });
      logger.info("agents.synced", { added: result.added, removed: result.removed, linked: result.linked });
    } catch (error) {
      // Keşif başarısız olursa uygulama açılmaya devam eder; doctor sorunu raporlar.
      logger.warn("agents.sync_failed", { error: String(error) });
    }
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
      agentHealth: () => this.runnableAgents(),
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
      startLiveDiff: (taskId, workingDir) => this.startLiveDiff(taskId, workingDir),
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

  /**
   * Canlı satır diff'ini başlatır.
   *
   * Görev başındaki içerik yakalanır, sonra periyodik tarama değişiklikleri `filechange`
   * olayı olarak yayınlar. Dönen fonksiyon taramayı durdurur ve son durumu üretir; görev
   * bittiği anda son diff kaybolmasın diye kapanışta bir kez daha taranır.
   */
  private async startLiveDiff(
    taskId: string,
    workingDir: string,
  ): Promise<() => Promise<FileChangeSummary[]>> {
    const tracker = new LiveDiffTracker(this.workspaceReader(), workingDir);
    await tracker.capture();

    let latest: FileChangeSummary[] = [];
    let scanning = false;

    const publish = async (): Promise<FileChangeSummary[]> => {
      // Yeniden giriş kilidi: yavaş bir tarama bir sonrakiyle üst üste binmemeli.
      if (scanning) return latest;
      scanning = true;
      try {
        latest = await tracker.scan();
        this.events.emit("filechange", taskId, buildFileChangeEvent(taskId, latest));
      } catch (error) {
        logger.warn("live_diff.scan_failed", { taskId, error: String(error) });
      } finally {
        scanning = false;
      }
      return latest;
    };

    const intervalMs = Math.max(500, this.config().liveDiffIntervalMs);
    const timer = setInterval(() => void publish(), intervalMs);
    timer.unref();

    return async () => {
      clearInterval(timer);
      return await publish();
    };
  }

  /** Canlı diff için salt-okunur çalışma klasörü erişimi. */
  private workspaceReader(): WorkspaceReader {
    return {
      listFiles: (root) => this.options.checkpointStore.listFiles(root),
      readFile: async (root, relativePath) => {
        const content = await this.options.checkpointStore.readFile(root, relativePath);
        // İçeriği okunamayan dosya (ikili, hassas, sınır aşan) `null` içerikle bildirilir;
        // varlığı bilinir ama gövdesi olaya girmez.
        return { content, bytes: content === null ? 0 : Buffer.byteLength(content, "utf8") };
      },
    };
  }

  /**
   * Hangi profillerin gerçekten çalıştırılabildiği.
   *
   * Bu konak agent'ları CLI süreci olarak koşar, dolayısıyla komutu olmayan profil
   * çalıştırılamaz. Katalogdan düşürülmezse operatör ona iş verir, iş "komut tanımlı
   * değil" ile düşer ve bir tur boşa gider. `refreshAgents` kurulu adapter'ların
   * komutunu doldurur; doldurulamayanlar burada elenir.
   */
  private runnableAgents(): Record<string, boolean> {
    const health: Record<string, boolean> = {};
    for (const [id, profile] of Object.entries(this.config().agents)) {
      health[id] = profile.cmd !== undefined && profile.cmd.trim() !== "";
    }
    return health;
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

      // CLI kendi zarfını döndürür; asıl metin ve gerçek maliyet buradan ayıklanır.
      const output = normalizeCliOutput(agent.adapter, result.stdout);

      if (!result.ok) {
        const stderr = result.stderr.trim();
        return {
          ok: false,
          failure: {
            message: stderr === "" ? (output.error ?? output.text) : stderr,
            timedOut: result.timedOut === true,
          },
          calls: 1,
          usdCost: output.usdCost,
        };
      }

      // Süreç 0 dönse bile CLI işi hata olarak bitirmiş olabilir (kota, auth, sağlayıcı).
      if (output.error !== null) {
        return { ok: false, failure: { message: output.error }, calls: 1, usdCost: output.usdCost };
      }

      return { ok: true, text: output.text, calls: 1, usdCost: output.usdCost };
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
