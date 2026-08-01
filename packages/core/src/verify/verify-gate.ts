import type { NexcodeConfig } from "../config/schema";
import type { CommandResult } from "../worktree/worktree";

/**
 * Doğrulama kapısı.
 *
 * Teslimatın tek dayanağı modelin `VERDICT: PASS` beyanı olmamalıdır. Bu katman, kullanıcının
 * tanımladığı komutları (testler, tip kontrolü, lint) her turun atamaları bittikten sonra
 * gerçekten çalıştırır ve sonucu operatöre kanıt olarak verir.
 *
 * Değişmezler:
 *
 * 1. **Opt-in.** `verify.commands` boşken kapı hiç çalışmaz ve önceki davranış birebir korunur.
 * 2. **Fail-fast.** İlk kırmızı komutta durulur; kalan komutlar çalıştırılmaz.
 * 3. **Kırmızı kapı kestirmeleri kapatır.** FAST erken tamamlama, PASS hızlı yolu ve inceleme
 *    valisi devre dışı kalır; karar operatöre gider.
 * 4. **İş çöpe atılmaz.** Kapı teslimatı en fazla `verify.maxAttempts` kez engeller; sonrasında
 *    teslimat uyarıyla yapılır. Yeşile dönmeyen bir kapı, saatlerce süren işi silmez.
 */

export interface VerifyPort {
  /** Kullanıcının yazdığı komutu kabukta çalıştırır. */
  runShell: (input: { command: string; cwd: string; timeoutMs: number }) => Promise<CommandResult>;
}

export interface VerifyCommandReport {
  command: string;
  ok: boolean;
  /** Kırpılmış birleşik çıktı (stdout + stderr). */
  output: string;
  timedOut: boolean;
  durationMs: number;
}

export interface VerifyReport {
  /** Kapı çalıştı mı. `verify.commands` boşken false. */
  ran: boolean;
  ok: boolean;
  commands: VerifyCommandReport[];
  /** Kaçıncı denemede olduğumuz; `maxAttempts` ile karşılaştırılır. */
  attempt: number;
}

/** Hiç çalışmamış kapı: tüm kestirmeler açık kalır. */
export const IDLE_VERIFY_REPORT: VerifyReport = { ran: false, ok: true, commands: [], attempt: 0 };

export class VerifyGate {
  private attempts = 0;

  constructor(
    private readonly port: VerifyPort,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Yeni görev başlarken deneme sayacını sıfırlar. */
  reset(): void {
    this.attempts = 0;
  }

  /**
   * Komutları sırayla çalıştırır ve ilk kırmızıda durur.
   *
   * Kapı kapalıysa (komut yok) hiçbir süreç başlatılmaz ve `ran: false` döner.
   */
  async run(cfg: NexcodeConfig, workingDir: string): Promise<VerifyReport> {
    const commands = cfg.verify.commands;
    if (commands.length === 0) return IDLE_VERIFY_REPORT;

    this.attempts += 1;
    const reports: VerifyCommandReport[] = [];
    const timeoutMs = cfg.verify.timeoutSeconds * 1000;

    for (const command of commands) {
      const startedAt = this.now();
      const result = await this.port.runShell({ command, cwd: workingDir, timeoutMs });
      const report: VerifyCommandReport = {
        command,
        ok: result.ok,
        output: clip(joinStreams(result), cfg.verify.maxOutputChars),
        timedOut: result.timedOut === true,
        durationMs: this.now() - startedAt,
      };
      reports.push(report);
      if (!report.ok) break;
    }

    return { ran: true, ok: reports.every((r) => r.ok), commands: reports, attempt: this.attempts };
  }

  /**
   * Kapı teslimatı hâlâ engelliyor mu.
   *
   * `blockOnFailure` kapalıysa kapı yalnızca rapor eder. Deneme hakkı bittiğinde de engel
   * kalkar: operatör uyarıyla teslim eder, iş kaybolmaz.
   */
  isBlocking(cfg: NexcodeConfig, report: VerifyReport): boolean {
    if (!report.ran || report.ok) return false;
    if (!cfg.verify.blockOnFailure) return false;
    return report.attempt < cfg.verify.maxAttempts;
  }

  /** Kestirmeler (FAST erken bitiş, PASS hızlı yolu, inceleme valisi) açık mı. */
  allowsFastPath(report: VerifyReport): boolean {
    return !report.ran || report.ok;
  }
}

/**
 * Operatör prompt'una gömülecek kanıt bloğu.
 *
 * Model, hangi komutun neden düştüğünü bu metinden okur; "testleri çalıştırdım" beyanına
 * güvenmek yerine gerçek çıktıyı görür.
 */
export function verifyEvidence(report: VerifyReport): string {
  if (!report.ran) return "";

  const lines = ["## Doğrulama kapısı", ""];
  lines.push(report.ok ? "Durum: YEŞİL (tüm komutlar geçti)" : "Durum: KIRMIZI");
  lines.push("");

  for (const command of report.commands) {
    const status = command.ok ? "GEÇTİ" : command.timedOut ? "SÜRE AŞIMI" : "DÜŞTÜ";
    lines.push(`### ${command.command} [${status}]`);
    if (!command.ok && command.output.trim() !== "") {
      lines.push("", "```", command.output.trim(), "```");
    }
    lines.push("");
  }

  if (!report.ok) {
    lines.push(
      "Kapı kırmızı. Kestirme teslimat yapma: düşen komutu geçirecek düzeltmeyi planla veya",
      "sorunun neden giderilemediğini kalan riskte açıkça belirt.",
    );
  }

  return lines.join("\n").trim();
}

/** Teslimat özetine yazılacak tek satırlık durum. */
export function verifySummary(report: VerifyReport): string {
  if (!report.ran) return "Doğrulama kapısı tanımlı değil.";
  if (report.ok) return `Doğrulama kapısı yeşil (${String(report.commands.length)} komut).`;

  const failed = report.commands.find((c) => !c.ok);
  return `Doğrulama kapısı KIRMIZI: ${failed?.command ?? "bilinmeyen komut"}${failed?.timedOut === true ? " (süre aşımı)" : ""}.`;
}

function joinStreams(result: CommandResult): string {
  return [result.stdout, result.stderr].filter((part) => part.trim() !== "").join("\n");
}

/**
 * Uzun çıktıyı ortadan kırpar.
 *
 * Baş taraf komutun ne yaptığını, son taraf ise hatanın kendisini taşır; test koşucuları
 * özeti sona yazdığı için sondan kırpmak en kritik bilgiyi atardı.
 */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.35);
  const tail = limit - head;
  const dropped = text.length - limit;
  return `${text.slice(0, head)}\n\n... ${String(dropped)} karakter atlandı ...\n\n${text.slice(-tail)}`;
}
