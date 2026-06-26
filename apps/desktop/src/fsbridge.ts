import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

const IGNORED = new Set([".git", "node_modules", ".next", "dist", "out", ".turbo"]);
const MAX_FILE_BYTES = 2_000_000; // 2 MB — büyük/binary dosya koruması

/** Bir dizinin doğrudan çocukları (dizinler önce, ada göre). Lazy ağaç genişletme için. */
export function readDir(dirPath: string): FsEntry[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const out: FsEntry[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") && IGNORED.has(e.name)) continue;
    if (IGNORED.has(e.name)) continue;
    out.push({
      name: e.name,
      path: path.join(dirPath, e.name),
      kind: e.isDirectory() ? "directory" : "file",
    });
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export interface FileContent {
  path: string;
  content: string;
  truncated: boolean;
  tooLarge: boolean;
}

/** Bir dosyanın metin içeriği (büyük dosyalarda reddeder; salt-okunur görüntüleyici için). */
export function readFileText(filePath: string): FileContent {
  const size = statSync(filePath).size;
  if (size > MAX_FILE_BYTES) {
    return { path: filePath, content: "", truncated: false, tooLarge: true };
  }
  const content = readFileSync(filePath, "utf8");
  return { path: filePath, content, truncated: false, tooLarge: false };
}

/** Dosyaya yazar (editörden Ctrl+S kaydetme). Kullanıcının kendi düzenlemesi — insan eylemi. */
export function writeFileText(filePath: string, content: string): void {
  writeFileSync(filePath, content, "utf8");
}
