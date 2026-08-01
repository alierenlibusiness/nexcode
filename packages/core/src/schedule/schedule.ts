import type { ExecutionMode, Schedule, ScheduleTrigger } from "../config/schema";

/**
 * Zamanlanmış görevler: **saf ve yan etkisiz** hesap katmanı.
 *
 * Yan etkiler (görev üretme, yayın, config kaydetme) yalnızca main process'teki
 * zamanlayıcı tik'indedir. Bu ayrım sayesinde zamanlama mantığı saatten ve süreçten
 * bağımsız test edilebilir.
 *
 * Motor duruyorsa zamanlanan görev **yalnızca kuyruğa girer**: otomatik başlatma yoktur.
 */

export interface ScheduleInput {
  id?: string;
  prompt: string;
  targetDir?: string;
  operatorAgentId?: string;
  executionMode?: ExecutionMode;
  trigger: ScheduleTrigger;
  enabled?: boolean;
}

export type ScheduleNormalizeResult = { ok: true; schedule: Schedule } | { ok: false; error: string };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Dostça ön ayarlar: arayüzdeki aralık seçeneklerinin tek kaynağı. */
export const INTERVAL_PRESETS: readonly number[] = [1, 5, 15, 30, 60, 120, 240, 480, 720, 1440];

/** Kullanıcı girdisini doğrulanmış bir zamanlama nesnesine çevirir. */
export function normalizeSchedule(
  input: ScheduleInput,
  now: Date,
  idFactory: () => string,
): ScheduleNormalizeResult {
  if (input.prompt.trim() === "") {
    return { ok: false, error: "Zamanlanmış görevin metni boş olamaz." };
  }

  const trigger = input.trigger;
  if (trigger.type === "interval") {
    if (!Number.isInteger(trigger.everyMinutes) || trigger.everyMinutes < 1) {
      return { ok: false, error: "Aralık en az 1 dakika olmalıdır." };
    }
  } else if (!TIME_PATTERN.test(trigger.at)) {
    return { ok: false, error: `Saat biçimi geçersiz: "${trigger.at}". Beklenen biçim SS:DD (örn. 09:30).` };
  }

  if (trigger.type === "weekly") {
    if (trigger.days.length === 0) {
      return { ok: false, error: "Haftalık zamanlama için en az bir gün seçilmelidir." };
    }
    if (trigger.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      return { ok: false, error: "Gün değerleri 0 (Pazar) ile 6 (Cumartesi) arasında olmalıdır." };
    }
  }

  const normalizedTrigger: ScheduleTrigger =
    trigger.type === "weekly" ? { ...trigger, days: [...new Set(trigger.days)].sort((a, b) => a - b) } : trigger;

  const schedule: Schedule = {
    id: input.id ?? idFactory(),
    prompt: input.prompt.trim(),
    ...(input.targetDir !== undefined ? { targetDir: input.targetDir } : {}),
    ...(input.operatorAgentId !== undefined ? { operatorAgentId: input.operatorAgentId } : {}),
    executionMode: input.executionMode ?? "auto",
    trigger: normalizedTrigger,
    enabled: input.enabled ?? true,
    createdAt: now.toISOString(),
    lastRunAt: null,
    nextRunAt: null,
    lastTaskId: null,
  };

  return { ok: true, schedule: { ...schedule, nextRunAt: computeNextRun(schedule, now).toISOString() } };
}

/**
 * Sonraki çalışma zamanı: **her zaman `from`'dan kesin ileri**.
 *
 * Sınır anında (tam 09:30:00) hesaplanırsa bir sonraki güne geçer; böylece aynı tik
 * içinde görev iki kez kuyruğa alınmaz.
 */
export function computeNextRun(schedule: Pick<Schedule, "trigger">, from: Date): Date {
  const trigger = schedule.trigger;

  if (trigger.type === "interval") {
    return new Date(from.getTime() + trigger.everyMinutes * 60_000);
  }

  const [hours, minutes] = parseTime(trigger.at);

  if (trigger.type === "daily") {
    const candidate = atLocalTime(from, hours, minutes);
    return candidate.getTime() > from.getTime() ? candidate : addDays(candidate, 1);
  }

  // weekly: bugünden başlayarak 7 gün ileriye bakılır.
  const days = [...trigger.days].sort((a, b) => a - b);
  for (let offset = 0; offset <= 7; offset++) {
    const day = addDays(from, offset);
    if (!days.includes(day.getDay())) continue;
    const candidate = atLocalTime(day, hours, minutes);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  // Savunma katmanı: days boş olamaz (normalizeSchedule engeller).
  return addDays(atLocalTime(from, hours, minutes), 7);
}

/** Zamanı gelmiş ve etkin zamanlamalar. */
export function dueSchedules(schedules: readonly Schedule[], now: Date): Schedule[] {
  return schedules.filter((schedule) => {
    if (!schedule.enabled) return false;
    if (schedule.nextRunAt === null) return true;
    const next = Date.parse(schedule.nextRunAt);
    return Number.isFinite(next) && next <= now.getTime();
  });
}

/** Bir zamanlama çalıştıktan sonraki durumu (saf: çağıran kaydeder). */
export function advanceSchedule(schedule: Schedule, now: Date, taskId: string): Schedule {
  return {
    ...schedule,
    lastRunAt: now.toISOString(),
    lastTaskId: taskId,
    nextRunAt: computeNextRun(schedule, now).toISOString(),
  };
}

const DAY_NAMES_TR = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"] as const;
const DAY_NAMES_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Arayüzde gösterilecek kısa tetik açıklaması. */
export function triggerLabel(trigger: ScheduleTrigger, language: "en" | "tr" = "en"): string {
  const names = language === "tr" ? DAY_NAMES_TR : DAY_NAMES_EN;
  if (trigger.type === "interval") {
    const minutes = trigger.everyMinutes;
    if (minutes % 1440 === 0) {
      const days = minutes / 1440;
      return language === "tr" ? `her ${String(days)} günde` : `every ${String(days)}d`;
    }
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return language === "tr" ? `her ${String(hours)} saatte` : `every ${String(hours)}h`;
    }
    return language === "tr" ? `her ${String(minutes)} dakikada` : `every ${String(minutes)}m`;
  }
  if (trigger.type === "daily") {
    return language === "tr" ? `her gün ${trigger.at}` : `daily at ${trigger.at}`;
  }
  const days = [...trigger.days].sort((a, b) => a - b).map((day) => names[day] ?? "?").join(", ");
  return language === "tr" ? `${days} ${trigger.at}` : `${days} at ${trigger.at}`;
}

function parseTime(value: string): [number, number] {
  const match = TIME_PATTERN.exec(value);
  return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0)];
}

function atLocalTime(base: Date, hours: number, minutes: number): Date {
  const date = new Date(base);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function addDays(base: Date, days: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date;
}
