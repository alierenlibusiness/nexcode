import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";
import { McpRepository } from "./mcp-repo";

describe("McpRepository", () => {
  let db: Database.Database;
  let repo: McpRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(SCHEMA_SQL);
    repo = new McpRepository(db);
  });

  it("should create and retrieve MCP server records", () => {
    const created = repo.create({
      name: "test-server",
      command: "node",
      args: ["test.js"],
      env: { KEY: "VALUE" },
    });

    expect(created.id).toBeDefined();
    expect(created.name).toBe("test-server");
    expect(created.command).toBe("node");
    expect(created.args).toEqual(["test.js"]);
    expect(created.env).toEqual({ KEY: "VALUE" });
    expect(created.enabled).toBe(true);

    const list = repo.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("test-server");
  });

  it("should support toggling and deleting records", () => {
    const created = repo.create({
      name: "test-server",
      command: "node",
      args: [],
      env: {},
    });

    repo.toggle(created.id, false);
    let s = repo.getByName("test-server");
    expect(s?.enabled).toBe(false);

    repo.delete(created.id);
    s = repo.getByName("test-server");
    expect(s).toBeNull();
  });
});
