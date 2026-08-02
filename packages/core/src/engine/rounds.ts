import type { ExecutionMode, NexcodeConfig } from "../config/schema";

/**
 * Execution policy: sets the speed and quality budget of a task.
 *
 * Small work is not split across unnecessary roles, and multi-component or risky work is not
 * piled onto a single specialist. `auto` inspects the task and resolves to one of the other
 * three modes; the heuristic does not run when the user chose a mode explicitly.
 */
export interface RoundPolicy {
  mode: Exclude<ExecutionMode, "auto">;
  maxRounds: number;
  maxDelegationsPerRound: number;
  /**
   * Whether an independent review is mandatory when the first plan contains implementation work.
   * `fast` settles for a single executor on small tasks.
   */
  requireReview: boolean;
  /**
   * Whether a separate planning delegation is opened. `balanced` folds planning into the
   * chain of the first round (`plan -> implement -> review`); `deep` keeps a separate
   * planning round.
   */
  separatePlanning: boolean;
  /** Context budget (in characters) of the team and round state given to the operator. */
  contextCharBudget: number;
}

const BASE_POLICIES: Readonly<Record<Exclude<ExecutionMode, "auto">, Omit<RoundPolicy, "contextCharBudget">>> = {
  fast: {
    mode: "fast",
    maxRounds: 2,
    maxDelegationsPerRound: 3,
    requireReview: false,
    separatePlanning: false,
  },
  balanced: {
    // Capped at three rounds to avoid expensive rounds that re-audit finished work.
    mode: "balanced",
    maxRounds: 3,
    maxDelegationsPerRound: 6,
    requireReview: true,
    separatePlanning: false,
  },
  deep: {
    mode: "deep",
    maxRounds: 6,
    maxDelegationsPerRound: 8,
    requireReview: true,
    separatePlanning: true,
  },
};

/** Ratio of the context budget per mode: deep mode uses the full budget. */
const CONTEXT_RATIO: Readonly<Record<Exclude<ExecutionMode, "auto">, number>> = {
  fast: 0.35,
  balanced: 0.7,
  deep: 1,
};

/**
 * In `auto` mode, inspects the task and resolves it to a concrete mode.
 *
 * - `deep`    : multi-component, architecturally significant, risky or long-spec work.
 * - `fast`    : small, low risk, single file fixes.
 * - `balanced`: everything else (the default).
 *
 * The signal lists carry both English and Turkish wording so the heuristic works for users
 * who write their task in either language.
 */
const DEEP_SIGNALS = [
  "refactor",
  "yeniden yaz",
  "rewrite",
  "mimari",
  "architecture",
  "migrasyon",
  "migration",
  "güvenlik",
  "security",
  "performans",
  "performance",
  "deploy",
  "release",
  "breaking change",
  "veritabanı şeması",
  "database schema",
];

const FAST_SIGNALS = [
  "typo",
  "yazım",
  "rename",
  "yeniden adlandır",
  "log ekle",
  "add a log",
  "bump",
  "sürüm yükselt",
  "yorum ekle",
  "add comment",
  "format",
];

export function resolveExecutionMode(mode: ExecutionMode, prompt: string): Exclude<ExecutionMode, "auto"> {
  if (mode !== "auto") return mode;

  const text = prompt.toLowerCase();
  if (prompt.length > 1200 || DEEP_SIGNALS.some((signal) => text.includes(signal))) {
    return "deep";
  }
  if (prompt.length < 200 && FAST_SIGNALS.some((signal) => text.includes(signal))) {
    return "fast";
  }
  return "balanced";
}

/**
 * Builds the round policy from the resolved mode and the user configuration.
 * The operator limits in the config are a **ceiling**: the mode policy cannot exceed them.
 */
export function roundPolicyFor(mode: ExecutionMode, prompt: string, config: NexcodeConfig): RoundPolicy {
  const resolved = resolveExecutionMode(mode, prompt);
  const base = BASE_POLICIES[resolved];
  return {
    ...base,
    maxRounds: Math.min(base.maxRounds, config.operator.maxRounds),
    maxDelegationsPerRound: Math.min(base.maxDelegationsPerRound, config.operator.maxDelegationsPerRound),
    contextCharBudget: Math.round(config.teamContextCharBudget * CONTEXT_RATIO[resolved]),
  };
}

/** Whether the round limit is reached: if so the engine moves to partial delivery. */
export function isFinalRound(round: number, policy: RoundPolicy): boolean {
  return round >= policy.maxRounds;
}
