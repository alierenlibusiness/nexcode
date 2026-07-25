import { describe, expect, it } from "vitest";
import {
  LIVE_DIFF_LIMITS,
  LiveDiffTracker,
  buildFileChangeEvent,
  buildHunks,
  diffLines,
  isBinaryContent,
  isScannable,
  isSensitivePath,
  summarizeFile,
  type WorkspaceReader,
} from "./live-diff";

describe("isSensitivePath", () => {
  it("credential ve anahtar dosyalarını işaretler", () => {
    for (const path of [
      ".env",
      ".env.local",
      "config/.env.production",
      "certs/server.pem",
      "keys/app.key",
      "id_rsa",
      ".ssh/known_hosts",
      ".aws/credentials",
      ".npmrc",
    ]) {
      expect(isSensitivePath(path)).toBe(true);
    }
  });

  it("normal kaynak dosyalarını işaretlemez", () => {
    for (const path of ["src/index.ts", "README.md", "environment.ts", "src/keyboard.tsx"]) {
      expect(isSensitivePath(path)).toBe(false);
    }
  });
});

describe("isScannable", () => {
  it("runtime ve bağımlılık klasörlerini dışlar", () => {
    expect(isScannable("node_modules/foo/index.js")).toBe(false);
    expect(isScannable(".git/config")).toBe(false);
    expect(isScannable("apps/renderer/.next/build.js")).toBe(false);
    expect(isScannable(".nexcode/TASK-1.md")).toBe(false);
  });

  it("kaynak dosyalarını tarar", () => {
    expect(isScannable("src/engine/engine.ts")).toBe(true);
    expect(isScannable("packages/core/src/index.ts")).toBe(true);
  });
});

describe("isBinaryContent", () => {
  it("NUL baytı içeren içeriği ikili sayar", () => {
    expect(isBinaryContent("abc\0def")).toBe(true);
  });

  it("metin içeriği ikili saymaz", () => {
    expect(isBinaryContent("const a = 1;\nexport default a;\n")).toBe(false);
    expect(isBinaryContent("Türkçe karakterler: ğüşiöç")).toBe(false);
    expect(isBinaryContent("")).toBe(false);
  });

  it("yoğun kontrol karakterlerini ikili sayar", () => {
    expect(isBinaryContent("\x01\x02\x03\x04\x05\x06\x07\x08")).toBe(true);
  });
});

describe("diffLines", () => {
  it("değişmemiş dosyada değişiklik üretmez", () => {
    const lines = diffLines(["a", "b"], ["a", "b"]);
    expect(lines.every((line) => line.kind === "context")).toBe(true);
  });

  it("eklenen satırı doğru numaralandırır", () => {
    const lines = diffLines(["a", "c"], ["a", "b", "c"]);
    const added = lines.filter((line) => line.kind === "added");
    expect(added).toHaveLength(1);
    expect(added[0]?.text).toBe("b");
    expect(added[0]?.newLineNo).toBe(2);
    expect(added[0]?.oldLineNo).toBeNull();
  });

  it("silinen satırı doğru numaralandırır", () => {
    const lines = diffLines(["a", "b", "c"], ["a", "c"]);
    const removed = lines.filter((line) => line.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]?.text).toBe("b");
    expect(removed[0]?.oldLineNo).toBe(2);
    expect(removed[0]?.newLineNo).toBeNull();
  });

  it("değiştirilen satırı silme + ekleme olarak gösterir", () => {
    const lines = diffLines(["a", "eski", "c"], ["a", "yeni", "c"]);
    expect(lines.filter((l) => l.kind === "removed").map((l) => l.text)).toEqual(["eski"]);
    expect(lines.filter((l) => l.kind === "added").map((l) => l.text)).toEqual(["yeni"]);
  });

  it("boş dosyadan içerik oluşturmayı ekleme sayar", () => {
    const lines = diffLines([], ["a", "b"]);
    expect(lines.filter((l) => l.kind === "added")).toHaveLength(2);
  });

  it("çok büyük değişim bölgesinde tam değişim raporlar", () => {
    const before = Array.from({ length: 2000 }, (_, i) => `eski-${String(i)}`);
    const after = Array.from({ length: 2000 }, (_, i) => `yeni-${String(i)}`);
    const lines = diffLines(before, after);
    expect(lines.filter((l) => l.kind === "removed")).toHaveLength(2000);
    expect(lines.filter((l) => l.kind === "added")).toHaveLength(2000);
  });
});

describe("buildHunks", () => {
  it("değişiklik yoksa hunk üretmez", () => {
    expect(buildHunks(diffLines(["a"], ["a"]))).toEqual([]);
  });

  it("değişikliği bağlam satırlarıyla sarar", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const after = ["1", "2", "3", "4", "DEĞİŞTİ", "6", "7", "8", "9"];
    const hunks = buildHunks(diffLines(before, after));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines.some((l) => l.kind === "added")).toBe(true);
    // 3 bağlam + değişiklik + 3 bağlam
    expect(hunks[0]?.lines.length).toBeLessThanOrEqual(8);
  });

  it("uzak değişiklikleri ayrı hunk'lara böler", () => {
    const before = Array.from({ length: 40 }, (_, i) => String(i));
    const after = [...before];
    after[2] = "A";
    after[35] = "B";
    expect(buildHunks(diffLines(before, after))).toHaveLength(2);
  });

  it("hunk başlıklarında eski/yeni satır numaralarını taşır", () => {
    const hunks = buildHunks(diffLines(["a", "b", "c"], ["a", "X", "c"]));
    expect(hunks[0]?.oldStart).toBe(1);
    expect(hunks[0]?.newStart).toBe(1);
  });
});

describe("summarizeFile", () => {
  it("hassas dosyanın içeriğini payload'a koymaz", () => {
    const summary = summarizeFile(".env", "modified", { content: "SECRET=eski", bytes: 11 }, { content: "SECRET=yeni", bytes: 11 });
    expect(summary.previewStatus).toBe("redacted");
    expect(summary.hunks).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain("SECRET");
  });

  it("ikili dosyayı özetler", () => {
    const summary = summarizeFile("logo.png", "modified", { content: "a\0b", bytes: 3 }, { content: "c\0d", bytes: 3 });
    expect(summary.previewStatus).toBe("binary");
    expect(summary.hunks).toEqual([]);
  });

  it("sınır aşan dosyayı özetler", () => {
    const big = LIVE_DIFF_LIMITS.maxFileBytes + 1;
    const summary = summarizeFile("big.ts", "modified", { content: "a", bytes: big }, { content: "b", bytes: big });
    expect(summary.previewStatus).toBe("too-large");
  });

  it("satır sınırını aşan dosyayı özetler", () => {
    const many = Array.from({ length: LIVE_DIFF_LIMITS.maxFileLines + 1 }, () => "x").join("\n");
    const summary = summarizeFile("many.ts", "modified", { content: "x", bytes: 1 }, { content: many, bytes: many.length });
    expect(summary.previewStatus).toBe("too-large");
  });

  it("okunamayan dosyayı işaretler", () => {
    const summary = summarizeFile("locked.ts", "modified", { content: null, bytes: 10 }, { content: "x", bytes: 1 });
    expect(summary.previewStatus).toBe("unreadable");
  });

  it("normal dosyada satır sayaçlarını ve hunk'ları üretir", () => {
    const summary = summarizeFile(
      "src/a.ts",
      "modified",
      { content: "const a = 1;\nexport default a;", bytes: 30 },
      { content: "const a = 2;\nexport default a;", bytes: 30 },
    );
    expect(summary.previewStatus).toBe("ok");
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
    expect(summary.hunks).toHaveLength(1);
  });

  it("olay başına gösterilen satır sınırını uygular", () => {
    const before = "";
    const after = Array.from({ length: 3000 }, (_, i) => `satır ${String(i)}`).join("\n");
    const summary = summarizeFile("new.ts", "created", null, { content: after, bytes: after.length });
    const rendered = summary.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
    expect(rendered).toBeLessThanOrEqual(LIVE_DIFF_LIMITS.maxRenderedLines);
    expect(before).toBe("");
  });
});

describe("buildFileChangeEvent", () => {
  it("dosya ve satır sayaçlarını toplar", () => {
    const event = buildFileChangeEvent("t1", [
      { path: "a.ts", action: "created", added: 10, removed: 0, previewStatus: "ok", hunks: [] },
      { path: "b.ts", action: "modified", added: 2, removed: 3, previewStatus: "ok", hunks: [] },
      { path: "c.ts", action: "deleted", added: 0, removed: 5, previewStatus: "ok", hunks: [] },
    ]);
    expect(event.counts).toEqual({ created: 1, modified: 1, deleted: 1 });
    expect(event.lineCounts).toEqual({ added: 12, removed: 8 });
  });
});

describe("LiveDiffTracker", () => {
  function reader(files: Record<string, string>): { reader: WorkspaceReader; files: Record<string, string> } {
    const state = { ...files };
    return {
      files: state,
      reader: {
        listFiles: () => Promise.resolve(Object.keys(state)),
        readFile: (_root, path) => {
          const content = state[path];
          return Promise.resolve(content === undefined ? null : { content, bytes: content.length });
        },
      },
    };
  }

  it("oluşturulan, değiştirilen ve silinen dosyaları raporlar", async () => {
    const fs = reader({ "a.ts": "eski", "b.ts": "kalacak", "c.ts": "silinecek" });
    const tracker = new LiveDiffTracker(fs.reader, "C:/p");
    await tracker.capture();

    fs.files["a.ts"] = "yeni";
    fs.files["d.ts"] = "yeni dosya";
    delete fs.files["c.ts"];

    const changes = await tracker.scan();
    expect(changes.map((c) => [c.path, c.action])).toEqual([
      ["a.ts", "modified"],
      ["c.ts", "deleted"],
      ["d.ts", "created"],
    ]);
    // Değişmeyen dosya raporlanmaz.
    expect(changes.some((c) => c.path === "b.ts")).toBe(false);
  });

  it("yok sayılan klasörleri hiç taramaz", async () => {
    const fs = reader({ "src/a.ts": "x", "node_modules/pkg/index.js": "y", ".git/HEAD": "z" });
    const tracker = new LiveDiffTracker(fs.reader, "C:/p");
    await tracker.capture();

    fs.files["node_modules/pkg/index.js"] = "değişti";
    fs.files["src/a.ts"] = "değişti";

    const changes = await tracker.scan();
    expect(changes.map((c) => c.path)).toEqual(["src/a.ts"]);
  });

  it("değişiklik yoksa boş sonuç verir", async () => {
    const fs = reader({ "a.ts": "sabit" });
    const tracker = new LiveDiffTracker(fs.reader, "C:/p");
    await tracker.capture();
    expect(await tracker.scan()).toEqual([]);
  });
});
