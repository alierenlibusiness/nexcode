// Tek komutla geliştirme: better-sqlite3'ü Electron ABI'sine hazırlar,
// Next.js dev server'ı başlatır, hazır olunca Electron'u açar.
// Kullanım: pnpm dev   (veya npm run dev)
import { spawn } from "node:child_process";
import net from "node:net";
import { rebuildNative } from "./rebuild-native.mjs";

const RENDERER_PORT = 3000;

function waitForPort(port, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`Port ${port} zaman aşımı`));
        else setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

const procs = [];
const stopAll = () => {
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      /* yoksay */
    }
  }
};
process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});
process.on("exit", stopAll);

function spawnPnpm(args, extraEnv) {
  const p = spawn("pnpm", args, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  procs.push(p);
  return p;
}

console.log("[dev] better-sqlite3 Electron ABI'sine hazırlanıyor…");
rebuildNative("electron");

console.log(`[dev] renderer dev server başlatılıyor (:${RENDERER_PORT})…`);
spawnPnpm(["--filter", "@nexcode/renderer", "dev"]);

await waitForPort(RENDERER_PORT);

console.log("[dev] Electron başlatılıyor…");
const electron = spawnPnpm(["--filter", "@nexcode/desktop", "start"], {
  NEXCODE_RENDERER_URL: `http://localhost:${RENDERER_PORT}`,
});
electron.on("exit", () => {
  stopAll();
  process.exit(0);
});

console.log("\n[dev] Not: testlere dönmek için `pnpm rebuild:node` (better-sqlite3 → Node ABI).\n");
