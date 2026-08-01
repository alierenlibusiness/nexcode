import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

const IGNORED = new Set([".git", "node_modules", ".next", "dist", "out", ".turbo"]);
const MAX_FILE_BYTES = 2_000_000; // 2 MB: büyük/binary dosya koruması

/**
 * Bir yolun açılmış kök klasörün İÇİNDE kaldığını doğrular.
 *
 * Dosya köprüsü IPC üzerinden mutlak yol alır. Kapsama kontrolü olmadan `../../.ssh/id_rsa`
 * gibi bir istek kökün dışına çıkabilir; renderer bugün kendi paketimiz olsa da bu köprü
 * kullanıcının açtığı klasörden fazlasına erişmemelidir.
 *
 * Karşılaştırma `path.relative` üzerinden yapılır: ayraç farkları, `..` bileşenleri ve
 * Windows'ta büyük/küçük harf normalize edilir. Salt string önek kontrolü `/repo-secrets`
 * yolunu `/repo` içinde sayardı.
 */
export function assertInsideRoot(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  const escapes = relative.startsWith("..") || path.isAbsolute(relative);
  if (escapes) {
    throw new Error(`Yol çalışma klasörünün dışında: ${target}`);
  }
  return resolvedTarget;
}

/** Bir dizinin doğrudan çocukları (dizinler önce, ada göre). Lazy ağaç genişletme için. */
export function readDir(dirPath: string, root?: string): FsEntry[] {
  const safe = root === undefined ? dirPath : assertInsideRoot(root, dirPath);
  const entries = readdirSync(safe, { withFileTypes: true });
  const out: FsEntry[] = [];

  for (const e of entries) {
    if (IGNORED.has(e.name)) continue;
    out.push({
      name: e.name,
      path: path.join(safe, e.name),
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
export function readFileText(filePath: string, root?: string): FileContent {
  const safe = root === undefined ? filePath : assertInsideRoot(root, filePath);
  const size = statSync(safe).size;
  if (size > MAX_FILE_BYTES) {
    return { path: safe, content: "", truncated: false, tooLarge: true };
  }
  return { path: safe, content: readFileSync(safe, "utf8"), truncated: false, tooLarge: false };
}

/** Dosyaya yazar (editörden kaydetme). Kullanıcının kendi düzenlemesi: insan eylemi. */
export function writeFileText(filePath: string, content: string, root?: string): void {
  const safe = root === undefined ? filePath : assertInsideRoot(root, filePath);
  writeFileSync(safe, content, "utf8");
}
