import { isScannable, isSensitivePath } from "../engine/live-diff";

/**
 * Görev öncesi sürümleme.
 *
 * Agent'lar çalışmaya başlamadan önce çalışma klasörünün bir checkpoint'i alınır.
 * "Bu sürüme dön" değiştirilmiş ve silinmiş dosyaları geri getirir, görevden sonra
 * oluşan dosyaları kaldırır.
 *
 * İki güvenlik değişmezi:
 * 1. **Geri almanın geri alınması**: bir checkpoint geri yüklenmeden önce mevcut durum
 *    için yeni bir `redo` checkpoint'i oluşturulur.
 * 2. Geri yükleme yalnızca **motor boştayken** yapılabilir; çalışan agent'ın altından
 *    dosya çekilmez.
 */

export type CheckpointKind = "pre" | "redo";

export interface CheckpointMeta {
  id: string;
  taskId: string;
  workingDir: string;
  createdAt: string;
  kind: CheckpointKind;
  fileCount: number;
}

export interface Checkpoint extends CheckpointMeta {
  /**
   * Köke göre yol → içerik. `null`, dosyanın var olduğunu ama içeriğinin güvenle
   * saklanamadığını belirtir (ikili, hassas veya sınır aşan): geri yüklemede dokunulmaz.
   */
  files: Record<string, string | null>;
}

export interface CheckpointPort {
  listFiles: (root: string) => Promise<string[]>;
  readFile: (root: string, relativePath: string) => Promise<string | null>;
  writeFile: (root: string, relativePath: string, content: string) => Promise<void>;
  deleteFile: (root: string, relativePath: string) => Promise<void>;
  persist: (checkpoint: Checkpoint) => Promise<void>;
  load: (id: string) => Promise<Checkpoint | null>;
  list: (workingDir: string) => Promise<CheckpointMeta[]>;
  remove: (id: string) => Promise<void>;
}

export interface RestoreReport {
  restored: string[];
  deleted: string[];
  /** İçeriği güvenle saklanamadığı için dokunulmayan dosyalar. */
  skipped: string[];
  /** Geri almayı geri almak için oluşturulan checkpoint. */
  redoCheckpointId: string;
}

export type RestoreResult = { ok: true; report: RestoreReport } | { ok: false; error: string };

export interface CheckpointsOptions {
  retention: number;
  now?: () => Date;
  idFactory?: () => string;
}

export class Checkpoints {
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(
    private readonly port: CheckpointPort,
    private readonly options: CheckpointsOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.idFactory =
      options.idFactory ?? (() => `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  }

  /** Çalışma klasörünün anlık görüntüsünü alır ve saklama limitini uygular. */
  async capture(taskId: string, workingDir: string, kind: CheckpointKind = "pre"): Promise<CheckpointMeta> {
    const paths = (await this.port.listFiles(workingDir)).filter(isScannable);
    const files: Record<string, string | null> = {};

    for (const path of paths) {
      // Hassas dosyalar snapshot'a alınmaz; içerikleri diskte çoğaltılmaz.
      files[path] = isSensitivePath(path) ? null : await this.port.readFile(workingDir, path);
    }

    const checkpoint: Checkpoint = {
      id: this.idFactory(),
      taskId,
      workingDir,
      createdAt: this.now().toISOString(),
      kind,
      fileCount: paths.length,
      files,
    };

    await this.port.persist(checkpoint);
    await this.prune(workingDir);
    return toMeta(checkpoint);
  }

  /**
   * Bir checkpoint'e döner.
   *
   * `engineIdle` false ise hiçbir şey yapılmaz: çalışan bir görev sırasında geri yükleme
   * dosya sistemini agent'ın altından çeker.
   */
  async restore(id: string, engineIdle: boolean): Promise<RestoreResult> {
    if (!engineIdle) {
      return { ok: false, error: "Sürüm geri yükleme yalnızca motor boştayken yapılabilir." };
    }

    const checkpoint = await this.port.load(id);
    if (checkpoint === null) {
      return { ok: false, error: `Checkpoint bulunamadı: ${id}` };
    }

    // 1) Geri almanın geri alınması: mevcut durum için redo checkpoint'i.
    const redo = await this.capture(checkpoint.taskId, checkpoint.workingDir, "redo");

    const current = new Set((await this.port.listFiles(checkpoint.workingDir)).filter(isScannable));
    const restored: string[] = [];
    const deleted: string[] = [];
    const skipped: string[] = [];

    // 2) Değiştirilmiş ve silinmiş dosyaları geri getir.
    for (const [path, content] of Object.entries(checkpoint.files)) {
      if (content === null) {
        skipped.push(path);
        continue;
      }
      const existing = current.has(path) ? await this.port.readFile(checkpoint.workingDir, path) : null;
      if (existing !== content) {
        await this.port.writeFile(checkpoint.workingDir, path, content);
        restored.push(path);
      }
    }

    // 3) Görevden sonra oluşan dosyaları kaldır.
    for (const path of current) {
      if (!(path in checkpoint.files)) {
        await this.port.deleteFile(checkpoint.workingDir, path);
        deleted.push(path);
      }
    }

    return {
      ok: true,
      report: {
        restored: restored.sort(),
        deleted: deleted.sort(),
        skipped: skipped.sort(),
        redoCheckpointId: redo.id,
      },
    };
  }

  list(workingDir: string): Promise<CheckpointMeta[]> {
    return this.port.list(workingDir);
  }

  /** Saklama limitini aşan en eski checkpoint'leri siler. */
  private async prune(workingDir: string): Promise<void> {
    const all = [...(await this.port.list(workingDir))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const meta of all.slice(this.options.retention)) {
      await this.port.remove(meta.id);
    }
  }
}

function toMeta(checkpoint: Checkpoint): CheckpointMeta {
  const { files: _files, ...meta } = checkpoint;
  return meta;
}
