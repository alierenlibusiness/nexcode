import type { NexcodeConfig } from "./config/schema";
import { resolveOperatorId } from "./engine/routing";
import type { DiscoveredCli } from "./providers/cli/discovery";
import type { HealthResult } from "./providers/cli/health";

/**
 * Kurulum teşhisi.
 *
 * "Neden çalışmıyor?" sorusunu tek ekranda yanıtlar: kurulu CLI'lar, sağlık durumları,
 * operatör seçimi, otonom onay, veri dizini ve config geçerliliği.
 *
 * Saf bir raporlayıcıdır: girdileri çağıran toplar, bu modül yalnızca yorumlar.
 */

export type DiagnosticLevel = "ok" | "warn" | "error";

export interface Diagnostic {
  level: DiagnosticLevel;
  /** Kısa başlık (ör. "Operatör"). */
  subject: string;
  message: string;
  /** Sorunu gidermek için somut adım. */
  hint?: string;
}

export interface DoctorInput {
  config: NexcodeConfig;
  discovered: readonly DiscoveredCli[];
  health: Readonly<Record<string, HealthResult>>;
  dataDir: string;
  /** API anahtarı OS keychain'de bulunan sağlayıcılar. */
  providersWithKeys: readonly string[];
  nodeVersion: string;
  platform: string;
}

export interface DoctorReport {
  diagnostics: Diagnostic[];
  /** Motorun görev alabilecek durumda olup olmadığı. */
  ready: boolean;
}

const MIN_NODE_MAJOR = 22;

export function runDoctor(input: DoctorInput): DoctorReport {
  const diagnostics: Diagnostic[] = [];
  const { config } = input;

  // ── Ortam ──
  const major = Number.parseInt(input.nodeVersion.replace(/^v/, "").split(".")[0] ?? "0", 10);
  diagnostics.push(
    major >= MIN_NODE_MAJOR
      ? { level: "ok", subject: "Node.js", message: `${input.nodeVersion} (${input.platform})` }
      : {
          level: "error",
          subject: "Node.js",
          message: `${input.nodeVersion} desteklenmiyor.`,
          hint: `Node.js ${String(MIN_NODE_MAJOR)} veya üstü gerekir.`,
        },
  );

  diagnostics.push({ level: "ok", subject: "Veri dizini", message: input.dataDir });

  // ── Otonom onay ──
  diagnostics.push(
    config.autonomousConsentAcceptedAt === null
      ? {
          level: "error",
          subject: "Otonom onay",
          message: "Otonom çalışma henüz kabul edilmedi.",
          hint: "Uygulamada motoru ilk kez başlatırken çıkan onay penceresini kabul edin.",
        }
      : { level: "ok", subject: "Otonom onay", message: `Kabul edildi: ${config.autonomousConsentAcceptedAt}` },
  );

  // ── Kurulu CLI'lar ──
  if (input.discovered.length === 0) {
    diagnostics.push({
      level: "warn",
      subject: "CLI",
      message: "Kurulu CLI agent'ı bulunamadı.",
      hint: "Claude Code, Codex, Gemini veya OpenCode kurun; ya da agent'ları API anahtarıyla (api_only) çalıştırın.",
    });
  } else {
    for (const cli of input.discovered) {
      diagnostics.push({
        level: "ok",
        subject: `CLI · ${cli.adapter}`,
        message: `${cli.command}${cli.version === null ? "" : `; ${cli.version}`}`,
      });
    }
  }

  // ── Sağlık ──
  for (const [agentId, result] of Object.entries(input.health)) {
    if (result.status === "ready") continue;
    diagnostics.push({
      level: result.status === "timeout" ? "warn" : "error",
      subject: `Sağlık · ${agentId}`,
      message: `${result.status}: ${result.detail}`,
      hint: healthHint(result.status),
    });
  }

  // ── Operatör ──
  const operatorId = resolveOperatorId(config);
  diagnostics.push(
    operatorId === null
      ? {
          level: "error",
          subject: "Operatör",
          message: "Etkin bir operatör agent'ı yok.",
          hint: "Ayarlar → Agent'lar & Roller'den bir agent'a `operator` rolü verin.",
        }
      : { level: "ok", subject: "Operatör", message: config.agents[operatorId]?.name ?? operatorId },
  );

  // ── Uzman kadrosu ──
  const specialists = Object.values(config.agents).filter(
    (agent) => agent.enabled && agent.role !== "operator" && agent.id !== operatorId,
  );
  diagnostics.push(
    specialists.length === 0
      ? {
          level: "error",
          subject: "Uzmanlar",
          message: "Etkin uzman agent'ı yok; operatör delegasyon yapamaz.",
          hint: "Ayarlar → Agent'lar & Roller'den en az bir executor etkinleştirin.",
        }
      : { level: "ok", subject: "Uzmanlar", message: `${String(specialists.length)} etkin uzman` },
  );

  const hasReviewer = specialists.some((agent) => agent.role === "reviewer");
  if (!hasReviewer) {
    diagnostics.push({
      level: "warn",
      subject: "İnceleme",
      message: "Etkin reviewer yok; dengeli ve derin modda bağımsız inceleme yapılamaz.",
      hint: "Bir agent'a `reviewer` rolü verin.",
    });
  }

  // ── API anahtarları ──
  const apiAgents = specialists.filter((agent) => agent.connection !== "cli_only");
  const missingKeys = [
    ...new Set(
      apiAgents
        .map((agent) => agent.model?.provider)
        .filter((provider): provider is string => provider !== undefined)
        .filter((provider) => !input.providersWithKeys.includes(provider)),
    ),
  ];
  if (missingKeys.length > 0) {
    diagnostics.push({
      level: "warn",
      subject: "API anahtarları",
      message: `Anahtarı olmayan sağlayıcılar: ${missingKeys.join(", ")}`,
      hint: "Ayarlar → Bağlantılar'dan anahtarları girin (OS keychain'de şifreli saklanır).",
    });
  }

  // ── Bütçe ──
  if (config.dailyCallBudget < 10) {
    diagnostics.push({
      level: "warn",
      subject: "Bütçe",
      message: `Günlük çağrı bütçesi çok düşük (${String(config.dailyCallBudget)}).`,
      hint: "Çok turlu bir görev tek başına 5-10 çağrı kullanabilir.",
    });
  }

  return { diagnostics, ready: !diagnostics.some((d) => d.level === "error") };
}

function healthHint(status: HealthResult["status"]): string | undefined {
  switch (status) {
    case "auth":
      return "CLI'da oturum açın (ör. `claude login`, `codex login`).";
    case "model":
      return "Ayarlar → CLI'lar ve Modeller'den erişebildiğiniz bir model seçin.";
    case "timeout":
      return "Ağ bağlantınızı kontrol edin veya `agentTimeoutSeconds` değerini artırın.";
    default:
      return undefined;
  }
}

/** Raporu terminal/konsol için biçimlendirir. */
export function formatDoctorReport(report: DoctorReport): string {
  const icons: Record<DiagnosticLevel, string> = { ok: "✓", warn: "!", error: "✗" };
  const lines = report.diagnostics.map((diagnostic) => {
    const head = `${icons[diagnostic.level]} ${diagnostic.subject}: ${diagnostic.message}`;
    return diagnostic.hint === undefined ? head : `${head}\n    → ${diagnostic.hint}`;
  });
  lines.push("", report.ready ? "Sonuç: motor görev alabilir." : "Sonuç: yukarıdaki hatalar giderilmelidir.");
  return lines.join("\n");
}
