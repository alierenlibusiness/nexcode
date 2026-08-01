import type { NexcodeConfig } from "../config/schema";

/**
 * Hata sınıflandırması ve kurtarma politikası.
 *
 * Geçici sağlayıcı hatalarında delegasyon aynı agent ile üstel bekleyerek yeniden denenir;
 * kalıcı hatada iş aynı yetenekteki sağlıklı bir agent'a devredilir. Operatöre geri dönüp
 * yeni bir plan turu harcamak **son çaredir**: pahalıdır ve tamamlanmış işi tekrarlatır.
 */

export type FailureClass =
  /** Rate limit, aşırı yük, ağ dalgalanması: aynı agent ile beklenip tekrar denenir. */
  | "transient"
  /** Oturum açılmamış / yetkisiz: agent bu oturumda kullanılamaz. */
  | "auth"
  /** Model bulunamadı veya erişilemiyor: agent bu oturumda kullanılamaz. */
  | "model"
  /** Toplam süre tavanı aşıldı. */
  | "timeout"
  /** Uzun süre yeni çıktı gelmedi. Süreç HİÇ çalışmadı demek değildir; ilerleme korunur. */
  | "stalled"
  /** Diğer her şey. */
  | "permanent";

const TRANSIENT_SIGNALS = [
  "rate limit",
  "rate_limit",
  "too many requests",
  "429",
  "overloaded",
  "529",
  "503",
  "502",
  "504",
  "service unavailable",
  "econnreset",
  "etimedout",
  "enotfound",
  "econnrefused",
  "socket hang up",
  "network error",
  "temporarily unavailable",
];

const AUTH_SIGNALS = [
  "unauthorized",
  "unauthenticated",
  "401",
  "403",
  "not logged in",
  "please log in",
  "authentication",
  "invalid api key",
  "no credentials",
  "oturum aç",
];

const MODEL_SIGNALS = [
  "model not found",
  "unknown model",
  "invalid model",
  "model_not_found",
  "does not exist or you do not have access",
  "unsupported model",
];

export interface FailureInput {
  message: string;
  stderr?: string;
  exitCode?: number;
  /** Toplam süre tavanı aşıldı. */
  timedOut?: boolean;
  /** Sessizlik sınırı aşıldı. */
  stalled?: boolean;
}

/** Bir delegasyon hatasını kurtarma politikasının anlayacağı sınıfa çevirir. */
export function classifyFailure(input: FailureInput): FailureClass {
  if (input.stalled === true) return "stalled";
  if (input.timedOut === true) return "timeout";

  const haystack = `${input.message} ${input.stderr ?? ""}`.toLowerCase();
  if (AUTH_SIGNALS.some((signal) => haystack.includes(signal))) return "auth";
  if (MODEL_SIGNALS.some((signal) => haystack.includes(signal))) return "model";
  if (TRANSIENT_SIGNALS.some((signal) => haystack.includes(signal))) return "transient";
  return "permanent";
}

export type RecoveryAction = "retry" | "failover" | "give-up";

export interface RecoveryDecision {
  action: RecoveryAction;
  /** `retry` için beklenecek süre. */
  delayMs: number;
  /** Agent bu oturum boyunca katalog dışında tutulsun mu. */
  quarantine: boolean;
  reason: string;
}

export interface RecoveryInput {
  failure: FailureClass;
  /** Bu agent üzerinde şimdiye kadar yapılmış yeniden deneme sayısı. */
  attempt: number;
  /** Bu atama için şimdiye kadar kullanılmış devir sayısı. */
  failoversUsed: number;
  /** Devredilebilecek, aynı yetenekte sağlıklı başka bir agent var mı. */
  hasAlternative: boolean;
  resilience: NexcodeConfig["resilience"];
}

/**
 * Bir başarısızlıktan sonra ne yapılacağına karar verir.
 *
 * - `transient` → `transientRetries` kadar üstel bekleyerek aynı agent.
 * - `auth` / `model` → agent oturum boyunca karantinaya alınır, iş devredilir.
 * - `timeout` / `stalled` / `permanent` → devir; karantina yok (geçici koşul olabilir).
 */
export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  const { failure, attempt, failoversUsed, hasAlternative, resilience } = input;

  if (failure === "transient" && attempt < resilience.transientRetries) {
    const delaySeconds = resilience.retryBaseSeconds * Math.pow(2, attempt);
    return {
      action: "retry",
      delayMs: delaySeconds * 1000,
      quarantine: false,
      reason: `Geçici sağlayıcı hatası; ${String(delaySeconds)} sn sonra aynı agent ile yeniden denenecek.`,
    };
  }

  const quarantine = failure === "auth" || failure === "model";

  if (hasAlternative && failoversUsed < resilience.maxFailoverAgents) {
    return {
      action: "failover",
      delayMs: 0,
      quarantine,
      reason: quarantine
        ? `Agent bu oturumda kullanılamıyor (${failure}); iş aynı yetenekteki başka bir agent'a devrediliyor.`
        : `Kalıcı hata (${failure}); iş aynı yetenekteki başka bir agent'a devrediliyor.`,
    };
  }

  return {
    action: "give-up",
    delayMs: 0,
    quarantine,
    reason: hasAlternative
      ? `Devir hakkı tükendi (${String(resilience.maxFailoverAgents)}); atama başarısız sayılıyor.`
      : `Aynı yetenekte kullanılabilir başka agent yok; atama başarısız sayılıyor.`,
  };
}

/**
 * `stalled` durumunun kullanıcıya gösterilen özeti.
 *
 * Bir CLI önce dosya ve araç çıktıları üretip yalnızca son adımda sessiz kalabilir; bu yüzden
 * mesaj "hiç çalışmadı" demez: o ana kadarki ilerleme kaydının korunduğunu söyler.
 */
export function stalledSummary(silenceSeconds: number): string {
  return [
    `Agent ${String(silenceSeconds)} saniye boyunca yeni çıktı üretmediği için delegasyon sonlandırıldı.`,
    "Bu, sürecin hiç çalışmadığı anlamına gelmez: o ana kadarki ilerleme kayıtları korunmuştur.",
  ].join(" ");
}

/** Oturum boyunca sorunlu agent'ları katalog dışında tutan basit kayıt. */
export class QuarantineRegistry {
  private readonly entries = new Map<string, string>();

  quarantine(agentId: string, reason: string): void {
    if (!this.entries.has(agentId)) this.entries.set(agentId, reason);
  }

  has(agentId: string): boolean {
    return this.entries.has(agentId);
  }

  reasonFor(agentId: string): string | undefined {
    return this.entries.get(agentId);
  }

  get ids(): ReadonlySet<string> {
    return new Set(this.entries.keys());
  }

  clear(): void {
    this.entries.clear();
  }
}
