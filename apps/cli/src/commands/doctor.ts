import { createContext } from "../context";
import { discoverClis } from "@nexcode/core/providers";
import { runDoctor, formatDoctorReport } from "@nexcode/core";

/**
 * Setup diagnosis.
 *
 * Scans the installed CLIs, validates the configuration and reports whether the engine is
 * in a state where it can take work. This is the first place to look when something does
 * not run.
 */
export function runDoctorCommand(flags: Record<string, string | boolean>): number {
  const ctx = createContext();
  const config = ctx.configRepo.load();
  const discovered = discoverClis();

  const report = runDoctor({
    config,
    discovered,
    // The health probe spawns processes; it is left empty here so `doctor` stays fast and side effect free.
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

  process.stdout.write(`\nDiscovered CLIs (${String(discovered.length)})\n`);
  if (discovered.length === 0) {
    process.stdout.write("  None found. At least one coding CLI must be installed and signed in.\n");
  } else {
    for (const cli of discovered) {
      process.stdout.write(`  ${cli.adapter.padEnd(12)} ${cli.command}\n`);
    }
  }

  return report.ready ? 0 : 1;
}
