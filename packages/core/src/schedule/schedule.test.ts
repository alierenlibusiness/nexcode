import { describe, expect, it } from "vitest";
import type { Schedule } from "../config/schema";
import {
  advanceSchedule,
  computeNextRun,
  dueSchedules,
  normalizeSchedule,
  triggerLabel,
  type ScheduleInput,
} from "./schedule";

const now = new Date(2026, 6, 25, 10, 0, 0); // 25 Temmuz 2026, Cumartesi 10:00 (yerel)
const ids = () => "sch-1";

function make(input: Partial<ScheduleInput> & Pick<ScheduleInput, "trigger">): ScheduleInput {
  return { prompt: "Testleri çalıştır", ...input };
}

describe("normalizeSchedule", () => {
  it("geçerli girdiden zamanlama üretir ve ilk çalışmayı hesaplar", () => {
    const result = normalizeSchedule(make({ trigger: { type: "interval", everyMinutes: 30 } }), now, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schedule.id).toBe("sch-1");
    expect(result.schedule.enabled).toBe(true);
    expect(result.schedule.executionMode).toBe("auto");
    expect(result.schedule.nextRunAt).toBe(new Date(2026, 6, 25, 10, 30, 0).toISOString());
  });

  it("boş görev metnini reddeder", () => {
    const result = normalizeSchedule(make({ prompt: "   ", trigger: { type: "daily", at: "09:30" } }), now, ids);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("boş olamaz");
  });

  it("geçersiz saat biçimini reddeder", () => {
    const result = normalizeSchedule(make({ trigger: { type: "daily", at: "9:30" } }), now, ids);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("SS:DD");
  });

  it("sıfır veya negatif aralığı reddeder", () => {
    expect(normalizeSchedule(make({ trigger: { type: "interval", everyMinutes: 0 } }), now, ids).ok).toBe(false);
  });

  it("gün seçilmemiş haftalık zamanlamayı reddeder", () => {
    const result = normalizeSchedule(make({ trigger: { type: "weekly", at: "09:00", days: [] } }), now, ids);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("en az bir gün");
  });

  it("aralık dışı gün değerini reddeder", () => {
    expect(normalizeSchedule(make({ trigger: { type: "weekly", at: "09:00", days: [7] } }), now, ids).ok).toBe(false);
  });

  it("haftalık günleri tekilleştirip sıralar", () => {
    const result = normalizeSchedule(make({ trigger: { type: "weekly", at: "09:00", days: [5, 1, 5] } }), now, ids);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schedule.trigger).toEqual({ type: "weekly", at: "09:00", days: [1, 5] });
  });
});

describe("computeNextRun", () => {
  it("aralık tetiğini şimdiden ileri taşır", () => {
    const next = computeNextRun({ trigger: { type: "interval", everyMinutes: 90 } }, now);
    expect(next).toEqual(new Date(2026, 6, 25, 11, 30, 0));
  });

  it("günlük tetikte bugünün saati geçmemişse bugünü seçer", () => {
    const next = computeNextRun({ trigger: { type: "daily", at: "14:00" } }, now);
    expect(next).toEqual(new Date(2026, 6, 25, 14, 0, 0));
  });

  it("günlük tetikte saat geçtiyse yarına taşır", () => {
    const next = computeNextRun({ trigger: { type: "daily", at: "08:00" } }, now);
    expect(next).toEqual(new Date(2026, 6, 26, 8, 0, 0));
  });

  it("tam sınır anında bir sonraki güne geçer — aynı tik'te iki kez kuyruğa almaz", () => {
    const boundary = new Date(2026, 6, 25, 9, 30, 0);
    const next = computeNextRun({ trigger: { type: "daily", at: "09:30" } }, boundary);
    expect(next).toEqual(new Date(2026, 6, 26, 9, 30, 0));
  });

  it("haftalık tetikte bugün uygunsa ve saat geçmediyse bugünü seçer", () => {
    // 25 Temmuz 2026 Cumartesi = 6
    const next = computeNextRun({ trigger: { type: "weekly", at: "18:00", days: [6] } }, now);
    expect(next).toEqual(new Date(2026, 6, 25, 18, 0, 0));
  });

  it("haftalık tetikte sonraki uygun güne taşır", () => {
    // Pazartesi (1) 09:00 → 27 Temmuz
    const next = computeNextRun({ trigger: { type: "weekly", at: "09:00", days: [1] } }, now);
    expect(next).toEqual(new Date(2026, 6, 27, 9, 0, 0));
  });

  it("bugün uygun ama saat geçtiyse bir sonraki uygun güne gider", () => {
    const next = computeNextRun({ trigger: { type: "weekly", at: "08:00", days: [6] } }, now);
    expect(next).toEqual(new Date(2026, 7, 1, 8, 0, 0));
  });

  it("her zaman kesin ileri bir zaman üretir", () => {
    const triggers = [
      { type: "interval" as const, everyMinutes: 1 },
      { type: "daily" as const, at: "10:00" },
      { type: "weekly" as const, at: "10:00", days: [0, 1, 2, 3, 4, 5, 6] },
    ];
    for (const trigger of triggers) {
      expect(computeNextRun({ trigger }, now).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("dueSchedules", () => {
  function schedule(over: Partial<Schedule>): Schedule {
    return {
      id: "s",
      prompt: "p",
      executionMode: "auto",
      trigger: { type: "interval", everyMinutes: 5 },
      enabled: true,
      createdAt: now.toISOString(),
      lastRunAt: null,
      nextRunAt: null,
      lastTaskId: null,
      ...over,
    };
  }

  it("zamanı gelmiş etkin zamanlamaları döner", () => {
    const past = new Date(now.getTime() - 1000).toISOString();
    expect(dueSchedules([schedule({ nextRunAt: past })], now)).toHaveLength(1);
  });

  it("zamanı gelmemiş olanı döndürmez", () => {
    const future = new Date(now.getTime() + 60_000).toISOString();
    expect(dueSchedules([schedule({ nextRunAt: future })], now)).toHaveLength(0);
  });

  it("kapalı zamanlamayı atlar", () => {
    const past = new Date(now.getTime() - 1000).toISOString();
    expect(dueSchedules([schedule({ nextRunAt: past, enabled: false })], now)).toHaveLength(0);
  });

  it("hiç çalışmamış zamanlamayı hazır sayar", () => {
    expect(dueSchedules([schedule({ nextRunAt: null })], now)).toHaveLength(1);
  });

  it("bozuk tarih değerini hazır saymaz", () => {
    expect(dueSchedules([schedule({ nextRunAt: "geçersiz" })], now)).toHaveLength(0);
  });
});

describe("advanceSchedule", () => {
  it("çalıştırma sonrası son ve sonraki zamanı günceller", () => {
    const base = normalizeSchedule(make({ trigger: { type: "interval", everyMinutes: 60 } }), now, ids);
    expect(base.ok).toBe(true);
    if (!base.ok) return;

    const advanced = advanceSchedule(base.schedule, now, "task-9");
    expect(advanced.lastRunAt).toBe(now.toISOString());
    expect(advanced.lastTaskId).toBe("task-9");
    expect(advanced.nextRunAt).toBe(new Date(2026, 6, 25, 11, 0, 0).toISOString());
  });
});

describe("triggerLabel", () => {
  it("aralığı okunabilir biçimde özetler", () => {
    expect(triggerLabel({ type: "interval", everyMinutes: 30 })).toBe("every 30m");
    expect(triggerLabel({ type: "interval", everyMinutes: 120 })).toBe("every 2h");
    expect(triggerLabel({ type: "interval", everyMinutes: 1440 })).toBe("every 1d");
    expect(triggerLabel({ type: "interval", everyMinutes: 30 }, "tr")).toBe("her 30 dakikada");
  });

  it("günlük ve haftalık tetikleri özetler", () => {
    expect(triggerLabel({ type: "daily", at: "09:30" })).toBe("daily at 09:30");
    expect(triggerLabel({ type: "weekly", at: "09:30", days: [1, 3] })).toBe("Mon, Wed at 09:30");
    expect(triggerLabel({ type: "weekly", at: "09:30", days: [1, 3] }, "tr")).toBe("Pzt, Çar 09:30");
  });
});
