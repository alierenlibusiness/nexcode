import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  openDatabase,
  EngineRepository,
  ConfigRepository,
  ScheduleRepository,
  SqliteCheckpointStore,
  ApprovalRepository,
  type DB,
} from "@nexcode/core/db";
import { EngineHost } from "@nexcode/core/host";
import type { EngineEvent } from "@nexcode/core";

/**
 * CLI çalışma bağlamı.
 *
 * Veri kökü önceliği: `NEXCODE_HOME` > `~/.nexcode`. Masaüstü uygulaması kendi `userData`
 * klasörünü kullanır; ikisini aynı veritabanına bağlamak istersen `NEXCODE_HOME` ver.
 */

export interface CliContext {
  db: DB;
  tasks: EngineRepository;
  configRepo: ConfigRepository;
  schedules: ScheduleRepository;
  approvals: ApprovalRepository;
  checkpoints: SqliteCheckpointStore;
  engine: EngineHost;
  dataDir: string;
  workingDir: string;
}

export function resolveDataDir(): string {
  const override = process.env.NEXCODE_HOME;
  return override !== undefined && override.trim() !== "" ? override : path.join(homedir(), ".nexcode");
}

/**
 * Paketle gelen rol, beceri ve varsayılan yapılandırma dosyalarının kökü.
 *
 * Yayımlanmış pakette `resources/` tarball'ın içindedir; depodan çalıştırıldığında proje
 * kökündeki klasör kullanılır.
 */
export function resolveResourcesDir(): string {
  const packaged = path.join(__dirname, "..", "resources");
  if (existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", "..", "..", "resources");
}

export function createContext(options: { onEvent?: (event: EngineEvent) => void } = {}): CliContext {
  const dataDir = resolveDataDir();
  mkdirSync(dataDir, { recursive: true });

  const db = openDatabase(path.join(dataDir, "nexcode.db"));
  const tasks = new EngineRepository(db);
  const resourcesDir = resolveResourcesDir();
  const configRepo = new ConfigRepository(db, path.join(resourcesDir, "nexcode.config.default.json"));
  const schedules = new ScheduleRepository(db);
  const approvals = new ApprovalRepository(db);
  const checkpoints = new SqliteCheckpointStore(db);

  const engine = new EngineHost({
    repo: tasks,
    configRepo,
    checkpointStore: checkpoints,
    worktreeRoot: path.join(dataDir, "worktrees"),
    resourcesDir,
    broadcast: (event) => options.onEvent?.(event),
    requestApproval: ({ taskId, planSummary }) => {
      // Panelsiz çalışmada riskli plan otomatik onaylanmaz: kuyruğa alınır ve görev bekler.
      // `nexcode approvals` ile karar verilir.
      const record = approvals.create(taskId, "risky_plan");
      process.stderr.write(
        `\nRiskli plan onay bekliyor (${record.id}).\n  ${planSummary.slice(0, 160)}\n` +
          `  Karar vermek için: nexcode approvals\n\n`,
      );
      return waitForApproval(approvals, record.id);
    },
  });

  return {
    db,
    tasks,
    configRepo,
    schedules,
    approvals,
    checkpoints,
    engine,
    dataDir,
    workingDir: resolveWorkingDir(configRepo),
  };
}

function resolveWorkingDir(configRepo: ConfigRepository): string {
  const configured = configRepo.load().workingDir;
  return configured === "." || configured === "" ? process.cwd() : configured;
}

/** Onay kaydı çözülene kadar bekler; kullanıcı karar vermeden görev ilerlemez. */
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
