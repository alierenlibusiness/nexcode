import { spawnSync } from "node:child_process";

/** Bir komutun PATH'te kurulu olup olmadığını kontrol eder (where/which). */
function isInstalled(bin: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const res = spawnSync(probe, [bin], { stdio: "ignore", windowsHide: true, timeout: 4000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

const CLI_BINARIES: Readonly<Record<string, string>> = {
  "claude-code": "claude",
  codex: "codex",
  antigravity: "antigravity",
};

// Kurulum durumu oturum boyunca değişmez sayılır → tekrar `where` spawn'ını önlemek için cache.
const cache = new Map<string, boolean>();

/** Bir CLI türünün (claude-code/codex/antigravity) sistemde kurulu olup olmadığı (cache'li). */
export function isCliInstalled(cliKind: string): boolean {
  const bin = CLI_BINARIES[cliKind];
  if (!bin) return false;
  const cached = cache.get(cliKind);
  if (cached !== undefined) return cached;
  const result = isInstalled(bin);
  cache.set(cliKind, result);
  return result;
}
