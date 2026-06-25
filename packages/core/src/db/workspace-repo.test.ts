import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { WorkspaceRepository } from "./workspace-repo";

describe("WorkspaceRepository", () => {
  it("bir workspace oluşturur ve SQLite'a yazar", () => {
    const db = openDatabase(":memory:");
    const repo = new WorkspaceRepository(db);

    const created = repo.create({ name: "Demo", repoPath: "/tmp/demo" });

    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.name).toBe("Demo");
    expect(created.repoPath).toBe("/tmp/demo");
    expect(created.createdAt).toBeTypeOf("string");

    const fetched = repo.getById(created.id);
    expect(fetched).toEqual(created);
  });

  it("workspace'leri oluşturulma sırasına göre (yeni→eski) listeler", () => {
    const db = openDatabase(":memory:");
    const repo = new WorkspaceRepository(db);

    const a = repo.create({ name: "A", repoPath: "/a" });
    const b = repo.create({ name: "B", repoPath: "/b" });

    const all = repo.list();
    expect(all).toHaveLength(2);
    expect(all.map((w) => w.id)).toContain(a.id);
    expect(all.map((w) => w.id)).toContain(b.id);
  });

  it("bilinmeyen id için null döner", () => {
    const db = openDatabase(":memory:");
    const repo = new WorkspaceRepository(db);
    expect(repo.getById("yok")).toBeNull();
  });
});
