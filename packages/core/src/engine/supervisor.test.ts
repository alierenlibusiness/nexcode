import { describe, expect, it } from "vitest";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { EngineSupervisor, type SupervisorPorts } from "./supervisor";
import { EngineEventBus, type EngineEvent } from "./events";
import type { EngineTask, TaskOutcome } from "./engine";

/**
 * Süpervizör yalnızca eşzamanlılık politikasını bilir: slot doldurma, sahiplenme ve
 * durdurma. Görevin nasıl yürütüldüğü `runTask` port'una aittir.
 */

function config(over: Partial<NexcodeConfig> = {}): NexcodeConfig {
  return normalizeConfig({
    ...FALLBACK_CONFIG,
    autonomousConsentAcceptedAt: "2026-07-25T00:00:00.000Z",
    pollSeconds: 1,
    ...over,
  });
}

/** İzolasyon açık ve N slotlu yapılandırma (normalizasyon aksi halde 1'e düşürür). */
function concurrent(slots: number): NexcodeConfig {
  return config({ maxConcurrentTasks: slots, worktree: { ...FALLBACK_CONFIG.worktree, mode: "task" } });
}

function outcome(taskId: string): TaskOutcome {
  return {
    taskId,
    outcome: "done",
    final: "bitti",
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
  /** Kuyruğa konacak görev id'leri. */
  queue?: string[];
  /** Bu id'lerde runTask hata fırlatır. */
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
  /** Görev id'sine göre "işi bitir" tetikleyicisi: eşzamanlılık deterministik ölçülür. */
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
        prompt: `görev ${next}`,
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
      if (options.throwing?.includes(task.id) === true) throw new Error(`patladı: ${task.id}`);
      return outcome(task.id);
    },
    sleep: () => Promise.resolve(),
    now: () => new Date("2026-07-25T12:00:00.000Z"),
  };

  const supervisor = new EngineSupervisor(ports);

  /** Bir görevin yürütmesini tamamlar ve olay döngüsünün ilerlemesine izin verir. */
  async function finish(id: string): Promise<void> {
    release.get(id)?.();
    release.delete(id);
    await tick();
  }

  return { supervisor, started, finished, claimSkips, events, finish, peak: () => peakInFlight, queue };
}

/** Mikro görev kuyruğunun boşalmasını bekler. */
async function tick(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("EngineSupervisor: slot yönetimi", () => {
  it("tek slotta görevleri sırayla koşar", async () => {
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

  it("izolasyon açıkken slot sayısı kadar görevi paralel koşar", async () => {
    const h = harness({ cfg: concurrent(3), queue: ["a", "b", "c", "d"] });
    h.supervisor.start();
    await tick();

    expect(h.started).toEqual(["a", "b", "c"]);
    expect(h.supervisor.status().activeIds).toEqual(["a", "b", "c"]);
    expect(h.supervisor.status().freeSlots).toBe(0);

    // Bir slot boşalınca sıradaki görev hemen alınır.
    await h.finish("a");
    expect(h.started).toEqual(["a", "b", "c", "d"]);
    expect(h.peak()).toBe(3);

    for (const id of ["b", "c", "d"]) await h.finish(id);
    await h.supervisor.stop();
  });

  it("izolasyon kapalıyken paralellik istense de tek slota düşer", async () => {
    // normalizeConfig zaten 1'e düşürür; süpervizör de savunmacı davranır.
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

  it("aynı görevi iki slota vermez: koşan id'ler sahiplenmede atlanır", async () => {
    const h = harness({ cfg: concurrent(2), queue: ["a", "b"] });
    h.supervisor.start();
    await tick();

    // İkinci sahiplenme çağrısı ilk görevi zaten aktif olarak bildirir.
    expect(h.claimSkips.some((skips) => skips.includes("a"))).toBe(true);
    expect(new Set(h.started).size).toBe(h.started.length);

    await h.finish("a");
    await h.finish("b");
    await h.supervisor.stop();
  });

  it("kuyruk boşken slot tüketmez", async () => {
    const h = harness({ cfg: concurrent(2) });
    h.supervisor.start();
    await tick();

    expect(h.started).toEqual([]);
    expect(h.supervisor.status().freeSlots).toBe(2);
    await h.supervisor.stop();
  });
});

describe("EngineSupervisor: dayanıklılık", () => {
  it("bir slotun hatası diğer slotları ve kuyruğu düşürmez", async () => {
    const h = harness({ cfg: concurrent(2), queue: ["kotu", "iyi", "sonraki"], throwing: ["kotu"] });
    h.supervisor.start();
    await tick();

    expect(h.started).toEqual(["kotu", "iyi"]);

    await h.finish("kotu");
    // Hata yakalandı, olay olarak yayıldı ve slot serbest bırakıldı.
    expect(h.events.some((e) => e.type === "log" && e.payload.message === "Görev yürütülemedi")).toBe(true);
    expect(h.started).toContain("sonraki");
    expect(h.supervisor.isRunning).toBe(true);

    await h.finish("iyi");
    await h.finish("sonraki");
    await h.supervisor.stop();
  });

  it("stop uçuştaki görevi yarıda kesmez, bitmesini bekler", async () => {
    const h = harness({ queue: ["a"] });
    h.supervisor.start();
    await tick();
    expect(h.started).toEqual(["a"]);

    let stopped = false;
    const stopping = h.supervisor.stop().then(() => {
      stopped = true;
    });

    await tick();
    // Görev hâlâ koşuyor: stop beklemede.
    expect(stopped).toBe(false);
    expect(h.finished).toEqual([]);

    await h.finish("a");
    await stopping;

    expect(stopped).toBe(true);
    expect(h.finished).toEqual(["a"]);
    expect(h.supervisor.isRunning).toBe(false);
  });

  it("durdurulduktan sonra kuyruktan yeni görev almaz", async () => {
    const h = harness({ queue: ["a", "b"] });
    h.supervisor.start();
    await tick();

    const stopping = h.supervisor.stop();
    await h.finish("a");
    await stopping;

    expect(h.started).toEqual(["a"]);
    expect(h.queue).toEqual(["b"]);
  });

  it("iki kez start çağrılması ikinci bir döngü açmaz", async () => {
    const h = harness({ queue: ["a"] });
    h.supervisor.start();
    h.supervisor.start();
    await tick();

    expect(h.started).toEqual(["a"]);
    await h.finish("a");
    await h.supervisor.stop();
  });

  it("çalışmayan süpervizörde stop güvenle döner", async () => {
    const h = harness();
    await expect(h.supervisor.stop()).resolves.toBeUndefined();
  });
});

describe("EngineSupervisor: durum yayını", () => {
  it("aktif görevleri ve slot sayısını status olayında bildirir", async () => {
    const h = harness({ cfg: concurrent(2), queue: ["a", "b"] });
    h.supervisor.start();
    await tick();

    const status = h.events.filter((e) => e.type === "status");
    const last = status[status.length - 1];
    expect(last?.payload).toMatchObject({ activeTaskIds: ["a", "b"], concurrency: 2, running: true });
    // Tek görev varsayan arayüzler için tekil alan korunur.
    expect(last?.payload).toMatchObject({ currentTaskId: "a" });

    await h.finish("a");
    await h.finish("b");
    await h.supervisor.stop();
  });

  it("boşta status boş liste bildirir", async () => {
    const h = harness();
    h.supervisor.start();
    await tick();

    const status = h.events.filter((e) => e.type === "status");
    expect(status[status.length - 1]?.payload).toMatchObject({ activeTaskIds: [], currentTaskId: null });
    await h.supervisor.stop();
  });
});
