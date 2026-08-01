import { createContext } from "../context";
import { EXECUTION_MODES, type ExecutionMode, type EngineEvent } from "@nexcode/core";

/** Görev kuyruğu komutları: task, run, status, approvals. */

type Flags = Record<string, string | boolean>;

export function runTaskCommand(positional: readonly string[], flags: Flags): number {
  const prompt = positional.join(" ").trim();
  if (prompt === "") {
    process.stderr.write('Görev metni gerekli. Örnek: nexcode task "testleri düzelt"\n');
    return 1;
  }

  const mode = readMode(flags);
  if (mode === null) {
    process.stderr.write(`Geçersiz mod. Seçenekler: ${EXECUTION_MODES.join(", ")}\n`);
    return 1;
  }

  const ctx = createContext();
  const workingDir = readString(flags, "dir") ?? ctx.workingDir;
  const task = ctx.tasks.create({ prompt, workingDir, executionMode: mode });

  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    `Görev kuyruğa alındı.\n  id    : ${task.id}\n  başlık: ${task.title}\n  mod   : ${task.executionMode}\n` +
      `  klasör: ${task.workingDir}\n\nÇalıştırmak için: nexcode run\n`,
  );
  return 0;
}

export function runStatusCommand(flags: Flags): number {
  const ctx = createContext();
  const queue = ctx.tasks.queueSnapshot();
  const status = ctx.engine.status();

  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify({ status, queue }, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    `Motor : ${status.running ? "çalışıyor" : "durdu"}  (${String(status.activeIds.length)}/${String(status.concurrency)} slot)\n` +
      `Veri  : ${ctx.dataDir}\n\n`,
  );

  const sections: Array<[string, typeof queue.pending]> = [
    ["Bekliyor", queue.pending],
    ["Onay bekliyor", queue.approval],
    ["Tamamlandı", queue.done],
    ["Başarısız", queue.failed],
  ];

  for (const [label, tasks] of sections) {
    process.stdout.write(`${label} (${String(tasks.length)})\n`);
    if (tasks.length === 0) {
      process.stdout.write("  -\n");
      continue;
    }
    for (const task of tasks.slice(0, 10)) {
      process.stdout.write(`  ${task.id.slice(0, 8)}  ${truncate(task.prompt, 64)}\n`);
    }
    if (tasks.length > 10) process.stdout.write(`  ... ${String(tasks.length - 10)} tane daha\n`);
  }
  return 0;
}

export async function runRunCommand(flags: Flags): Promise<number> {
  const once = flags.once === true;
  const ctx = createContext({ onEvent: (event) => printEvent(event) });

  const config = ctx.configRepo.load();
  if (config.autonomousConsentAcceptedAt === null) {
    process.stderr.write(
      "Otonom çalışma onayı alınmadan motor başlatılamaz.\n" +
        "Panelden onayla ya da yapılandırmada `autonomousConsentAcceptedAt` alanını ayarla.\n",
    );
    return 1;
  }

  if (once && ctx.tasks.queueSnapshot().pending.length === 0) {
    process.stdout.write("Kuyruk boş.\n");
    return 0;
  }

  process.stdout.write("Motor başlatıldı. Durdurmak için Ctrl+C.\n\n");
  ctx.engine.start();

  // Ctrl+C uçuştaki görevi yarıda kesmez; biten işten sonra temiz çıkılır.
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    process.stdout.write("\nDurduruluyor (uçuştaki görev bitirilecek)...\n");
    await ctx.engine.stop();
    process.exitCode = 0;
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  if (once) {
    await waitForDrain(ctx);
    await ctx.engine.stop();
    process.stdout.write("\nKuyruk boşaldı.\n");
  } else {
    await new Promise<void>(() => undefined);
  }
  return 0;
}

export function runApprovalsCommand(flags: Flags): number {
  const ctx = createContext();

  const approve = readString(flags, "approve");
  const reject = readString(flags, "reject");
  const target = approve ?? reject;

  if (target !== undefined) {
    const record = ctx.approvals.getById(target);
    if (record === null) {
      process.stderr.write(`Onay bulunamadı: ${target}\n`);
      return 1;
    }
    ctx.approvals.resolve(target, approve !== undefined ? "approved" : "rejected", "cli");
    process.stdout.write(`Onay ${approve !== undefined ? "kabul edildi" : "reddedildi"}: ${target}\n`);
    return 0;
  }

  const pending = ctx.approvals.listPending();
  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify(pending, null, 2)}\n`);
    return 0;
  }

  if (pending.length === 0) {
    process.stdout.write("Onay bekleyen plan yok.\n");
    return 0;
  }

  process.stdout.write(`Onay bekleyen ${String(pending.length)} plan:\n\n`);
  for (const record of pending) {
    process.stdout.write(`  ${record.id}\n    tür  : ${record.actionType}\n    görev: ${record.taskId}\n\n`);
  }
  process.stdout.write("Karar: nexcode approvals --approve <id>  |  --reject <id>\n");
  return 0;
}

/** Kuyruk boşalana ve tüm slotlar bitene kadar bekler. */
function waitForDrain(ctx: ReturnType<typeof createContext>): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const idle = ctx.engine.status().activeIds.length === 0;
      const empty = ctx.tasks.queueSnapshot().pending.length === 0;
      if (idle && empty) {
        clearInterval(timer);
        resolve();
      }
    }, 500);
  });
}

/** Motor olaylarını okunur tek satırlara indirger; ham stdout akışı basılmaz. */
function printEvent(event: EngineEvent): void {
  if (event.type === "log") {
    const detail = event.payload.detail === undefined ? "" : `: ${truncate(event.payload.detail, 120)}`;
    process.stdout.write(`[${event.payload.level}] ${event.payload.message}${detail}\n`);
    return;
  }

  if (event.type === "activity") {
    const phase = event.payload.phase;
    if (phase === "stdout" || phase === "stderr" || phase === "progress") return;
    process.stdout.write(`  ${event.payload.agentName} ${phase}\n`);
    return;
  }

  if (event.type === "message") {
    process.stdout.write(`  ${event.payload.from} -> ${event.payload.to}: ${truncate(event.payload.summary, 90)}\n`);
    return;
  }

  if (event.type === "result") {
    process.stdout.write(`\n[${event.payload.outcome}] ${truncate(event.payload.final, 400)}\n`);
    if (event.payload.verification !== "") {
      process.stdout.write(`  doğrulama: ${truncate(event.payload.verification, 200)}\n`);
    }
    if (event.payload.remainingRisk !== "") {
      process.stdout.write(`  kalan risk: ${truncate(event.payload.remainingRisk, 200)}\n`);
    }
    process.stdout.write(
      `  tur ${String(event.payload.rounds)} · delegasyon ${String(event.payload.delegations)} · ` +
        `dosya ${String(event.payload.files.length)}\n\n`,
    );
  }
}

function readMode(flags: Flags): ExecutionMode | null {
  const raw = readString(flags, "mode");
  if (raw === undefined) return "auto";
  return (EXECUTION_MODES as readonly string[]).includes(raw) ? (raw as ExecutionMode) : null;
}

function readString(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}
