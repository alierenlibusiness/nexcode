import { createContext } from "../context";
import { discoverClis } from "@nexcode/core/providers";
import { runDoctor, formatDoctorReport } from "@nexcode/core";

/**
 * Kurulum denetimi.
 *
 * Kurulu CLI'ları tarar, yapılandırmayı doğrular ve motorun görev alabilecek durumda olup
 * olmadığını söyler. Bir şey çalışmadığında ilk bakılacak yer burasıdır.
 */
export function runDoctorCommand(flags: Record<string, string | boolean>): number {
  const ctx = createContext();
  const config = ctx.configRepo.load();
  const discovered = discoverClis();

  const report = runDoctor({
    config,
    discovered,
    // Sağlık probu süreç açar; `doctor` hızlı ve yan etkisiz kalsın diye burada boş geçilir.
    health: {},
    dataDir: ctx.dataDir,
    providersWithKeys: [],
    nodeVersion: process.version,
    platform: process.platform,
  });

  if (flags.json === true) {
    process.stdout.write(`${JSON.stringify({ report, discovered }, null, 2)}\n`);
    return report.ready ? 0 : 1;
  }

  process.stdout.write(`${formatDoctorReport(report)}\n`);

  process.stdout.write(`\nBulunan CLI'lar (${String(discovered.length)})\n`);
  if (discovered.length === 0) {
    process.stdout.write("  Hiçbiri bulunamadı. En az bir kodlama CLI'ı kurulu ve giriş yapılmış olmalı.\n");
  } else {
    for (const cli of discovered) {
      process.stdout.write(`  ${cli.adapter.padEnd(12)} ${cli.command}\n`);
    }
  }

  return report.ready ? 0 : 1;
}
