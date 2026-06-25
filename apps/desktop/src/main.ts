import path from "node:path";
import { app, BrowserWindow } from "electron";
import { logger, Orchestrator } from "@nexcode/core";
import {
  openDatabase,
  WorkspaceRepository,
  TaskRepository,
  ApprovalRepository,
  AgentSettingsRepository,
} from "@nexcode/core/db";
import { KeyringSecretStore } from "@nexcode/core/keyring";
import { AdapterFactory } from "@nexcode/core/providers";
import { registerIpcHandlers, type IpcContext } from "./ipc";

const KEYCHAIN_SERVICE = "nexcode";

function resolveDbPath(): string {
  return path.join(app.getPath("userData"), "nexcode.db");
}

async function buildContext(): Promise<IpcContext> {
  const db = openDatabase(resolveDbPath());
  const workspaces = new WorkspaceRepository(db);
  const tasks = new TaskRepository(db);
  const approvals = new ApprovalRepository(db);
  const settings = new AgentSettingsRepository(db);
  const secretStore = new KeyringSecretStore();
  const apiKeyCache = new Map<string, string>();

  // Faz 1 tek workspace: yoksa varsayılan oluştur.
  const workspace = workspaces.list()[0] ?? workspaces.create({ name: "Default", repoPath: process.cwd() });

  // Mevcut Anthropic anahtarını keychain'den senkron cache'e yükle.
  try {
    const existing = await secretStore.get(KEYCHAIN_SERVICE, "anthropic");
    if (existing) apiKeyCache.set("anthropic", existing);
  } catch (error) {
    logger.warn("keychain.preload_failed", { error: String(error) });
  }

  const factory = new AdapterFactory({
    getApiKey: (provider) => apiKeyCache.get(provider) ?? null,
  });

  const orchestrator = new Orchestrator({
    tasks,
    resolveAdapter: (model, preference) => factory.resolve(model, preference),
    getPreference: (role) => settings.getPreference(workspace.id, role),
  });

  return {
    workspaces,
    tasks,
    approvals,
    settings,
    orchestrator,
    secretStore,
    apiKeyCache,
    workspaceId: workspace.id,
  };
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  const devUrl = process.env.NEXCODE_RENDERER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(path.join(__dirname, "..", "..", "renderer", "out", "index.html"));
  }
}

app
  .whenReady()
  .then(async () => {
    const ctx = await buildContext();
    registerIpcHandlers(ctx);
    logger.info("nexcode.main.ready", { workspaceId: ctx.workspaceId });

    await createWindow();

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
