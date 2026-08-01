import type { DB } from "./connection";
import type { Schedule } from "../config/schema";

/**
 * Zamanlama deposu.
 *
 * CRUD kendi uçlarıyla **anında** kalıcılaşır — büyük config kaydetme yolundan geçmez,
 * böylece bir zamanlama eklemek kaydedilmemiş ayar taslaklarını etkilemez.
 */
export class ScheduleRepository {
  constructor(private readonly db: DB) {}

  list(): Schedule[] {
    const rows = this.db.prepare("SELECT data FROM schedules ORDER BY updated_at ASC").all() as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Schedule);
  }

  getById(id: string): Schedule | null {
    const row = this.db.prepare("SELECT data FROM schedules WHERE id = ?").get(id) as { data: string } | undefined;
    return row === undefined ? null : (JSON.parse(row.data) as Schedule);
  }

  save(schedule: Schedule): Schedule {
    this.db
      .prepare(
        `INSERT INTO schedules (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(schedule.id, JSON.stringify(schedule), new Date().toISOString());
    return schedule;
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM schedules WHERE id = ?").run(id).changes > 0;
  }

  setEnabled(id: string, enabled: boolean): Schedule | null {
    const schedule = this.getById(id);
    if (schedule === null) return null;
    return this.save({ ...schedule, enabled });
  }
}
