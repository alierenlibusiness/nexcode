import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { TaskRepository } from "./task-repo";

describe("TaskRepository", () => {
  it("görev oluşturur (varsayılan backlog)", () => {
    const repo = new TaskRepository(openDatabase(":memory:"));
    const t = repo.create({ title: "Login formu" });
    expect(t.status).toBe("backlog");
    expect(t.completedAt).toBeNull();
    expect(repo.getById(t.id)).toEqual(t);
  });

  it("durum günceller ve done'da completed_at yazar", () => {
    const repo = new TaskRepository(openDatabase(":memory:"));
    const t = repo.create({ title: "API endpoint" });

    repo.updateStatus(t.id, "in_progress");
    expect(repo.getById(t.id)?.status).toBe("in_progress");
    expect(repo.getById(t.id)?.completedAt).toBeNull();

    repo.updateStatus(t.id, "done");
    const done = repo.getById(t.id);
    expect(done?.status).toBe("done");
    expect(done?.completedAt).toBeTypeOf("string");
  });

  it("duruma göre, önceliğe göre sıralı listeler", () => {
    const repo = new TaskRepository(openDatabase(":memory:"));
    repo.create({ title: "düşük", priority: 1 });
    repo.create({ title: "yüksek", priority: 10 });
    const backlog = repo.listByStatus("backlog");
    expect(backlog).toHaveLength(2);
    expect(backlog[0]?.title).toBe("yüksek");
  });
});
