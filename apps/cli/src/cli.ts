#!/usr/bin/env node
import { createContext, resolveDataDir } from "./context";
import { runTaskCommand, runStatusCommand, runRunCommand, runApprovalsCommand } from "./commands/tasks";
import { runDoctorCommand } from "./commands/doctor";
import { runMcpCommand } from "./commands/mcp";
import { runConsentCommand } from "./commands/consent";

/**
 * NEXCODE komut satırı.
 *
 * Masaüstü paneli olmadan da tam orkestrasyon: görev kuyrukla, motoru çalıştır, durumu gör,
 * riskli planları onayla ve NEXCODE'u başka bir agent'a MCP aracı olarak sun.
 *
 * Panel ve CLI aynı veritabanını paylaşabilir (`NEXCODE_HOME`), böylece terminalden
 * kuyruklanan görev panelde de görünür.
 */

const USAGE = `
NEXCODE, kurulu kodlama CLI'larını tek bir operatör yönetiminde ekip olarak çalıştırır.

KULLANIM
  nexcode <komut> [seçenekler]

KOMUTLAR
  task <hedef>        Kuyruğa yeni bir görev ekler
  run                 Motoru başlatır ve kuyruğu işler
  status              Kuyruğu ve motor durumunu gösterir
  approvals           Onay bekleyen riskli planları listeler ve karara bağlar
  doctor              Kurulu CLI'ları, yapılandırmayı ve hazırlığı denetler
  consent             Otonom çalışma onayını gösterir ve verir (motor için zorunlu)
  mcp                 NEXCODE'u MCP sunucusu olarak açar (stdio)
  version             Sürümü yazar

SEÇENEKLER
  --mode <auto|fast|balanced|deep>   Yürütme derinliği (varsayılan: auto)
  --dir <yol>                        Çalışma klasörü (varsayılan: bulunduğun klasör)
  --once                             run: kuyruk boşalınca çık
  --approve <id> | --reject <id>     approvals: kararı uygular
  --accept | --revoke                consent: onayı verir ya da geri alır
  --json                             Çıktıyı JSON olarak yazar

ORTAM
  NEXCODE_HOME   Veri kökü (varsayılan: ~/.nexcode)

ÖRNEKLER
  npx nexcode doctor
  npx nexcode consent --accept
  npx nexcode task "avatar yükleme akışını ekle ve testlerini yaz" --mode balanced
  npx nexcode run --once
`;

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** `--key value`, `--key=value` ve `--flag` biçimlerini ayrıştırır. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }

    const next = argv[i + 1];
    // Sonraki değer bir bayrak değilse bu bayrağın değeridir.
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }

  return { command: positional.shift() ?? "", positional, flags };
}

async function main(): Promise<number> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (command === "" || command === "help" || flags.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command === "version" || flags.version === true) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  // MCP stdio taşıması kendi bağlamını kurar ve standart çıktıyı protokole ayırır.
  if (command === "mcp") return await runMcpCommand();

  switch (command) {
    case "task":
      return runTaskCommand(positional, flags);
    case "run":
      return await runRunCommand(flags);
    case "status":
      return runStatusCommand(flags);
    case "approvals":
      return runApprovalsCommand(flags);
    case "doctor":
      return runDoctorCommand(flags);
    case "consent":
      return runConsentCommand(flags);
    default:
      process.stderr.write(`Bilinmeyen komut: ${command}\n${USAGE}\n`);
      return 1;
  }
}

function readVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Yalnızca doğrudan çalıştırıldığında komut yürütülür; modül olarak import edildiğinde
// (testler, gömülü kullanım) hiçbir yan etki oluşmaz.
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`Hata: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

export { createContext, resolveDataDir };
