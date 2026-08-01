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

describe("SqliteCheckpointStore: dosya sistemi tarafı", () => {
  it("çalışma klasörünü tarar ve yok sayılan klasörlere inmez", async () => {
    write("src/app.ts", "export const a = 1;");
    write("node_modules/lib/index.js", "module.exports = {};");
    mkdirSync(join(root, ".git"), { recursive: true });
    write(".git/HEAD", "ref: refs/heads/main");

    const files = await store().listFiles(root);
    expect(files).toContain("src/app.ts");
    expect(files.some((f) => f.startsWith("node_modules"))).toBe(false);
    expect(files.some((f) => f.startsWith(".git"))).toBe(false);
  });

  it("ikili içerik null döner, böylece geri yüklemede dokunulmaz", async () => {
    writeFileSync(join(root, "logo.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00]));
    expect(await store().readFile(root, "logo.bin")).toBeNull();
  });

  it("okunamayan dosyada hata fırlatmaz", async () => {
    expect(await store().readFile(root, "olmayan.ts")).toBeNull();
  });

  it("yazarken eksik klasörleri oluşturur", async () => {
    const s = store();
    await s.writeFile(root, "yeni/derin/dosya.ts", "içerik");
    expect(readFileSync(join(root, "yeni/derin/dosya.ts"), "utf8")).toBe("içerik");
  });
});

describe("SqliteCheckpointStore: kalıcılık", () => {
  it("snapshot'ı kaydeder, geri okur ve klasöre göre listeler", async () => {
    const s = store();
    write("a.ts", "birinci");
    const meta = await checkpoints(s).capture("task-1", root);

    expect((await s.list(root)).map((m) => m.id)).toEqual([meta.id]);
    expect((await s.load(meta.id))?.files["a.ts"]).toBe("birinci");
    expect(await s.load("olmayan")).toBeNull();
    expect(await s.list("/baska/klasor")).toHaveLength(0);
  });

  it("silinen checkpoint'in dosya satırları da gider", async () => {
    const s = store();
    write("a.ts", "x");
    const meta = await checkpoints(s).capture("task-1", root);

    await s.remove(meta.id);
    expect(await s.load(meta.id)).toBeNull();
    expect(await s.list(root)).toHaveLength(0);
  });
});

describe("Checkpoints: SQLite deposu üzerinde uçtan uca geri alma", () => {
  it("değişeni geri yükler, sonradan ekleneni siler ve redo checkpoint'i üretir", async () => {
    const s = store();
    const cp = checkpoints(s);
    write("src/app.ts", "ilk hâli");
    write("README.md", "sabit");
    const snapshot = await cp.capture("task-1", root);

    // Agent çalışması taklidi.
    write("src/app.ts", "agent değiştirdi");
    write("src/yeni.ts", "agent ekledi");
    rmSync(join(root, "README.md"));

    const result = await cp.restore(snapshot.id, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(readFileSync(join(root, "src/app.ts"), "utf8")).toBe("ilk hâli");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("sabit");
    expect(existsSync(join(root, "src/yeni.ts"))).toBe(false);
    expect(result.report.restored).toEqual(["README.md", "src/app.ts"]);
    expect(result.report.deleted).toEqual(["src/yeni.ts"]);

    // Geri almanın geri alınması: redo checkpoint'i agent'ın hâlini taşır.
    const redo = await s.load(result.report.redoCheckpointId);
    expect(redo?.kind).toBe("redo");
    expect(redo?.files["src/app.ts"]).toBe("agent değiştirdi");
  });

  it("hassas dosya içeriği saklanmaz ve geri yüklemede atlanır", async () => {
    const s = store();
    const cp = checkpoints(s);
    write(".env", "SECRET=orijinal");
    const snapshot = await cp.capture("task-1", root);

    expect((await s.load(snapshot.id))?.files[".env"]).toBeNull();

    write(".env", "SECRET=degistirildi");
    const result = await cp.restore(snapshot.id, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.skipped).toContain(".env");
    expect(readFileSync(join(root, ".env"), "utf8")).toBe("SECRET=degistirildi");
  });

  it("motor çalışırken geri yükleme reddedilir", async () => {
    const s = store();
    const cp = checkpoints(s);
    write("a.ts", "x");
    const snapshot = await cp.capture("task-1", root);

    write("a.ts", "agent yazıyor");
    const result = await cp.restore(snapshot.id, false);
    expect(result.ok).toBe(false);
    expect(readFileSync(join(root, "a.ts"), "utf8")).toBe("agent yazıyor");
  });

  it("saklama limitini aşan en eski checkpoint'ler silinir", async () => {
    const s = store();
    const cp = checkpoints(s, 2);
    write("a.ts", "x");

    await cp.capture("task-1", root);
    await cp.capture("task-1", root);
    await cp.capture("task-1", root);

    expect(await s.list(root)).toHaveLength(2);
  });
});
