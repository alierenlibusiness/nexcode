import type { DiffHunk, DiffLine, FileAction, FileChangeEvent, FileChangeSummary } from "./events";

/**
 * Canlı satır diff'i — Canlı Kod yüzeyini besler.
 *
 * Değişmezler:
 * - Hassas dosya içeriği (`.env`, credential, özel anahtar) **hiçbir zaman** olay
 *   payload'ına girmez; yalnızca dosyanın değiştiği bilgisi yayılır.
 * - Binary ve sınır aşan dosyalar özetlenir, içerikleri gösterilmez.
 * - `.git`, `node_modules` ve runtime klasörleri hiç taranmaz.
 */

export const LIVE_DIFF_LIMITS = {
  /** Dosya başına okunacak azami bayt. */
  maxFileBytes: 256 * 1024,
  /** Dosya başına karşılaştırılacak azami satır. */
  maxFileLines: 5000,
  /** Görev başlangıcında saklanacak azami toplam bayt. */
  maxBaselineBytes: 24 * 1024 * 1024,
  /** Görev başlangıcında saklanacak azami dosya sayısı. */
  maxBaselineFiles: 2000,
  /** Bir olayda gösterilecek azami satır. */
  maxRenderedLines: 1000,
  /** Hunk başına bağlam satırı. */
  contextLines: 3,
} as const;

/** Tarama dışı bırakılan klasörler. */
export const IGNORED_DIRECTORIES: readonly string[] = [
  ".git",
  "node_modules",
  ".next",
  "dist",
  "out",
  "build",
  "release",
  ".nexcode",
  ".turbo",
  ".venv",
  "__pycache__",
  ".pnpm-store",
];

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /(^|[\\/])\.env(\..*)?$/i,
  /(^|[\\/])(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$/i,
  /\.(pem|key|pfx|p12|keystore|jks)$/i,
  /(^|[\\/])(credentials|secrets?|\.npmrc|\.netrc|\.pgpass)$/i,
  /(^|[\\/])\.aws[\\/]/i,
  /(^|[\\/])\.ssh[\\/]/i,
];

/** Bu dosyanın içeriği olay payload'ına alınmaz. */
export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(path));
}

/** Bu yol taranmalı mı (yok sayılan klasörlerin altında değil mi). */
export function isScannable(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/);
  return !segments.some((segment) => IGNORED_DIRECTORIES.includes(segment));
}

/** İçerik ikili mi — NUL baytı veya yüksek oranda basılamayan karakter. */
export function isBinaryContent(content: string): boolean {
  if (content.includes("\0")) return true;
  const sample = content.slice(0, 8000);
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32 || code === 127) suspicious++;
  }
  return suspicious / sample.length > 0.1;
}

function splitLines(content: string): string[] {
  if (content === "") return [];
  return content.split(/\r?\n/);
}

/**
 * Satır bazlı fark. Ortak baş ve son kırpılır; kalan bölge küçükse LCS ile hizalanır,
 * büyükse tamamı "silindi + eklendi" olarak raporlanır (canlı görünüm için yeterli
 * doğrulukta ve sınırlı maliyette).
 */
export function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldMiddle = before.slice(prefix, before.length - suffix);
  const newMiddle = after.slice(prefix, after.length - suffix);

  const lines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;

  for (let i = 0; i < prefix; i++) {
    lines.push({ kind: "context", oldLineNo: oldNo++, newLineNo: newNo++, text: before[i] ?? "" });
  }

  const BOUND = 1500;
  if (oldMiddle.length > BOUND || newMiddle.length > BOUND) {
    for (const text of oldMiddle) lines.push({ kind: "removed", oldLineNo: oldNo++, newLineNo: null, text });
    for (const text of newMiddle) lines.push({ kind: "added", oldLineNo: null, newLineNo: newNo++, text });
  } else {
    for (const op of lcsDiff(oldMiddle, newMiddle)) {
      if (op.kind === "context") {
        lines.push({ kind: "context", oldLineNo: oldNo++, newLineNo: newNo++, text: op.text });
      } else if (op.kind === "removed") {
        lines.push({ kind: "removed", oldLineNo: oldNo++, newLineNo: null, text: op.text });
      } else {
        lines.push({ kind: "added", oldLineNo: null, newLineNo: newNo++, text: op.text });
      }
    }
  }

  for (let i = 0; i < suffix; i++) {
    const text = before[before.length - suffix + i] ?? "";
    lines.push({ kind: "context", oldLineNo: oldNo++, newLineNo: newNo++, text });
  }

  return lines;
}

type LcsOp = { kind: "context" | "added" | "removed"; text: string };

function lcsDiff(before: readonly string[], after: readonly string[]): LcsOp[] {
  const n = before.length;
  const m = after.length;
  if (n === 0) return after.map((text) => ({ kind: "added" as const, text }));
  if (m === 0) return before.map((text) => ({ kind: "removed" as const, text }));

  // (n+1) x (m+1) LCS uzunluk tablosu — sınırlar diffLines tarafından uygulanır.
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = table[i];
    const nextRow = table[i + 1];
    if (row === undefined || nextRow === undefined) continue;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = before[i] === after[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const ops: LcsOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: "context", text: before[i] ?? "" });
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      ops.push({ kind: "removed", text: before[i] ?? "" });
      i++;
    } else {
      ops.push({ kind: "added", text: after[j] ?? "" });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "removed", text: before[i++] ?? "" });
  while (j < m) ops.push({ kind: "added", text: after[j++] ?? "" });
  return ops;
}

/** Fark satırlarını Git benzeri hunk'lara böler (bağlam satırlarıyla). */
export function buildHunks(lines: readonly DiffLine[], contextLines = LIVE_DIFF_LIMITS.contextLines): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.kind === "context" ? -1 : index))
    .filter((index) => index !== -1);
  if (changed.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, (changed[0] ?? 0) - contextLines);
  let end = Math.min(lines.length - 1, (changed[0] ?? 0) + contextLines);

  for (const index of changed.slice(1)) {
    if (index - contextLines <= end + 1) {
      end = Math.min(lines.length - 1, index + contextLines);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, index - contextLines);
      end = Math.min(lines.length - 1, index + contextLines);
    }
  }
  ranges.push([start, end]);

  return ranges.map(([from, to]) => {
    const slice = lines.slice(from, to + 1);
    const oldNumbers = slice.map((line) => line.oldLineNo).filter((n): n is number => n !== null);
    const newNumbers = slice.map((line) => line.newLineNo).filter((n): n is number => n !== null);
    return {
      oldStart: oldNumbers[0] ?? 0,
      oldLines: oldNumbers.length,
      newStart: newNumbers[0] ?? 0,
      newLines: newNumbers.length,
      lines: slice,
    };
  });
}

export interface FileSnapshot {
  /** Görev başlangıcındaki içerik; okunamadıysa null. */
  content: string | null;
  bytes: number;
}

/** Bir dosyanın görev başlangıcına göre özetini üretir. */
export function summarizeFile(
  path: string,
  action: FileAction,
  before: FileSnapshot | null,
  after: FileSnapshot | null,
): FileChangeSummary {
  const base: Omit<FileChangeSummary, "previewStatus" | "hunks" | "added" | "removed"> = { path, action };

  if (isSensitivePath(path)) {
    return { ...base, added: 0, removed: 0, previewStatus: "redacted", hunks: [] };
  }

  const beforeContent = before?.content ?? "";
  const afterContent = after?.content ?? "";

  if ((before !== null && before.content === null) || (after !== null && after.content === null)) {
    return { ...base, added: 0, removed: 0, previewStatus: "unreadable", hunks: [] };
  }
  if (isBinaryContent(beforeContent) || isBinaryContent(afterContent)) {
    return { ...base, added: 0, removed: 0, previewStatus: "binary", hunks: [] };
  }
  if (
    (before?.bytes ?? 0) > LIVE_DIFF_LIMITS.maxFileBytes ||
    (after?.bytes ?? 0) > LIVE_DIFF_LIMITS.maxFileBytes
  ) {
    return { ...base, added: 0, removed: 0, previewStatus: "too-large", hunks: [] };
  }

  const beforeLines = splitLines(beforeContent);
  const afterLines = splitLines(afterContent);
  if (beforeLines.length > LIVE_DIFF_LIMITS.maxFileLines || afterLines.length > LIVE_DIFF_LIMITS.maxFileLines) {
    return { ...base, added: 0, removed: 0, previewStatus: "too-large", hunks: [] };
  }

  const lines = diffLines(beforeLines, afterLines);
  const added = lines.filter((line) => line.kind === "added").length;
  const removed = lines.filter((line) => line.kind === "removed").length;
  const hunks = capHunks(buildHunks(lines));

  return { ...base, added, removed, previewStatus: "ok", hunks };
}

/** Olay başına gösterilen satır sınırını uygular. */
function capHunks(hunks: readonly DiffHunk[]): DiffHunk[] {
  const out: DiffHunk[] = [];
  let budget: number = LIVE_DIFF_LIMITS.maxRenderedLines;
  for (const hunk of hunks) {
    if (budget <= 0) break;
    if (hunk.lines.length <= budget) {
      out.push(hunk);
      budget -= hunk.lines.length;
    } else {
      out.push({ ...hunk, lines: hunk.lines.slice(0, budget) });
      budget = 0;
    }
  }
  return out;
}

/** Dosya özetlerinden olay gövdesini kurar. */
export function buildFileChangeEvent(taskId: string, files: readonly FileChangeSummary[]): FileChangeEvent {
  const counts: Record<FileAction, number> = { created: 0, modified: 0, deleted: 0 };
  let added = 0;
  let removed = 0;
  for (const file of files) {
    counts[file.action]++;
    added += file.added;
    removed += file.removed;
  }
  return { taskId, counts, lineCounts: { added, removed }, files: [...files] };
}

export interface WorkspaceReader {
  /** Taranabilir dosyaların köke göre yollarını döner. */
  listFiles: (root: string) => Promise<string[]>;
  /** Dosya içeriği; okunamıyorsa null. */
  readFile: (root: string, relativePath: string) => Promise<{ content: string | null; bytes: number } | null>;
}

/**
 * Görev başlangıcını yakalar ve sonraki taramalarda oluşturulan / değiştirilen /
 * silinen dosyaları üretir.
 */
export class LiveDiffTracker {
  private baseline = new Map<string, FileSnapshot>();

  constructor(
    private readonly reader: WorkspaceReader,
    private readonly root: string,
  ) {}

  /** Görev başlangıcındaki içeriği sınırlar dahilinde saklar. */
  async capture(): Promise<void> {
    this.baseline.clear();
    let totalBytes = 0;

    for (const path of (await this.reader.listFiles(this.root)).filter(isScannable)) {
      if (this.baseline.size >= LIVE_DIFF_LIMITS.maxBaselineFiles) break;
      if (totalBytes >= LIVE_DIFF_LIMITS.maxBaselineBytes) break;

      const file = await this.reader.readFile(this.root, path);
      if (file === null) continue;
      if (file.bytes > LIVE_DIFF_LIMITS.maxFileBytes) {
        this.baseline.set(path, { content: null, bytes: file.bytes });
        continue;
      }
      this.baseline.set(path, { content: file.content, bytes: file.bytes });
      totalBytes += file.bytes;
    }
  }

  /** Başlangıca göre mevcut değişiklikleri üretir. */
  async scan(): Promise<FileChangeSummary[]> {
    const current = new Set((await this.reader.listFiles(this.root)).filter(isScannable));
    const summaries: FileChangeSummary[] = [];

    for (const path of current) {
      const file = await this.reader.readFile(this.root, path);
      if (file === null) continue;
      const before = this.baseline.get(path) ?? null;
      const after: FileSnapshot = { content: file.content, bytes: file.bytes };

      if (before === null) {
        summaries.push(summarizeFile(path, "created", null, after));
      } else if (before.content !== after.content) {
        summaries.push(summarizeFile(path, "modified", before, after));
      }
    }

    for (const [path, before] of this.baseline) {
      if (!current.has(path)) {
        summaries.push(summarizeFile(path, "deleted", before, null));
      }
    }

    return summaries.sort((a, b) => a.path.localeCompare(b.path));
  }
}
