import type { NexcodeConfig } from "../config/schema";

/**
 * Ajan hapsi (write jail).
 *
 * `mode: "workspace"` agent'ın yalnızca çalışma klasörüne yazmasına izin verir; Docker ya da
 * Git gerektirmez. `extraWritableDirs` monorepo için çalışma klasörü dışında izin verilen
 * mutlak yolları listeler.
 *
 * Yol işlemleri saf tutulur (node:path kullanılmaz), böylece bu modül hem main process'te
 * hem de renderer'da güvenle import edilebilir ve Windows/POSIX ayraçları birlikte çalışır.
 */

/** Yolu karşılaştırılabilir biçime getirir: ayraçları birleştirir, `.`/`..` çözer. */
export function normalizePath(input: string): string {
  const unified = input.replace(/\\/g, "/");
  const isAbsolutePosix = unified.startsWith("/");
  const driveMatch = /^([a-zA-Z]):\//.exec(unified);
  const drive = driveMatch?.[1]?.toUpperCase();

  const body = drive !== undefined ? unified.slice(3) : isAbsolutePosix ? unified.slice(1) : unified;
  const stack: string[] = [];
  for (const segment of body.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Kökün üstüne çıkılamaz; göreli yolda `..` korunur.
      if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
      else if (drive === undefined && !isAbsolutePosix) stack.push("..");
      continue;
    }
    stack.push(segment);
  }

  const joined = stack.join("/");
  if (drive !== undefined) return `${drive}:/${joined}`;
  if (isAbsolutePosix) return `/${joined}`;
  return joined;
}

/** Windows'ta yol karşılaştırması büyük/küçük harfe duyarsızdır. */
function comparable(path: string): string {
  return /^[a-zA-Z]:\//.test(path) ? normalizePath(path).toLowerCase() : normalizePath(path);
}

/** `child`, `parent` klasörünün içinde mi (ya da onunla aynı mı). */
export function isInside(child: string, parent: string): boolean {
  const c = comparable(child);
  const p = comparable(parent);
  if (p === "") return false;
  if (c === p) return true;
  return c.startsWith(p.endsWith("/") ? p : `${p}/`);
}

export interface SandboxPolicy {
  enabled: boolean;
  workingDir: string;
  extraWritableDirs: readonly string[];
}

export function sandboxPolicyFor(config: NexcodeConfig, workingDir: string): SandboxPolicy {
  return {
    enabled: config.sandbox.mode === "workspace",
    workingDir,
    extraWritableDirs: config.sandbox.extraWritableDirs,
  };
}

/** Bu yola yazılabilir mi. Sandbox kapalıysa her yol yazılabilirdir. */
export function isWritable(target: string, policy: SandboxPolicy): boolean {
  if (!policy.enabled) return true;
  if (isInside(target, policy.workingDir)) return true;
  return policy.extraWritableDirs.some((dir) => isInside(target, dir));
}

export type WriteCheck = { allowed: true } | { allowed: false; reason: string };

/** Yazma denemesini denetler; reddedilirse kullanıcıya gösterilebilir gerekçe döner. */
export function checkWrite(target: string, policy: SandboxPolicy): WriteCheck {
  if (isWritable(target, policy)) return { allowed: true };
  return {
    allowed: false,
    reason: [
      `Sandbox: "${normalizePath(target)}" çalışma klasörünün dışında.`,
      `İzin verilen kök: ${normalizePath(policy.workingDir)}.`,
      policy.extraWritableDirs.length > 0
        ? `Ek yazılabilir yollar: ${policy.extraWritableDirs.map(normalizePath).join(", ")}.`
        : "Ek yazılabilir yol tanımlı değil (Ayarlar → Genel → sandbox.extraWritableDirs).",
    ].join(" "),
  };
}
