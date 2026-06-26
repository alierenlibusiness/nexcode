import { providerCliKind } from "./registry";

/**
 * Abonelik kotası takibi (PRD §9.3/§9.4). CLI abonelikleri 5 saatlik kayan pencerede
 * token bütçesi paylaşır; CEO+Backend AYNI Claude Code havuzunu tüketir → kota havuz
 * bazında izlenir, agent bazında değil. Kota dolunca factory API moduna geçer (§9.4).
 *
 * Saf, in-process; saat enjekte edilebilir (test). Dağıtık/kalıcı kota yalnızca
 * opsiyonel bulut katmanında gerekir.
 */
export interface QuotaWindow {
  /** Kayan pencere süresi (ms). Varsayılan 5 saat. */
  windowMs: number;
  /** Pencere içi maksimum token bütçesi. */
  maxTokens: number;
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

interface UsageEvent {
  at: number;
  tokens: number;
}

export class QuotaTracker {
  private readonly windows = new Map<string, QuotaWindow>();
  private readonly events = new Map<string, UsageEvent[]>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Bir havuz için kota penceresi tanımlar (yoksa o havuz sınırsız sayılır). */
  configure(poolId: string, window: QuotaWindow): void {
    this.windows.set(poolId, window);
  }

  /** Havuza token kullanımı ekler. */
  record(poolId: string, tokens: number, at: number = this.now()): void {
    const list = this.events.get(poolId) ?? [];
    list.push({ at, tokens });
    this.events.set(poolId, list);
  }

  /** Geçerli kayan penceredeki toplam token kullanımı. */
  usage(poolId: string, at: number = this.now()): number {
    const window = this.windows.get(poolId);
    const windowMs = window?.windowMs ?? FIVE_HOURS_MS;
    const cutoff = at - windowMs;
    const list = this.events.get(poolId);
    if (!list) return 0;
    // Pencere dışı eski olayları buda (bellek sınırlama).
    const live = list.filter((e) => e.at > cutoff);
    this.events.set(poolId, live);
    return live.reduce((sum, e) => sum + e.tokens, 0);
  }

  /** Havuz kotası hâlâ uygun mu (PRD §9.4 — false ise API'ye geçilir). */
  isAvailable(poolId: string, at: number = this.now()): boolean {
    const window = this.windows.get(poolId);
    if (!window) return true; // kota tanımsız → sınırsız varsay
    return this.usage(poolId, at) < window.maxTokens;
  }
}

/**
 * Bir sağlayıcının abonelik havuzu kimliği. Aynı CLI'yı paylaşan roller (CEO+Backend →
 * Claude Code) aynı havuzu tüketir, dolayısıyla pool = CLI türü (PRD §9.3).
 */
export function poolIdForProvider(provider: string): string | undefined {
  return providerCliKind(provider);
}
