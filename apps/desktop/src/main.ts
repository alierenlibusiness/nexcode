import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, protocol, net, type WebContents } from "electron";
import {
  logger,
  Orchestrator,
  MessageBus,
  QuotaTracker,
  poolIdForProvider,
} from "@nexcode/core";
import {
  openDatabase,
  WorkspaceRepository,
  TaskRepository,
  ApprovalRepository,
  AgentSettingsRepository,
  CostLogRepository,
} from "@nexcode/core/db";
import { KeyringSecretStore } from "@nexcode/core/keyring";
import { AdapterFactory } from "@nexcode/core/providers";
import { registerIpcHandlers, type IpcContext } from "./ipc";

const KEYCHAIN_SERVICE = "nexcode";

let mainWindow: BrowserWindow | null = null;

// Renderer'ı özel `app://` protokolünden sunarız. Bu, Next.js statik export'unun MUTLAK
// asset yollarını (`/_next/...`) doğru çözer — `file://` altında bunlar bozulur (PRD §5.1).
// Şema, app hazır olmadan ÖNCE privileged kaydedilmeli.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** Paketli: resources/renderer/out; dev (env yoksa, dist'ten çalıştırma): ../../renderer/out. */
function rendererRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer", "out")
    : path.join(__dirname, "..", "..", "renderer", "out");
}

/** `app://` isteklerini renderer/out kök dizininden dosya olarak sunar (path traversal korumalı). */
function registerAppProtocol(): void {
  const root = rendererRoot();
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const rel = pathname === "/" || pathname === "" ? "/index.html" : pathname;
    const resolved = path.normalize(path.join(root, decodeURIComponent(rel)));
    // Kökün dışına çıkışı engelle.
    if (!resolved.startsWith(root)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}

function resolveDbPath(): string {
  return path.join(app.getPath("userData"), "nexcode.db");
}

async function buildContext(): Promise<IpcContext> {
  const db = openDatabase(resolveDbPath());
  const workspaces = new WorkspaceRepository(db);
  const tasks = new TaskRepository(db);
  const approvals = new ApprovalRepository(db);
  const settings = new AgentSettingsRepository(db);
  const costLogs = new CostLogRepository(db);
  const secretStore = new KeyringSecretStore();
  const apiKeyCache = new Map<string, string>();
  const messageBus = new MessageBus();
  const quota = new QuotaTracker();

  // Faz 1 tek workspace: yoksa varsayılan oluştur.
  const workspace =
    workspaces.list()[0] ?? workspaces.create({ name: "Default", repoPath: process.cwd() });

  // Mevcut API anahtarlarını keychain'den senkron cache'e yükle (tüm sağlayıcılar).
  for (const provider of ["anthropic", "openai", "google", "deepseek", "minimax", "kimi", "glm"]) {
    try {
      const existing = await secretStore.get(KEYCHAIN_SERVICE, provider);
      if (existing) apiKeyCache.set(provider, existing);
    } catch (error) {
      logger.warn("keychain.preload_failed", { provider, error: String(error) });
    }
  }

  const factory = new AdapterFactory({
    getApiKey: (provider) => apiKeyCache.get(provider) ?? null,
    // Kota dolduğunda CLI yerine API moduna geç (PRD §9.4).
    isCliQuotaAvailable: (provider) => {
      const pool = poolIdForProvider(provider);
      return pool ? quota.isAvailable(pool) : true;
    },
  });

  const orchestrator = new Orchestrator({
    tasks,
    resolveAdapter: (model, preference) => factory.resolve(model, preference),
    getPreference: (role) => settings.getPreference(workspace.id, role),
    resolveModel: (role) => settings.resolveModel(workspace.id, role),
    messageBus,
    onUsage: (u) => {
      // Maliyet kaydı (cost_logs) — CLI=abonelik havuzu (usd 0), API=taşma ücreti (§9.4).
      const pool = u.connectionMode === "cli" ? poolIdForProvider(u.model.provider) : null;
      costLogs.record({
        agentId: null,
        taskId: u.taskId,
        provider: u.model.provider,
        modelId: u.model.modelId,
        connectionMode: u.connectionMode,
        inputTokens: u.usage.inputTokens,
        outputTokens: u.usage.outputTokens,
        usdCost: u.usdCost,
        subscriptionPoolId: pool ?? null,
      });
      // CLI çağrıları abonelik kotasını tüketir → QuotaTracker'a yaz.
      if (pool) quota.record(pool, u.usage.inputTokens + u.usage.outputTokens);
    },
  });

  return {
    workspaces,
    tasks,
    approvals,
    settings,
    costLogs,
    orchestrator,
    secretStore,
    apiKeyCache,
    workspaceId: workspace.id,
    rootDir: workspace.repoPath || process.cwd(),
    getWebContents: (): WebContents | null => mainWindow?.webContents ?? null,
  };
}

function resolveIcon(): string | undefined {
  // Dev'de apps/desktop/build/icon.png; paketlide exe ikonu zaten gömülü olur.
  const candidate = path.join(__dirname, "..", "build", "icon.png");
  return existsSync(candidate) ? candidate : undefined;
}

async function createWindow(): Promise<void> {
  const icon = resolveIcon();
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: "NEXCODE",
    backgroundColor: "#070a0f",
    ...(icon ? { icon } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.on("did-finish-load", () => logger.info("renderer.loaded"));
  win.webContents.on("did-fail-load", (_e, code, desc, url) =>
    logger.error("renderer.load_failed", { code, desc, url }),
  );

  const devUrl = process.env.NEXCODE_RENDERER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    // Statik export'u app:// protokolünden yükle (mutlak asset yolları çalışsın diye).
    await win.loadURL("app://nexcode/index.html");
  }
}

app
  .whenReady()
  .then(async () => {
    registerAppProtocol();
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
