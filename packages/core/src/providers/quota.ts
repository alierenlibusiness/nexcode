import { providerCliKind } from "./registry";

/**
 * Subscription quota tracking. CLI subscriptions share a token budget over a 5 hour
 * sliding window; CEO and Backend consume the SAME Claude Code pool, so the quota is
 * tracked per pool rather than per agent. When the quota runs out the factory switches to
 * API mode.
 *
 * Pure and in-process; the clock is injectable for tests. A distributed or persistent
 * quota is only needed in the optional cloud layer.
 */
export interface QuotaWindow {
  /** Sliding window duration in ms. Defaults to 5 hours. */
  windowMs: number;
  /** Maximum token budget within the window. */
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

  /** Defines the quota window for a pool (a pool without one counts as unlimited). */
  configure(poolId: string, window: QuotaWindow): void {
    this.windows.set(poolId, window);
  }

  /** Adds token usage to the pool. */
  record(poolId: string, tokens: number, at: number = this.now()): void {
    const list = this.events.get(poolId) ?? [];
    list.push({ at, tokens });
    this.events.set(poolId, list);
  }

  /** Total token usage in the current sliding window. */
  usage(poolId: string, at: number = this.now()): number {
    const window = this.windows.get(poolId);
    const windowMs = window?.windowMs ?? FIVE_HOURS_MS;
    const cutoff = at - windowMs;
    const list = this.events.get(poolId);
    if (!list) return 0;
    // Prune old events outside the window (bounds memory).
    const live = list.filter((e) => e.at > cutoff);
    this.events.set(poolId, live);
    return live.reduce((sum, e) => sum + e.tokens, 0);
  }

  /** Whether the pool quota is still available; when false the caller switches to the API. */
  isAvailable(poolId: string, at: number = this.now()): boolean {
    const window = this.windows.get(poolId);
    if (!window) return true; // no quota defined, assume unlimited
    return this.usage(poolId, at) < window.maxTokens;
  }
}

/**
 * The subscription pool identifier of a provider. Roles that share the same CLI (CEO and
 * Backend both use Claude Code) consume the same pool, so pool equals CLI kind.
 */
export function poolIdForProvider(provider: string): string | undefined {
  return providerCliKind(provider);
}
