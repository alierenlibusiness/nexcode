import { describe, expect, it } from "vitest";
import { Checkpoints, type Checkpoint, type CheckpointMeta, type CheckpointPort } from "./checkpoints";

/** Bellekte çalışan sahte dosya sistemi + checkpoint deposu. */
function makePort(initial: Record<string, string>) {
  const files: Record<string, string> = { ...initial };
  const store = new Map<string, Checkpoint>();

  const port: CheckpointPort = {
    listFiles: () => Promise.resolve(Object.keys(files)),
    readFile: (_root, rel) => Promise.resolve(files[rel] ?? null),
    writeFile: (_root, rel, content) => {
      files[rel] = content;
      return Promise.resolve();
    },
    deleteFile: (_root, rel) => {
      delete files[rel];
      return Promise.resolve();
    },
    persist: (checkpoint) => {
      store.set(checkpoint.id, checkpoint);
      return Promise.resolve();
    },
    load: (id) => Promise.resolve(store.get(id) ?? null),
    list: (workingDir) =>
      Promise.resolve(
        [...store.values()]
          .filter((c) => c.workingDir === workingDir)
          .map(({ files: _f, ...meta }): CheckpointMeta => meta),
      ),
    remove: (id) => {
      store.delete(id);
      return Promise.resolve();
    },
  };

  return { port, files, store };
}

let counter = 0;
const options = {
  retention: 20,
  now: () => new Date(2026, 6, 25, 10, 0, counter),
  idFactory: () => `cp-${String(++counter)}`,
};

describe("Checkpoints", () => {
  it("çalışma klasörünün anlık görüntüsünü alır", async () => {
    counter = 0;
    const { port } = makePort({ "a.ts": "eski", "b.ts": "sabit" });
    const meta = await new Checkpoints(port, options).capture("t1", "C:/p");

    expect(meta.kind).toBe("pre");
    expect(meta.taskId).toBe("t1");
    expect(meta.fileCount).toBe(2);
  });

  it("hassas dosyaların içeriğini snapshot'a almaz", async () => {
    counter = 0;
    const { port, store } = makePort({ ".env": "SECRET=abc", "a.ts": "kod" });
    const meta = await new Checkpoints(port, options).capture("t1", "C:/p");

    const snapshot = store.get(meta.id);
    expect(snapshot?.files[".env"]).toBeNull();
    expect(snapshot?.files["a.ts"]).toBe("kod");
    expect(JSON.stringify(snapshot)).not.toContain("SECRET=abc");
  });

  it("yok sayılan klasörleri snapshot'a almaz", async () => {
    counter = 0;
    const { port, store } = makePort({ "src/a.ts": "kod", "node_modules/x/i.js": "dep" });
    const meta = await new Checkpoints(port, options).capture("t1", "C:/p");
    expect(Object.keys(store.get(meta.id)?.files ?? {})).toEqual(["src/a.ts"]);
  });

  it("değiştirilmiş dosyayı geri getirir ve sonradan oluşanı siler", async () => {
    counter = 0;
    const { port, files } = makePort({ "a.ts": "orijinal", "b.ts": "sabit" });
    const checkpoints = new Checkpoints(port, options);
    const meta = await checkpoints.capture("t1", "C:/p");

    files["a.ts"] = "agent değiştirdi";
    files["yeni.ts"] = "agent oluşturdu";

    const result = await checkpoints.restore(meta.id, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(files["a.ts"]).toBe("orijinal");
    expect(files["yeni.ts"]).toBeUndefined();
    expect(files["b.ts"]).toBe("sabit");
    expect(result.report.restored).toEqual(["a.ts"]);
    expect(result.report.deleted).toEqual(["yeni.ts"]);
  });

  it("silinmiş dosyayı geri getirir", async () => {
    counter = 0;
    const { port, files } = makePort({ "a.ts": "içerik" });
    const checkpoints = new Checkpoints(port, options);
    const meta = await checkpoints.capture("t1", "C:/p");

    delete files["a.ts"];
    const result = await checkpoints.restore(meta.id, true);

    expect(result.ok).toBe(true);
    expect(files["a.ts"]).toBe("içerik");
  });

  it("geri yüklemeden önce redo checkpoint'i oluşturur — geri alma geri alınabilir", async () => {
    counter = 0;
    const { port, files } = makePort({ "a.ts": "v1" });
    const checkpoints = new Checkpoints(port, options);
    const first = await checkpoints.capture("t1", "C:/p");

    files["a.ts"] = "v2";
    const restore = await checkpoints.restore(first.id, true);
    expect(restore.ok).toBe(true);
    if (!restore.ok) return;
    expect(files["a.ts"]).toBe("v1");

    // Redo checkpoint'ine dönerek geri almayı geri al.
    const redo = await checkpoints.restore(restore.report.redoCheckpointId, true);
    expect(redo.ok).toBe(true);
    expect(files["a.ts"]).toBe("v2");
  });

  it("motor çalışırken geri yüklemeyi reddeder", async () => {
    counter = 0;
    const { port, files } = makePort({ "a.ts": "v1" });
    const checkpoints = new Checkpoints(port, options);
    const meta = await checkpoints.capture("t1", "C:/p");
    files["a.ts"] = "v2";

    const result = await checkpoints.restore(meta.id, false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("motor boştayken");
    expect(files["a.ts"]).toBe("v2");
  });

  it("bilinmeyen checkpoint için hata döner", async () => {
    counter = 0;
    const { port } = makePort({});
    const result = await new Checkpoints(port, options).restore("yok", true);
    expect(result.ok).toBe(false);
  });

  it("içeriği saklanamayan dosyaya geri yüklemede dokunmaz", async () => {
    counter = 0;
    const { port, files } = makePort({ ".env": "SECRET=v1" });
    const checkpoints = new Checkpoints(port, options);
    const meta = await checkpoints.capture("t1", "C:/p");

    files[".env"] = "SECRET=v2";
    const result = await checkpoints.restore(meta.id, true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.skipped).toContain(".env");
    // Kullanıcının gerçek sırrı üzerine yazılmaz.
    expect(files[".env"]).toBe("SECRET=v2");
  });

  it("saklama limitini aşan en eski checkpoint'leri siler", async () => {
    counter = 0;
    const { port } = makePort({ "a.ts": "x" });
    const checkpoints = new Checkpoints(port, { ...options, retention: 2 });

    await checkpoints.capture("t1", "C:/p");
    await checkpoints.capture("t2", "C:/p");
    await checkpoints.capture("t3", "C:/p");

    const list = await checkpoints.list("C:/p");
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.taskId).sort()).toEqual(["t2", "t3"]);
  });
});
