import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./connection";
import { SqliteCheckpointStore } from "./checkpoint-store";
import { Checkpoints } from "../checkpoints/checkpoints";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexcode-cp-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relativePath: string, content: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function store(): SqliteCheckpointStore {
  return new SqliteCheckpointStore(openDatabase(":memory:"));
}

function checkpoints(port: SqliteCheckpointStore, retention = 5): Checkpoints {
  let counter = 0;
  return new Checkpoints(port, {
    retention,
    idFactory: () => `cp-${String(++counter)}`,
    now: () => new Date(Date.UTC(2026, 7, 1, 0, counter)),
  });
}

describe("SqliteCheckpointStore: file system side", () => {
  it("walks the working directory and does not descend into ignored folders", async () => {
    write("src/app.ts", "export const a = 1;");
    write("node_modules/lib/index.js", "module.exports = {};");
    mkdirSync(join(root, ".git"), { recursive: true });
    write(".git/HEAD", "ref: refs/heads/main");

    const files = await store().listFiles(root);
    expect(files).toContain("src/app.ts");
    expect(files.some((f) => f.startsWith("node_modules"))).toBe(false);
    expect(files.some((f) => f.startsWith(".git"))).toBe(false);
  });

  it("returns null for binary content so restore leaves it untouched", async () => {
    writeFileSync(join(root, "logo.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00]));
    expect(await store().readFile(root, "logo.bin")).toBeNull();
  });

  it("does not throw on an unreadable file", async () => {
    expect(await store().readFile(root, "missing.ts")).toBeNull();
  });

  it("creates the missing folders when writing", async () => {
    const s = store();
    await s.writeFile(root, "new/deep/file.ts", "content");
    expect(readFileSync(join(root, "new/deep/file.ts"), "utf8")).toBe("content");
  });
});

describe("SqliteCheckpointStore: persistence", () => {
  it("saves a snapshot, reads it back and lists it by folder", async () => {
    const s = store();
    write("a.ts", "first");
    const meta = await checkpoints(s).capture("task-1", root);

    expect((await s.list(root)).map((m) => m.id)).toEqual([meta.id]);
    expect((await s.load(meta.id))?.files["a.ts"]).toBe("first");
    expect(await s.load("missing")).toBeNull();
    expect(await s.list("/other/folder")).toHaveLength(0);
  });

  it("removes the file rows of a deleted checkpoint too", async () => {
    const s = store();
    write("a.ts", "x");
    const meta = await checkpoints(s).capture("task-1", root);

    await s.remove(meta.id);
    expect(await s.load(meta.id)).toBeNull();
    expect(await s.list(root)).toHaveLength(0);
  });
});

describe("Checkpoints: end-to-end undo over the SQLite store", () => {
  it("restores what changed, deletes what was added and produces a redo checkpoint", async () => {
    const s = store();
    const cp = checkpoints(s);
    write("src/app.ts", "original state");
    write("README.md", "unchanged");
    const snapshot = await cp.capture("task-1", root);

    // Simulating the agent's work.
    write("src/app.ts", "the agent changed it");
    write("src/new.ts", "the agent added it");
    rmSync(join(root, "README.md"));

    const result = await cp.restore(snapshot.id, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(readFileSync(join(root, "src/app.ts"), "utf8")).toBe("original state");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("unchanged");
    expect(existsSync(join(root, "src/new.ts"))).toBe(false);
    expect(result.report.restored).toEqual(["README.md", "src/app.ts"]);
    expect(result.report.deleted).toEqual(["src/new.ts"]);

    // Undoing the undo: the redo checkpoint carries the agent's state.
    const redo = await s.load(result.report.redoCheckpointId);
    expect(redo?.kind).toBe("redo");
    expect(redo?.files["src/app.ts"]).toBe("the agent changed it");
  });

  it("never stores sensitive file content and skips it on restore", async () => {
    const s = store();
    const cp = checkpoints(s);
    write(".env", "SECRET=original");
    const snapshot = await cp.capture("task-1", root);

    expect((await s.load(snapshot.id))?.files[".env"]).toBeNull();

    write(".env", "SECRET=changed");
    const result = await cp.restore(snapshot.id, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.skipped).toContain(".env");
    expect(readFileSync(join(root, ".env"), "utf8")).toBe("SECRET=changed");
  });

  it("refuses to restore while the engine is running", async () => {
    const s = store();
    const cp = checkpoints(s);
    write("a.ts", "x");
    const snapshot = await cp.capture("task-1", root);

    write("a.ts", "the agent is writing");
    const result = await cp.restore(snapshot.id, false);
    expect(result.ok).toBe(false);
    expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("the agent is writing");
  });

  it("deletes the oldest checkpoints past the retention limit", async () => {
    const s = store();
    const cp = checkpoints(s, 2);
    write("a.ts", "x");

    await cp.capture("task-1", root);
    await cp.capture("task-1", root);
    await cp.capture("task-1", root);

    expect(await s.list(root)).toHaveLength(2);
  });
});
