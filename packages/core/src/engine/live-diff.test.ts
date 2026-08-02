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
  it("flags credential and key files", () => {
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

  it("does not flag ordinary source files", () => {
    for (const path of ["src/index.ts", "README.md", "environment.ts", "src/keyboard.tsx"]) {
      expect(isSensitivePath(path)).toBe(false);
    }
  });
});

describe("isScannable", () => {
  it("excludes runtime and dependency folders", () => {
    expect(isScannable("node_modules/foo/index.js")).toBe(false);
    expect(isScannable(".git/config")).toBe(false);
    expect(isScannable("apps/renderer/.next/build.js")).toBe(false);
    expect(isScannable(".nexcode/TASK-1.md")).toBe(false);
  });

  it("scans source files", () => {
    expect(isScannable("src/engine/engine.ts")).toBe(true);
    expect(isScannable("packages/core/src/index.ts")).toBe(true);
  });
});

describe("isBinaryContent", () => {
  it("counts content with a NUL byte as binary", () => {
    expect(isBinaryContent("abc\0def")).toBe(true);
  });

  it("does not count text content as binary", () => {
    expect(isBinaryContent("const a = 1;\nexport default a;\n")).toBe(false);
    expect(isBinaryContent("accented characters: aeiou with marks")).toBe(false);
    expect(isBinaryContent("")).toBe(false);
  });

  it("counts dense control characters as binary", () => {
    expect(isBinaryContent("\x01\x02\x03\x04\x05\x06\x07\x08")).toBe(true);
  });
});

describe("diffLines", () => {
  it("produces no change for an unchanged file", () => {
    const lines = diffLines(["a", "b"], ["a", "b"]);
    expect(lines.every((line) => line.kind === "context")).toBe(true);
  });

  it("numbers an added line correctly", () => {
    const lines = diffLines(["a", "c"], ["a", "b", "c"]);
    const added = lines.filter((line) => line.kind === "added");
    expect(added).toHaveLength(1);
    expect(added[0]?.text).toBe("b");
    expect(added[0]?.newLineNo).toBe(2);
    expect(added[0]?.oldLineNo).toBeNull();
  });

  it("numbers a removed line correctly", () => {
    const lines = diffLines(["a", "b", "c"], ["a", "c"]);
    const removed = lines.filter((line) => line.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]?.text).toBe("b");
    expect(removed[0]?.oldLineNo).toBe(2);
    expect(removed[0]?.newLineNo).toBeNull();
  });

  it("shows a changed line as a removal plus an addition", () => {
    const lines = diffLines(["a", "old", "c"], ["a", "new", "c"]);
    expect(lines.filter((l) => l.kind === "removed").map((l) => l.text)).toEqual(["old"]);
    expect(lines.filter((l) => l.kind === "added").map((l) => l.text)).toEqual(["new"]);
  });

  it("counts creating content from an empty file as additions", () => {
    const lines = diffLines([], ["a", "b"]);
    expect(lines.filter((l) => l.kind === "added")).toHaveLength(2);
  });

  it("reports a full change for a very large changed region", () => {
    const before = Array.from({ length: 2000 }, (_, i) => `old-${String(i)}`);
    const after = Array.from({ length: 2000 }, (_, i) => `new-${String(i)}`);
    const lines = diffLines(before, after);
    expect(lines.filter((l) => l.kind === "removed")).toHaveLength(2000);
    expect(lines.filter((l) => l.kind === "added")).toHaveLength(2000);
  });
});

describe("buildHunks", () => {
  it("produces no hunk when there is no change", () => {
    expect(buildHunks(diffLines(["a"], ["a"]))).toEqual([]);
  });

  it("wraps the change in context lines", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const after = ["1", "2", "3", "4", "CHANGED", "6", "7", "8", "9"];
    const hunks = buildHunks(diffLines(before, after));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines.some((l) => l.kind === "added")).toBe(true);
    // 3 context + the change + 3 context
    expect(hunks[0]?.lines.length).toBeLessThanOrEqual(8);
  });

  it("splits distant changes into separate hunks", () => {
    const before = Array.from({ length: 40 }, (_, i) => String(i));
    const after = [...before];
    after[2] = "A";
    after[35] = "B";
    expect(buildHunks(diffLines(before, after))).toHaveLength(2);
  });

  it("carries the old and new line numbers in the hunk headers", () => {
    const hunks = buildHunks(diffLines(["a", "b", "c"], ["a", "X", "c"]));
    expect(hunks[0]?.oldStart).toBe(1);
    expect(hunks[0]?.newStart).toBe(1);
  });
});

describe("summarizeFile", () => {
  it("never puts the content of a sensitive file into the payload", () => {
    const summary = summarizeFile(".env", "modified", { content: "SECRET=old", bytes: 10 }, { content: "SECRET=new", bytes: 10 });
    expect(summary.previewStatus).toBe("redacted");
    expect(summary.hunks).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain("SECRET");
  });

  it("summarises a binary file", () => {
    const summary = summarizeFile("logo.png", "modified", { content: "a\0b", bytes: 3 }, { content: "c\0d", bytes: 3 });
    expect(summary.previewStatus).toBe("binary");
    expect(summary.hunks).toEqual([]);
  });

  it("summarises a file past the byte limit", () => {
    const big = LIVE_DIFF_LIMITS.maxFileBytes + 1;
    const summary = summarizeFile("big.ts", "modified", { content: "a", bytes: big }, { content: "b", bytes: big });
    expect(summary.previewStatus).toBe("too-large");
  });

  it("summarises a file past the line limit", () => {
    const many = Array.from({ length: LIVE_DIFF_LIMITS.maxFileLines + 1 }, () => "x").join("\n");
    const summary = summarizeFile("many.ts", "modified", { content: "x", bytes: 1 }, { content: many, bytes: many.length });
    expect(summary.previewStatus).toBe("too-large");
  });

  it("flags an unreadable file", () => {
    const summary = summarizeFile("locked.ts", "modified", { content: null, bytes: 10 }, { content: "x", bytes: 1 });
    expect(summary.previewStatus).toBe("unreadable");
  });

  it("produces line counters and hunks for an ordinary file", () => {
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

  it("applies the per-event rendered line limit", () => {
    const before = "";
    const after = Array.from({ length: 3000 }, (_, i) => `line ${String(i)}`).join("\n");
    const summary = summarizeFile("new.ts", "created", null, { content: after, bytes: after.length });
    const rendered = summary.hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
    expect(rendered).toBeLessThanOrEqual(LIVE_DIFF_LIMITS.maxRenderedLines);
    expect(before).toBe("");
  });
});

describe("buildFileChangeEvent", () => {
  it("aggregates the file and line counters", () => {
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

  it("reports created, modified and deleted files", async () => {
    const fs = reader({ "a.ts": "old", "b.ts": "stays", "c.ts": "will be deleted" });
    const tracker = new LiveDiffTracker(fs.reader, "C:/p");
    await tracker.capture();

    fs.files["a.ts"] = "new";
    fs.files["d.ts"] = "new file";
    delete fs.files["c.ts"];

    const changes = await tracker.scan();
    expect(changes.map((c) => [c.path, c.action])).toEqual([
      ["a.ts", "modified"],
      ["c.ts", "deleted"],
      ["d.ts", "created"],
    ]);
    // An unchanged file is not reported.
    expect(changes.some((c) => c.path === "b.ts")).toBe(false);
  });

  it("never scans ignored folders", async () => {
    const fs = reader({ "src/a.ts": "x", "node_modules/pkg/index.js": "y", ".git/HEAD": "z" });
    const tracker = new LiveDiffTracker(fs.reader, "C:/p");
    await tracker.capture();

    fs.files["node_modules/pkg/index.js"] = "changed";
    fs.files["src/a.ts"] = "changed";

    const changes = await tracker.scan();
    expect(changes.map((c) => c.path)).toEqual(["src/a.ts"]);
  });

  it("returns an empty result when nothing changed", async () => {
    const fs = reader({ "a.ts": "constant" });
    const tracker = new LiveDiffTracker(fs.reader, "C:/p");
    await tracker.capture();
    expect(await tracker.scan()).toEqual([]);
  });
});
