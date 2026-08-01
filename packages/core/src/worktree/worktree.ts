import type { NexcodeConfig } from "../config/schema";

/**
 * Görev başına git worktree izolasyonu.
 *
 * `worktree.mode: "task"` iken görev, kullanıcının ana çalışma ağacına hiç dokunmadan kendi
 * worktree'sinde ve kendi branch'inde koşar. Teslimatta iş o branch'e commit'lenir. Uzağa
 * hiçbir şey gönderilmez: push ve PR bu katmanın işi değildir.
 *
 * İki kritik değişmez:
 *
 * 1. **`workingDir` ile `projectDir` ayrımı.** Agent süreçleri, snapshot, canlı diff, checkpoint
 *    ve doğrulama kapısı izole ağacı (`workingDir`) hedefler. Proje profili (`.nexcode/CONTEXT.md`)
 *    ise özgün depoda (`projectDir`) tutulur. Profil worktree'ye yazılırsa görev bitiminde
 *    ağaçla birlikte kaybolur.
 * 2. **Güvenli geri düşme.** Git yoksa, dizin depo değilse ya da HEAD yoksa izolasyon kurulmaz;
 *    uyarı üretilir ve görev eski davranışla ana ağaçta koşar. Hiçbir koşulda görev düşmez.
 */

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Süre aşımı nedeniyle sonlandırıldıysa true. */
  timedOut?: boolean;
}

/** Worktree katmanının dış dünyaya bağlandığı tek nokta. */
export interface WorktreePort {
  /** Bir programı argümanlarıyla çalıştırır (kabuk yorumlaması yok). */
  run: (input: { command: string; args: string[]; cwd: string; timeoutMs: number }) => Promise<CommandResult>;
  /** Kullanıcının yazdığı kurulum komutunu kabukta çalıştırır. */
  runShell: (input: { command: string; cwd: string; timeoutMs: number }) => Promise<CommandResult>;
  exists: (path: string) => Promise<boolean>;
  mkdirp: (path: string) => Promise<void>;
  /** Sembolik bağ kurar; desteklenmiyorsa hata fırlatır (çağıran uyarıya çevirir). */
  link: (target: string, linkPath: string) => Promise<void>;
  removeDir: (path: string) => Promise<void>;
}

export interface WorktreeOptions {
  port: WorktreePort;
  /**
   * İzole ağaçların açılacağı kök. Kullanıcının proje klasörünün DIŞINDA olmalıdır;
   * masaüstü uygulamasında `userData/worktrees` kullanılır.
   */
  root: string;
}

export interface WorktreeSetup {
  /** İzolasyon gerçekten kuruldu mu. false ise ana ağaçta çalışılır. */
  isolated: boolean;
  /** Agent'ların ve tüm dosya işlemlerinin hedefi. */
  workingDir: string;
  /** Özgün depo. Proje profili burada tutulur. */
  projectDir: string;
  branch: string | null;
  warnings: string[];
}

export interface WorktreeDelivery {
  branch: string;
  worktreePath: string;
  commit: string | null;
  committed: boolean;
  warnings: string[];
}

/** POSIX ayraçlı birleştirme. Git ve Node, Windows'ta da ileri eğik çizgiyi kabul eder. */
export function joinPath(...segments: string[]): string {
  return segments
    .map((segment, index) => {
      const trimmedEnd = segment.replace(/[\\/]+$/, "");
      return index === 0 ? trimmedEnd : trimmedEnd.replace(/^[\\/]+/, "");
    })
    .filter((segment) => segment !== "")
    .join("/");
}

/**
 * Görev id'sinden git için güvenli bir branch adı türetir.
 *
 * Git branch adları `~ ^ : ? * [ \` ve boşluk kabul etmez, `.lock` ile bitemez ve ardışık
 * nokta içeremez. Girdi kontrolümüzde olsa da isim üretimi savunmacı yazılır.
 */
export function branchNameFor(taskId: string, prefix: string): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9._\-/]/g, "").replace(/^\/+/, "");
  const safeId = taskId.replace(/[^A-Za-z0-9._-]/g, "-").replace(/\.{2,}/g, "-");
  const withSlash = safePrefix === "" ? "nexcode/" : safePrefix.endsWith("/") ? safePrefix : `${safePrefix}/`;
  return `${withSlash}task-${safeId}`;
}

export class WorktreeManager {
  private readonly port: WorktreePort;
  private readonly root: string;

  constructor(options: WorktreeOptions) {
    this.port = options.port;
    this.root = options.root;
  }

  /**
   * Görev için izole ağaç açar.
   *
   * Kapalıysa ya da ön koşullar sağlanmazsa `isolated: false` döner ve `workingDir` özgün
   * depo olarak kalır. Çağıranın ayrıca hata yakalaması gerekmez.
   */
  async setup(taskId: string, projectDir: string, cfg: NexcodeConfig): Promise<WorktreeSetup> {
    const fallback = (warnings: string[]): WorktreeSetup => ({
      isolated: false,
      workingDir: projectDir,
      projectDir,
      branch: null,
      warnings,
    });

    if (cfg.worktree.mode !== "task") return fallback([]);

    const repoRoot = await this.resolveRepoRoot(projectDir);
    if (repoRoot === null) {
      return fallback(["Çalışma klasörü bir git deposu değil; görev ana ağaçta koşacak."]);
    }
    if (!(await this.hasCommits(repoRoot))) {
      return fallback(["Depoda henüz commit yok (HEAD boş); görev ana ağaçta koşacak."]);
    }

    const branch = branchNameFor(taskId, cfg.worktree.branchPrefix);
    const path = joinPath(this.root, taskId);
    const warnings: string[] = [];

    await this.port.mkdirp(this.root);
    // Aynı id ile kalmış bir ağaç varsa git "already exists" der; önce kaydı temizlenir.
    if (await this.port.exists(path)) {
      await this.forceRemove(repoRoot, path);
    }

    const added = await this.port.run({
      command: "git",
      args: ["worktree", "add", "-b", branch, path, "HEAD"],
      cwd: repoRoot,
      timeoutMs: 120_000,
    });

    if (!added.ok) {
      return fallback([`İzole ağaç açılamadı, görev ana ağaçta koşacak: ${firstLine(added.stderr || added.stdout)}`]);
    }

    warnings.push(...(await this.linkPaths(repoRoot, path, cfg)));
    warnings.push(...(await this.runSetupCommands(path, cfg)));

    return { isolated: true, workingDir: path, projectDir: repoRoot, branch, warnings };
  }

  /**
   * İşi branch'e commit'ler.
   *
   * Değişiklik yoksa commit atılmaz ve `committed: false` döner; boş commit gürültüsü üretilmez.
   */
  async finalize(input: {
    setup: WorktreeSetup;
    cfg: NexcodeConfig;
    taskTitle: string;
    summary: string;
  }): Promise<WorktreeDelivery | null> {
    const { setup, cfg } = input;
    if (!setup.isolated || setup.branch === null) return null;

    const delivery: WorktreeDelivery = {
      branch: setup.branch,
      worktreePath: setup.workingDir,
      commit: null,
      committed: false,
      warnings: [],
    };

    if (!cfg.worktree.commit) return delivery;

    const staged = await this.port.run({
      command: "git",
      args: ["add", "-A"],
      cwd: setup.workingDir,
      timeoutMs: 120_000,
    });
    if (!staged.ok) {
      delivery.warnings.push(`Değişiklikler hazırlanamadı: ${firstLine(staged.stderr)}`);
      return delivery;
    }

    const pending = await this.port.run({
      command: "git",
      args: ["status", "--porcelain"],
      cwd: setup.workingDir,
      timeoutMs: 60_000,
    });
    if (pending.ok && pending.stdout.trim() === "") {
      delivery.warnings.push("Dosya değişikliği yok; commit atılmadı.");
      return delivery;
    }

    const committed = await this.port.run({
      command: "git",
      args: ["commit", "-m", commitMessage(input.taskTitle, input.summary)],
      cwd: setup.workingDir,
      timeoutMs: 120_000,
    });
    if (!committed.ok) {
      delivery.warnings.push(`Commit başarısız: ${firstLine(committed.stderr || committed.stdout)}`);
      return delivery;
    }

    const head = await this.port.run({
      command: "git",
      args: ["rev-parse", "HEAD"],
      cwd: setup.workingDir,
      timeoutMs: 30_000,
    });

    delivery.committed = true;
    delivery.commit = head.ok ? head.stdout.trim().slice(0, 40) : null;
    return delivery;
  }

  /**
   * Görev bittikten sonra izole ağacı kaldırır.
   *
   * Branch ve commit'ler depoda kalır; yalnızca çalışma kopyası silinir. Başarısız görevde
   * `keepOnFailure` açıksa ağaç incelensin diye korunur.
   */
  async cleanup(setup: WorktreeSetup, cfg: NexcodeConfig, outcome: "done" | "failed" | "blocked"): Promise<boolean> {
    if (!setup.isolated) return false;
    if (outcome !== "done" && cfg.worktree.keepOnFailure) return false;
    await this.forceRemove(setup.projectDir, setup.workingDir);
    return true;
  }

  private async resolveRepoRoot(dir: string): Promise<string | null> {
    const result = await this.port.run({
      command: "git",
      args: ["rev-parse", "--show-toplevel"],
      cwd: dir,
      timeoutMs: 30_000,
    });
    if (!result.ok) return null;
    const root = result.stdout.trim();
    return root === "" ? null : root;
  }

  private async hasCommits(repoRoot: string): Promise<boolean> {
    const result = await this.port.run({
      command: "git",
      args: ["rev-parse", "--verify", "HEAD"],
      cwd: repoRoot,
      timeoutMs: 30_000,
    });
    return result.ok && result.stdout.trim() !== "";
  }

  /** Depoya girmeyen ama derleme için gereken yolları (node_modules, .env) izole ağaca bağlar. */
  private async linkPaths(repoRoot: string, worktreePath: string, cfg: NexcodeConfig): Promise<string[]> {
    const warnings: string[] = [];
    for (const relative of cfg.worktree.linkPaths) {
      const target = joinPath(repoRoot, relative);
      if (!(await this.port.exists(target))) continue;
      try {
        await this.port.link(target, joinPath(worktreePath, relative));
      } catch (error) {
        warnings.push(`"${relative}" bağlanamadı: ${firstLine(String(error))}`);
      }
    }
    return warnings;
  }

  private async runSetupCommands(worktreePath: string, cfg: NexcodeConfig): Promise<string[]> {
    const warnings: string[] = [];
    const timeoutMs = cfg.worktree.setupTimeoutSeconds * 1000;

    for (const command of cfg.worktree.setupCommands) {
      const result = await this.port.runShell({ command, cwd: worktreePath, timeoutMs });
      if (!result.ok) {
        // Kurulum komutu görevi düşürmez; agent yine de çalışabilir ve operatör durumu görür.
        const reason = result.timedOut === true ? "süre aşımı" : firstLine(result.stderr || result.stdout);
        warnings.push(`Kurulum komutu başarısız ("${command}"): ${reason}`);
      }
    }
    return warnings;
  }

  private async forceRemove(repoRoot: string, worktreePath: string): Promise<void> {
    const removed = await this.port.run({
      command: "git",
      args: ["worktree", "remove", "--force", worktreePath],
      cwd: repoRoot,
      timeoutMs: 60_000,
    });
    if (!removed.ok) {
      // Git kaydı bozuksa klasörü elle silip kaydı buda; aksi halde id yeniden kullanılamaz.
      await this.port.removeDir(worktreePath);
      await this.port.run({ command: "git", args: ["worktree", "prune"], cwd: repoRoot, timeoutMs: 60_000 });
    }
  }
}

function commitMessage(taskTitle: string, summary: string): string {
  const subject = taskTitle.trim() === "" ? "NEXCODE görevi" : taskTitle.trim();
  const body = summary.trim();
  const header = subject.length > 72 ? `${subject.slice(0, 71)}…` : subject;
  return body === "" ? header : `${header}\n\n${body}`;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "bilinmeyen hata";
}
