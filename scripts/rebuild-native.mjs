// better-sqlite3 native binary'sini hedef runtime ABI'sine (node | electron) çeker.
// Kullanım: node scripts/rebuild-native.mjs [node|electron]
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function rebuildNative(runtime) {
  const pnpmDir = join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) {
    throw new Error("node_modules/.pnpm yok: önce `pnpm install` çalıştır.");
  }
  const entry = readdirSync(pnpmDir).find((d) => d.startsWith("better-sqlite3@"));
  if (!entry) throw new Error("better-sqlite3 bulunamadı.");
  const bs3Dir = join(pnpmDir, entry, "node_modules", "better-sqlite3");

  let cmd = `npx -y prebuild-install -r ${runtime}`;
  if (runtime === "electron") {
    const electronPkg = join(root, "apps", "desktop", "node_modules", "electron", "package.json");
    const version = JSON.parse(readFileSync(electronPkg, "utf8")).version;
    cmd += ` -t ${version}`;
    console.log(`[native] better-sqlite3 → Electron ${version} ABI`);
  } else {
    console.log(`[native] better-sqlite3 → Node ${process.versions.node} ABI`);
  }
  execSync(cmd, { cwd: bs3Dir, stdio: "inherit" });
}

if (process.argv[1] && process.argv[1].endsWith("rebuild-native.mjs")) {
  const runtime = process.argv[2] === "electron" ? "electron" : "node";
  rebuildNative(runtime);
}
