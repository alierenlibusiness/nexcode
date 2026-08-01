import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, protocol, net, type WebContents } from "electron";
import { logger, IpcChannels } from "@nexcode/core";
import { McpManager } from "@nexcode/core/mcp";
import {
  openDatabase,
  WorkspaceRepository,
  EngineRepository,
  ConfigRepository,
  ScheduleRepository,
  SqliteCheckpointStore,
  ApprovalRepository,
  AgentSettingsRepository,
  CostLogRepository,
  McpRepository,
  SkillRepository,
} from "@nexcode/core/db";
import { KeyringSecretStore } from "@nexcode/core/keyring";
import { registerIpcHandlers, type IpcContext } from "./ipc";
import { EngineHost, startScheduler } from "@nexcode/core/host";

const KEYCHAIN_SERVICE = "nexcode";

let mainWindow: BrowserWindow | null = null;

// Renderer'ı özel `app://` protokolünden sunarız. Bu, Next.js statik export'unun MUTLAK
// asset yollarını (`/_next/...`) doğru çözer: `file://` altında bunlar bozulur (PRD §5.1).
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

/** Paketle gelen rol, beceri ve varsayılan yapılandırma dosyalarının kökü. */
function resolveResourcesDir(): string {
  const packaged = path.join(process.resourcesPath, "resources");
  return app.isPackaged && existsSync(packaged) ? packaged : path.join(__dirname, "..", "..", "..", "resources");
}

async function buildContext(): Promise<IpcContext> {
  const db = openDatabase(resolveDbPath());
  const workspaces = new WorkspaceRepository(db);
  const tasks = new EngineRepository(db);
  const resourcesDir = resolveResourcesDir();
  const configRepo = new ConfigRepository(db, path.join(resourcesDir, "nexcode.config.default.json"));
  const schedules = new ScheduleRepository(db);
  const checkpointStore = new SqliteCheckpointStore(db);
  const approvals = new ApprovalRepository(db);
  const settings = new AgentSettingsRepository(db);
  const costLogs = new CostLogRepository(db);
  const secretStore = new KeyringSecretStore();
  const apiKeyCache = new Map<string, string>();

  const workspace = workspaces.list()[0] ?? workspaces.create({ name: "Default", repoPath: process.cwd() });

  // Mevcut API anahtarlarını keychain'den senkron cache'e yükle (hibrit API yolu için).
  for (const provider of ["anthropic", "openai", "google", "deepseek", "minimax", "kimi", "glm"]) {
    try {
      const existing = await secretStore.get(KEYCHAIN_SERVICE, provider);
      if (existing) apiKeyCache.set(provider, existing);
    } catch (error) {
      logger.warn("keychain.preload_failed", { provider, error: String(error) });
    }
  }

  const mcp = new McpRepository(db);
  const skills = new SkillRepository(db);
  const mcpManager = new McpManager(mcp);
  await mcpManager.startAll();

  const engine = new EngineHost({
    repo: tasks,
    configRepo,
    checkpointStore,
    // İzole ağaçlar kullanıcının proje klasörünün DIŞINDA tutulur.
    worktreeRoot: path.join(app.getPath("userData"), "worktrees"),
    resourcesDir,
    broadcast: (event) => mainWindow?.webContents.send(IpcChannels.engineEvent, event),
    requestApproval: ({ taskId, planSummary }) => {
      // Riskli plan kuyruğa alınır; kullanıcı Komuta Merkezi'nden karar verene kadar beklenir.
      const record = approvals.create(taskId, "risky_plan");
      logger.info("approval.requested", { id: record.id, taskId, planSummary: planSummary.slice(0, 120) });
      return waitForApproval(approvals, record.id);
    },
  });

  const stopScheduler = startScheduler({ schedules, tasks, engine, configRepo });

  app.on("will-quit", () => {
    stopScheduler();
    void engine.stop();
    void mcpManager.stopAll();
  });

  return {
    workspaces,
    tasks,
    configRepo,
    schedules,
    approvals,
    settings,
    costLogs,
    engine,
    secretStore,
    apiKeyCache,
    workspaceId: workspace.id,
    rootDir: workspace.repoPath === "" ? process.cwd() : workspace.repoPath,
    getWebContents: (): WebContents | null => mainWindow?.webContents ?? null,
    mcp,
    skills,
    mcpManager,
  };
}

/**
 * Onay kaydı çözülene kadar bekler.
 *
 * Kullanıcı karar vermeden görev ilerlemez; uygulama kapanırsa bekleyen görev `approval`
 * durumunda kalır ve yeniden açılışta kuyrukta görünür.
 */
function waitForApproval(approvals: ApprovalRepository, id: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setInterval(() => {
      const record = approvals.getById(id);
      if (record === null || record.status === "pending") return;
      clearInterval(timer);
      resolve(record.status === "approved");
    }, 1000);
    timer.unref();
  });
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
