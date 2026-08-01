import type { NexcodeConfig } from "../config/schema";
import type { EngineEventBus } from "./events";
import type { EngineTask, TaskOutcome } from "./engine";

/**
 * Kuyruk süpervizörü.
 *
 * Motorun kendisi tek bir görevi yürütür. Süpervizör ise kuyruğu okur, `maxConcurrentTasks`
 * kadar worker slotu doldurur ve toplu durumu yayınlar. Görev yürütmenin nasıl yapıldığı
 * (izole ağaç kurulumu, motor örneği, teslimat, temizlik) `runTask` port'una aittir; bu sınıf
 * yalnızca eşzamanlılık politikasını bilir.
 *
 * Değişmezler:
 *
 * 1. **Aynı görev iki slota düşmez.** `claimNext` çalışan id'leri alır ve onları atlar.
 * 2. **Bir slotun hatası diğerlerini düşürmez.** Slot hatası yakalanır, olay olarak yayılır
 *    ve slot serbest bırakılır.
 * 3. **Paralellik izolasyon ister.** `maxConcurrentTasks > 1` yalnızca `worktree.mode: "task"`
 *    iken anlamlıdır; `normalizeConfig` bunu zaten 1'e düşürür, süpervizör de savunmacı davranır.
 * 4. **`stop()` işi yarıda kesmez.** Yeni görev alınmaz ve uçuştaki görevler beklenir.
 */

export interface SupervisorPorts {
  config: () => NexcodeConfig;
  events: EngineEventBus;
  /**
   * Kuyruktan sıradaki bekleyen görevi sahiplenir. `activeIds` halihazırda koşan görevlerdir
   * ve atlanmalıdır. Uygun görev yoksa `null` döner.
   */
  claimNext: (activeIds: readonly string[]) => Promise<EngineTask | null>;
  /** Tek bir görevi uçtan uca yürütür (izolasyon kurulumu ve temizliği dahil). */
  runTask: (task: EngineTask) => Promise<TaskOutcome>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface SupervisorStatus {
  running: boolean;
  /** Şu an yürütülen görev id'leri. */
  activeIds: string[];
  /** Yapılandırmadan gelen etkin slot sayısı. */
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

  /** Kuyruk döngüsünü başlatır. Zaten çalışıyorsa hiçbir şey yapmaz. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.emitStatus();
    this.loopPromise = this.loop();
  }

  /**
   * Yeni görev almayı durdurur ve uçuştaki görevlerin bitmesini bekler.
   *
   * Çalışan agent süreçleri yarıda kesilmez: yarım kalan iş, yarım kalan dosya değişikliği
   * demektir. Kullanıcı gerçekten iptal istiyorsa bu ayrı bir eylemdir.
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

  /** Bekleme aralığını erkenden keser (yeni görev eklendiğinde çağrılır). */
  wake(): void {
    this.wakeUp?.();
  }

  private concurrency(): number {
    const cfg = this.ports.config();
    // İzolasyon olmadan paralellik çalışma ağacını bozar; savunmacı olarak 1'e düşürülür.
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

      // İş dağıttıysak hemen tekrar bak: kuyrukta devamı olabilir ve slot boşalmış olabilir.
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
      // Slot boşaldı: döngü beklemedeyse hemen yeni görev alsın.
      this.wake();
    });
  }

  private async runSlot(task: EngineTask): Promise<void> {
    try {
      await this.ports.runTask(task);
    } catch (error) {
      // Bir slotun çökmesi diğer slotları ve kuyruğu düşürmez.
      this.ports.events.emit(
        "log",
        task.id,
        { level: "error", message: "Görev yürütülemedi", detail: String(error) },
        this.ports.now,
      );
    }
  }

  /** `pollSeconds` kadar bekler; `wake()` çağrılırsa erken döner. */
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
   * Toplu slot durumunu yayınlar.
   *
   * `currentTaskId` tekil kalır (ilk aktif görev), böylece tek görev varsayan arayüzler
   * değişmeden çalışır; `activeTaskIds` ve `concurrency` eşzamanlı görünüm için eklenir.
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
