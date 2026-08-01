import { computeNextRun, dueSchedules, logger } from "../index";
import type { ConfigRepository, EngineRepository, ScheduleRepository } from "../db/index";
import type { EngineHost } from "./engine-host";

/**
 * Zamanlayıcı tik'i.
 *
 * Saf hesap (`computeNextRun`, `dueSchedules`) çekirdektedir; yan etkiler (görev üretme,
 * kayıt güncelleme, motoru uyandırma) burada toplanır.
 *
 * Değişmez: **motor duruyorsa zamanlanan görev yalnızca kuyruğa girer.** Otomatik başlatma
 * yoktur; `wake()` sadece halihazırda çalışan döngüyü erkenden uyarır. Kullanıcı motoru
 * durdurmuşsa bir zamanlama onu kendiliğinden başlatamaz.
 */

const TICK_MS = 30_000;
const FIRST_TICK_MS = 5_000;

export interface SchedulerOptions {
  schedules: ScheduleRepository;
  tasks: EngineRepository;
  engine: EngineHost;
  configRepo: ConfigRepository;
}

/** Zamanlayıcıyı başlatır ve durdurma fonksiyonunu döner. */
export function startScheduler(options: SchedulerOptions): () => void {
  let busy = false;

  const tick = (): void => {
    // Yeniden giriş kilidi: yavaş bir tik bir sonrakiyle üst üste binmemeli.
    if (busy) return;
    busy = true;

    try {
      runTick(options);
    } catch (error) {
      logger.error("scheduler.tick_failed", { error: String(error) });
    } finally {
      busy = false;
    }
  };

  const first = setTimeout(tick, FIRST_TICK_MS);
  const interval = setInterval(tick, TICK_MS);
  first.unref();
  interval.unref();

  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}

function runTick(options: SchedulerOptions): void {
  const now = new Date();
  const all = options.schedules.list();
  const due = dueSchedules(all, now);
  if (due.length === 0) return;

  const cfg = options.configRepo.load();

  for (const schedule of due) {
    const task = options.tasks.create({
      prompt: schedule.prompt,
      workingDir: schedule.targetDir ?? cfg.workingDir,
      executionMode: schedule.executionMode,
      scheduleId: schedule.id,
    });

    options.schedules.save({
      ...schedule,
      lastRunAt: now.toISOString(),
      lastTaskId: task.id,
      // Sonraki çalışma daima `now`'dan kesin ileridedir; aynı tik'te tekrar tetiklenmez.
      nextRunAt: computeNextRun(schedule, now).toISOString(),
    });

    logger.info("scheduler.task_queued", { scheduleId: schedule.id, taskId: task.id });
  }

  // Yalnızca çalışan döngüyü uyarır; duran motoru başlatmaz.
  options.engine.wake();
}
