import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";
import { SkillRepository } from "./skill-repo";

describe("SkillRepository", () => {
  let db: Database.Database;
  let repo: SkillRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA_SQL);
    repo = new SkillRepository(db);
  });

  it("should create and list user custom skills", () => {
    const created = repo.create({
      name: "test_skill",
      description: "Test description",
      prompt: "Perform unit test for this project",
    });

    expect(created.id).toBeDefined();
    expect(created.name).toBe("test_skill");
    expect(created.description).toBe("Test description");
    expect(created.prompt).toBe("Perform unit test for this project");
    expect(created.createdAt).toBeDefined();

    const list = repo.list();
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe("test_skill");

    const fetched = repo.getByName("test_skill");
    expect(fetched).not.toBeNull();
    expect(fetched?.prompt).toBe("Perform unit test for this project");

    repo.delete(created.id);
    expect(repo.getByName("test_skill")).toBeNull();
  });
});
