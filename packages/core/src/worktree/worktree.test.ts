import { describe, it, expect } from "vitest";
import { WorktreeManager, branchNameFor, joinPath, type CommandResult, type WorktreePort } from "./worktree";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";

interface Call {
  command: string;
  args: string[];
  cwd: string;
}

interface FakeOptions {
  /** `git <alt komut>` anahtarına göre sonuç; verilmeyen komut başarılı sayılır. */
  results?: Record<string, Partial<CommandResult>>;
  existing?: string[];
  linkFails?: boolean;
  shellFails?: string[];
}

function fakePort(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const shellCalls: string[] = [];
  const removedDirs: string[] = [];
  const links: Array<{ target: string; linkPath: string }> = [];
  const existing = new Set(options.existing ?? []);

  const port: WorktreePort = {
    run: ({ command, args, cwd }) => {
      calls.push({ command, args, cwd });
      const key = args.slice(0, 2).join(" ");
      const exact = options.results?.[args.join(" ")];
      const byPrefix = options.results?.[key] ?? options.results?.[args[0] ?? ""];
      const override = exact ?? byPrefix;
      return Promise.resolve({ ok: true, stdout: "", stderr: "", ...override });
    },
    runShell: ({ command }) => {
      shellCalls.push(command);
      const fails = options.shellFails?.includes(command) ?? false;
      return Promise.resolve({ ok: !fails, stdout: "", stderr: fails ? "komut hatası" : "" });
    },
    exists: (path) => Promise.resolve(existing.has(path)),
    mkdirp: () => Promise.resolve(),
    link: (target, linkPath) => {
      if (options.linkFails === true) return Promise.reject(new Error("EPERM: symlink izni yok"));
      links.push({ target, linkPath });
      return Promise.resolve();
    },
    removeDir: (path) => {
      removedDirs.push(path);
      return Promise.resolve();
    },
  };

  return { port, calls, shellCalls, removedDirs, links };
}

function config(worktree: Partial<NexcodeConfig["worktree"]> = {}): NexcodeConfig {
  return normalizeConfig({
    ...FALLBACK_CONFIG,
    worktree: { mode: "task", ...worktree },
  });
}

/** Depo kökü ve HEAD sorgularını başarılı döndüren temel senaryo. */
function healthyRepo(extra: FakeOptions = {}): FakeOptions {
  return {
    ...extra,
    results: {
      "rev-parse --show-toplevel": { ok: true, stdout: "/repo\n" },
      "rev-parse --verify": { ok: true, stdout: "abc123\n" },
      ...extra.results,
    },
  };
}

describe("branchNameFor", () => {
  it("ön eke eğik çizgi ekler ve görev id'sini kullanır", () => {
    expect(branchNameFor("abc", "nexcode")).toBe("nexcode/task-abc");
    expect(branchNameFor("abc", "nexcode/")).toBe("nexcode/task-abc");
  });

  it("git'in kabul etmediği karakterleri temizler", () => {
    expect(branchNameFor("a b:c^d~e?", "feat/")).toBe("feat/task-a-b-c-d-e-");
    expect(branchNameFor("a..b", "x/")).toBe("x/task-a-b");
  });

  it("boş ön ekte güvenli varsayılana döner", () => {
    expect(branchNameFor("t1", "")).toBe("nexcode/task-t1");
    expect(branchNameFor("t1", "???")).toBe("nexcode/task-t1");
  });
});

describe("joinPath", () => {
  it("fazla ayraçları tekilleştirir ve boş parçaları atar", () => {
    expect(joinPath("/root/", "/child/", "leaf")).toBe("/root/child/leaf");
    expect(joinPath("C:\\data\\", "wt", "")).toBe("C:\\data/wt");
  });
});

describe("WorktreeManager.setup", () => {
  it("mode off iken izolasyon kurmaz ve ana ağaçta kalır", async () => {
    const { port, calls } = fakePort();
    const manager = new WorktreeManager({ port, root: "/wt" });

    const setup = await manager.setup("t1", "/proje", normalizeConfig(FALLBACK_CONFIG));
    expect(setup.isolated).toBe(false);
    expect(setup.workingDir).toBe("/proje");
    expect(calls).toHaveLength(0);
  });

  it("izole ağaç açar ve workingDir ile projectDir'i ayırır", async () => {
    const { port, calls } = fakePort(healthyRepo());
    const manager = new WorktreeManager({ port, root: "/wt" });

    const setup = await manager.setup("t1", "/proje", config());
    expect(setup.isolated).toBe(true);
    expect(setup.workingDir).toBe("/wt/t1");
    expect(setup.projectDir).toBe("/repo");
    expect(setup.branch).toBe("nexcode/task-t1");

    const add = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add");
    expect(add?.args).toEqual(["worktree", "add", "-b", "nexcode/task-t1", "/wt/t1", "HEAD"]);
    expect(add?.cwd).toBe("/repo");
  });

  it("git deposu değilse uyarıyla ana ağaca düşer", async () => {
    const { port } = fakePort({ results: { "rev-parse --show-toplevel": { ok: false, stderr: "not a repo" } } });
    const manager = new WorktreeManager({ port, root: "/wt" });

    const setup = await manager.setup("t1", "/proje", config());
    expect(setup.isolated).toBe(false);
    expect(setup.workingDir).toBe("/proje");
    expect(setup.warnings[0]).toContain("git deposu değil");
  });

  it("HEAD yoksa (commit'siz depo) ana ağaca düşer", async () => {
    const { port } = fakePort({
      results: {
        "rev-parse --show-toplevel": { ok: true, stdout: "/repo\n" },
        "rev-parse --verify": { ok: false, stderr: "unknown revision" },
      },
    });
    const manager = new WorktreeManager({ port, root: "/wt" });

    const setup = await manager.setup("t1", "/proje", config());
    expect(setup.isolated).toBe(false);
    expect(setup.warnings[0]).toContain("commit yok");
  });

  it("worktree add başarısızsa görev düşmez, ana ağaçta koşar", async () => {
    const { port } = fakePort(healthyRepo({ results: { "worktree add": { ok: false, stderr: "fatal: exists" } } }));
    const manager = new WorktreeManager({ port, root: "/wt" });

    const setup = await manager.setup("t1", "/proje", config());
    expect(setup.isolated).toBe(false);
    expect(setup.workingDir).toBe("/proje");
    expect(setup.warnings[0]).toContain("ana ağaçta koşacak");
  });

  it("aynı id ile kalmış ağacı önce temizler", async () => {
    const { port, calls } = fakePort(healthyRepo({ existing: ["/wt/t1"] }));
    const manager = new WorktreeManager({ port, root: "/wt" });
    await manager.setup("t1", "/proje", config());

    const removeIndex = calls.findIndex((c) => c.args[1] === "remove");
    const addIndex = calls.findIndex((c) => c.args[1] === "add");
    expect(removeIndex).toBeGreaterThanOrEqual(0);
    expect(removeIndex).toBeLessThan(addIndex);
  });

  it("var olan linkPaths'i bağlar, olmayanı atlar", async () => {
    const { port, links } = fakePort(healthyRepo({ existing: ["/repo/node_modules"] }));
    const manager = new WorktreeManager({ port, root: "/wt" });

    await manager.setup("t1", "/proje", config({ linkPaths: ["node_modules", ".env"] }));
    expect(links).toEqual([{ target: "/repo/node_modules", linkPath: "/wt/t1/node_modules" }]);
  });

  it("bağlama başarısız olursa uyarır ama izolasyonu bozmaz", async () => {
    const { port } = fakePort(healthyRepo({ existing: ["/repo/node_modules"], linkFails: true }));
    const manager = new WorktreeManager({ port, root: "/wt" });

    const setup = await manager.setup("t1", "/proje", config({ linkPaths: ["node_modules"] }));
    expect(setup.isolated).toBe(true);
    expect(setup.warnings[0]).toContain("bağlanamadı");
  });

  it("kurulum komutlarını izole ağaçta çalıştırır; hata görevi düşürmez", async () => {
    const { port, shellCalls } = fakePort(healthyRepo({ shellFails: ["pnpm build"] }));
    const manager = new WorktreeManager({ port, root: "/wt" });

    const setup = await manager.setup("t1", "/proje", config({ setupCommands: ["pnpm install", "pnpm build"] }));
    expect(shellCalls).toEqual(["pnpm install", "pnpm build"]);
    expect(setup.isolated).toBe(true);
    expect(setup.warnings.some((w) => w.includes("pnpm build"))).toBe(true);
  });
});

describe("WorktreeManager.finalize", () => {
  const isolated = { isolated: true as const, workingDir: "/wt/t1", projectDir: "/repo", branch: "nexcode/task-t1", warnings: [] };

  it("izolasyon yoksa teslimat üretmez", async () => {
    const { port } = fakePort();
    const manager = new WorktreeManager({ port, root: "/wt" });

    const result = await manager.finalize({
      setup: { isolated: false, workingDir: "/proje", projectDir: "/proje", branch: null, warnings: [] },
      cfg: config(),
      taskTitle: "T",
      summary: "S",
    });
    expect(result).toBeNull();
  });

  it("değişiklikleri branch'e commit'ler ve hash döner", async () => {
    const { port, calls } = fakePort({
      results: {
        "status --porcelain": { ok: true, stdout: " M src/app.ts\n" },
        "rev-parse HEAD": { ok: true, stdout: "deadbeef1234\n" },
      },
    });
    const manager = new WorktreeManager({ port, root: "/wt" });

    const result = await manager.finalize({ setup: isolated, cfg: config(), taskTitle: "Login düzelt", summary: "Özet" });
    expect(result?.committed).toBe(true);
    expect(result?.commit).toBe("deadbeef1234");
    expect(result?.branch).toBe("nexcode/task-t1");

    const commit = calls.find((c) => c.args[0] === "commit");
    expect(commit?.args[2]).toBe("Login düzelt\n\nÖzet");
    expect(commit?.cwd).toBe("/wt/t1");
  });

  it("değişiklik yoksa boş commit atmaz", async () => {
    const { port, calls } = fakePort({ results: { "status --porcelain": { ok: true, stdout: "  \n" } } });
    const manager = new WorktreeManager({ port, root: "/wt" });

    const result = await manager.finalize({ setup: isolated, cfg: config(), taskTitle: "T", summary: "" });
    expect(result?.committed).toBe(false);
    expect(result?.warnings[0]).toContain("commit atılmadı");
    expect(calls.some((c) => c.args[0] === "commit")).toBe(false);
  });

  it("commit kapalıyken hiç git çağrısı yapmaz", async () => {
    const { port, calls } = fakePort();
    const manager = new WorktreeManager({ port, root: "/wt" });

    const result = await manager.finalize({ setup: isolated, cfg: config({ commit: false }), taskTitle: "T", summary: "" });
    expect(result?.committed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("commit başarısız olursa uyarı taşır, hata fırlatmaz", async () => {
    const { port } = fakePort({
      results: {
        "status --porcelain": { ok: true, stdout: " M a.ts\n" },
        commit: { ok: false, stderr: "fatal: kimlik ayarlı değil" },
      },
    });
    const manager = new WorktreeManager({ port, root: "/wt" });

    const result = await manager.finalize({ setup: isolated, cfg: config(), taskTitle: "T", summary: "" });
    expect(result?.committed).toBe(false);
    expect(result?.warnings[0]).toContain("kimlik ayarlı değil");
  });

  it("uzun başlığı commit konusunda kısaltır", async () => {
    const { port, calls } = fakePort({ results: { "status --porcelain": { ok: true, stdout: " M a.ts\n" } } });
    const manager = new WorktreeManager({ port, root: "/wt" });

    await manager.finalize({ setup: isolated, cfg: config(), taskTitle: "x".repeat(100), summary: "" });
    const subject = calls.find((c) => c.args[0] === "commit")?.args[2] ?? "";
    expect(subject.length).toBeLessThanOrEqual(72);
  });
});

describe("WorktreeManager.cleanup", () => {
  const isolated = { isolated: true as const, workingDir: "/wt/t1", projectDir: "/repo", branch: "nexcode/task-t1", warnings: [] };

  it("başarılı görevin ağacını kaldırır", async () => {
    const { port, calls } = fakePort();
    const manager = new WorktreeManager({ port, root: "/wt" });

    expect(await manager.cleanup(isolated, config(), "done")).toBe(true);
    expect(calls[0]?.args).toEqual(["worktree", "remove", "--force", "/wt/t1"]);
  });

  it("başarısız görevin ağacı keepOnFailure ile korunur", async () => {
    const { port, calls } = fakePort();
    const manager = new WorktreeManager({ port, root: "/wt" });

    expect(await manager.cleanup(isolated, config({ keepOnFailure: true }), "failed")).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("keepOnFailure kapalıyken başarısız görevin ağacı da kaldırılır", async () => {
    const { port, calls } = fakePort();
    const manager = new WorktreeManager({ port, root: "/wt" });

    expect(await manager.cleanup(isolated, config({ keepOnFailure: false }), "failed")).toBe(true);
    expect(calls.some((c) => c.args[1] === "remove")).toBe(true);
  });

  it("git remove başarısızsa klasörü silip kaydı budar", async () => {
    const { port, calls, removedDirs } = fakePort({ results: { "worktree remove": { ok: false, stderr: "bozuk" } } });
    const manager = new WorktreeManager({ port, root: "/wt" });

    await manager.cleanup(isolated, config(), "done");
    expect(removedDirs).toEqual(["/wt/t1"]);
    expect(calls.some((c) => c.args[1] === "prune")).toBe(true);
  });
});

describe("worktree yapılandırma normalizasyonu", () => {
  it("mutlak yolları ve .. kaçışlarını linkPaths'ten atar", () => {
    const cfg = config({ linkPaths: ["node_modules", "/etc/passwd", "../gizli", "C:\\Windows", "a/../b", "sub/dir"] });
    expect(cfg.worktree.linkPaths).toEqual(["node_modules", "sub/dir"]);
  });

  it("boş kurulum komutlarını temizler ve boş ön eki varsayılana çeker", () => {
    const cfg = config({ setupCommands: ["  pnpm i  ", "   ", ""], branchPrefix: "   " });
    expect(cfg.worktree.setupCommands).toEqual(["pnpm i"]);
    expect(cfg.worktree.branchPrefix).toBe("nexcode/");
  });

  it("izolasyon kapalıyken eşzamanlılık 1'e düşürülür", () => {
    const unsafe = normalizeConfig({ ...FALLBACK_CONFIG, maxConcurrentTasks: 4 });
    expect(unsafe.maxConcurrentTasks).toBe(1);

    const safe = normalizeConfig({ ...FALLBACK_CONFIG, maxConcurrentTasks: 4, worktree: { mode: "task" } });
    expect(safe.maxConcurrentTasks).toBe(4);
  });
});
