import path from "node:path";
import { app, BrowserWindow } from "electron";
import { logger } from "@nexcode/core";
import { openDatabase } from "@nexcode/core/db";
import { registerIpcHandlers } from "./ipc";

function resolveDbPath(): string {
  return path.join(app.getPath("userData"), "nexcode.db");
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Geliştirmede Next.js dev sunucusu, üretimde renderer'ın statik export'u yüklenir.
  const devUrl = process.env.NEXCODE_RENDERER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(path.join(__dirname, "..", "..", "renderer", "out", "index.html"));
  }
}

app
  .whenReady()
  .then(() => {
    const dbPath = resolveDbPath();
    const db = openDatabase(dbPath);
    registerIpcHandlers(db);
    logger.info("nexcode.main.ready", { dbPath });

    void createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    logger.error("nexcode.main.failed", { error: String(error) });
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
