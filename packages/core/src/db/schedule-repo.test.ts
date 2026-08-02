import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { ScheduleRepository } from "./schedule-repo";
import type { Schedule } from "../config/schema";

function repo(): ScheduleRepository {
  return new ScheduleRepository(openDatabase(":memory:"));
}

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "s1",
    prompt: "Run the tests",
    executionMode: "auto",
    trigger: { type: "interval", everyMinutes: 30 },
    enabled: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    lastTaskId: null,
    ...overrides,
  };
}

describe("ScheduleRepository", () => {
  it("saves and reads back by id", () => {
    const r = repo();
    r.save(schedule());
    expect(r.getById("s1")?.prompt).toBe("Run the tests");
    expect(r.getById("missing")).toBeNull();
  });

  it("updates instead of duplicating when the same id is saved again", () => {
    const r = repo();
    r.save(schedule());
    r.save(schedule({ prompt: "Updated" }));

    const all = r.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.prompt).toBe("Updated");
  });

  it("stores the trigger types without loss", () => {
    const r = repo();
    r.save(schedule({ id: "weekly", trigger: { type: "weekly", at: "09:30", days: [1, 3, 5] } }));

    const stored = r.getById("weekly");
    expect(stored?.trigger).toEqual({ type: "weekly", at: "09:30", days: [1, 3, 5] });
  });

  it("setEnabled changes only the enabled field", () => {
    const r = repo();
    r.save(schedule({ nextRunAt: "2026-08-01T10:00:00.000Z" }));

    const disabled = r.setEnabled("s1", false);
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.nextRunAt).toBe("2026-08-01T10:00:00.000Z");
    expect(r.setEnabled("missing", false)).toBeNull();
  });

  it("deletes and returns false for a record that does not exist", () => {
    const r = repo();
    r.save(schedule());
    expect(r.remove("s1")).toBe(true);
    expect(r.remove("s1")).toBe(false);
    expect(r.list()).toHaveLength(0);
  });
});
