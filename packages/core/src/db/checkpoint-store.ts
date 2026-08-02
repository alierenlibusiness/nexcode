import { readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { DB } from "./connection";
import type { Checkpoint, CheckpointMeta, CheckpointPort } from "../checkpoints/checkpoints";
import { LIVE_DIFF_LIMITS, isBinaryContent, isScannable } from "../engine/live-diff";

/**
 * The SQLite plus file system implementation of `CheckpointPort`.
 *
 * Snapshot contents live in the database (transactional and portable in a single file).
 * Files whose content cannot be stored safely (binary or past the limits) are recorded with
 * `NULL` content, and restore leaves those files **untouched**.
 */
export class SqliteCheckpointStore implements CheckpointPort {
  constructor(private readonly db: DB) {}

  listFiles(root: string): Promise<string[]> {
    return Promise.resolve(walk(root, root));
  }

  readFile(root: string, relativePath: string): Promise<string | null> {
    try {
      const absolute = join(root, relativePath);
      if (statSync(absolute).size > LIVE_DIFF_LIMITS.maxFileBytes) return Promise.resolve(null);
      const content = readFileSync(absolute, "utf8");
      return Promise.resolve(isBinaryContent(content) ? null : content);
    } catch {
      return Promise.resolve(null);
    }
  }

  writeFile(root: string, relativePath: string, content: string): Promise<void> {
    const absolute = join(root, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
    return Promise.resolve();
  }

  deleteFile(root: string, relativePath: string): Promise<void> {
    rmSync(join(root, relativePath), { force: true });
    return Promise.resolve();
  }

  persist(checkpoint: Checkpoint): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO checkpoints (id, task_id, working_dir, created_at, kind, file_count) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          checkpoint.id,
          checkpoint.taskId,
          checkpoint.workingDir,
          checkpoint.createdAt,
          checkpoint.kind,
          checkpoint.fileCount,
        );

      const insert = this.db.prepare(
        "INSERT OR REPLACE INTO checkpoint_files (checkpoint_id, path, content) VALUES (?, ?, ?)",
      );
      for (const [path, content] of Object.entries(checkpoint.files)) {
        insert.run(checkpoint.id, path, content);
      }
    })();
    return Promise.resolve();
  }

  load(id: string): Promise<Checkpoint | null> {
    const meta = this.db.prepare("SELECT * FROM checkpoints WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (meta === undefined) return Promise.resolve(null);

    const rows = this.db.prepare("SELECT path, content FROM checkpoint_files WHERE checkpoint_id = ?").all(id) as Array<{
      path: string;
      content: string | null;
    }>;

    const files: Record<string, string | null> = {};
    for (const row of rows) files[row.path] = row.content;

    return Promise.resolve({ ...toMeta(meta), files });
  }

  list(workingDir: string): Promise<CheckpointMeta[]> {
    const rows = this.db
      .prepare("SELECT * FROM checkpoints WHERE working_dir = ? ORDER BY created_at DESC")
      .all(workingDir) as Array<Record<string, unknown>>;
    return Promise.resolve(rows.map(toMeta));
  }

  remove(id: string): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM checkpoint_files WHERE checkpoint_id = ?").run(id);
      this.db.prepare("DELETE FROM checkpoints WHERE id = ?").run(id);
    })();
    return Promise.resolve();
  }
}

function toMeta(row: Record<string, unknown>): CheckpointMeta {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    workingDir: String(row.working_dir),
    createdAt: String(row.created_at),
    kind: String(row.kind) === "redo" ? "redo" : "pre",
    fileCount: Number(row.file_count),
  };
}

/** Walks the working directory; never descends into ignored folders. */
function walk(root: string, current: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(current, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const absolute = join(current, entry.name);
    const relativePath = relative(root, absolute).split(sep).join("/");
    if (!isScannable(relativePath)) continue;

    if (entry.isDirectory()) {
      walk(root, absolute, out);
    } else if (entry.isFile()) {
      out.push(relativePath);
      if (out.length >= LIVE_DIFF_LIMITS.maxBaselineFiles) return out;
    }
  }
  return out;
}
