import type { NexcodeConfig } from "../config/schema";

/**
 * Failure classification and recovery policy.
 *
 * On a transient provider error the delegation is retried with the same agent using
 * exponential backoff; on a permanent error the work is handed to a healthy agent with the
 * same capability. Going back to the operator and spending a new planning round is the
 * **last resort**: it is expensive and makes completed work repeat.
 */

export type FailureClass =
  /** Rate limit, overload, network jitter: wait and retry with the same agent. */
  | "transient"
  /** Not signed in or unauthorised: the agent cannot be used in this session. */
  | "auth"
  /** Model not found or not reachable: the agent cannot be used in this session. */
  | "model"
  /** The total time ceiling was exceeded. */
  | "timeout"
  /** No new output for a long time. It does NOT mean the process never ran; progress is preserved. */
  | "stalled"
  /** Everything else. */
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
  // Turkish CLI wording, kept so Turkish-locale CLI output is classified correctly.
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
  /** The total time ceiling was exceeded. */
  timedOut?: boolean;
  /** The silence limit was exceeded. */
  stalled?: boolean;
}

/** Turns a delegation failure into a class the recovery policy understands. */
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
  /** How long to wait for a `retry`. */
  delayMs: number;
  /** Whether the agent should be kept out of the catalog for this session. */
  quarantine: boolean;
  reason: string;
}

export interface RecoveryInput {
  failure: FailureClass;
  /** Number of retries performed on this agent so far. */
  attempt: number;
  /** Number of failovers used for this assignment so far. */
  failoversUsed: number;
  /** Whether another healthy agent with the same capability is available to take over. */
  hasAlternative: boolean;
  resilience: NexcodeConfig["resilience"];
}

/**
 * Decides what to do after a failure.
 *
 * - `transient` -> the same agent, with exponential backoff, up to `transientRetries`.
 * - `auth` / `model` -> the agent is quarantined for the session and the work is handed over.
 * - `timeout` / `stalled` / `permanent` -> failover without quarantine (it may be temporary).
 */
export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  const { failure, attempt, failoversUsed, hasAlternative, resilience } = input;

  if (failure === "transient" && attempt < resilience.transientRetries) {
    const delaySeconds = resilience.retryBaseSeconds * Math.pow(2, attempt);
    return {
      action: "retry",
      delayMs: delaySeconds * 1000,
      quarantine: false,
      reason: `Transient provider error; retrying with the same agent in ${String(delaySeconds)}s.`,
    };
  }

  const quarantine = failure === "auth" || failure === "model";

  if (hasAlternative && failoversUsed < resilience.maxFailoverAgents) {
    return {
      action: "failover",
      delayMs: 0,
      quarantine,
      reason: quarantine
        ? `The agent cannot be used in this session (${failure}); the work is handed to another agent with the same capability.`
        : `Permanent error (${failure}); the work is handed to another agent with the same capability.`,
    };
  }

  return {
    action: "give-up",
    delayMs: 0,
    quarantine,
    reason: hasAlternative
      ? `Failover budget exhausted (${String(resilience.maxFailoverAgents)}); the assignment counts as failed.`
      : `No other agent with the same capability is available; the assignment counts as failed.`,
  };
}

/**
 * The user facing summary of the `stalled` condition.
 *
 * A CLI may produce file and tool output first and only fall silent on the last step, so the
 * message does not say "it never ran": it says the progress made up to that point is preserved.
 */
export function stalledSummary(silenceSeconds: number): string {
  return [
    `The delegation was terminated because the agent produced no new output for ${String(silenceSeconds)} seconds.`,
    "This does not mean the process never ran: the progress recorded up to that point is preserved.",
  ].join(" ");
}

/** A simple registry that keeps problematic agents out of the catalog for the session. */
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
