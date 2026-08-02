import type { CliAdapter } from "../../config/schema";
import type { JsonObject, JsonValue } from "../../json";

/**
 * CLI output normalisation.
 *
 * Every CLI returns its own envelope. When Claude Code runs with `--output-format json`
 * it places the actual answer inside the `result` field and wraps session, usage and cost
 * information around it. If that envelope is not stripped, the engine mistakes it for an
 * operator decision and every task fails with a "schema mismatch".
 *
 * Stripping the envelope also recovers the real cost: the amount the CLI reports can be
 * written into the `cost_logs` record without estimating.
 */

export interface NormalizedCliOutput {
  /** The actual text handed to the operator/specialist protocol. */
  text: string;
  /** The real cost reported by the CLI; 0 when unknown. */
  usdCost: number;
  /** Readable reason when the CLI finished the work as an error. */
  error: string | null;
}

/**
 * Reduces raw stdout to the actual text according to the adapter.
 *
 * When the envelope is not in the expected shape the raw text is returned as is: if a CLI
 * version changes its output format, the system keeps working instead of silently
 * producing an empty answer.
 */
export function normalizeCliOutput(adapter: CliAdapter | undefined, stdout: string): NormalizedCliOutput {
  const raw = stdout.trim();
  if (raw === "") return { text: "", usdCost: 0, error: null };

  if (adapter === "claude") return unwrapClaude(raw);
  return { text: raw, usdCost: 0, error: null };
}

/**
 * The Claude Code JSON envelope.
 *
 * Shape: `{ type: "result", subtype, is_error, result: "<text>", total_cost_usd, usage… }`
 */
function unwrapClaude(raw: string): NormalizedCliOutput {
  const envelope = parseObject(raw);
  if (envelope === null) return { text: raw, usdCost: 0, error: null };

  // Without `result` this is not an envelope; the text itself may just be JSON.
  const result = envelope.result;
  if (typeof result !== "string") return { text: raw, usdCost: 0, error: null };

  const usdCost = typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : 0;
  const failed = envelope.is_error === true;
  const apiError = typeof envelope.api_error_status === "string" ? envelope.api_error_status : null;

  return {
    text: result,
    usdCost,
    error: failed ? (apiError ?? firstLine(result) ?? "The CLI returned an error") : null,
  };
}

function parseObject(raw: string): JsonObject | null {
  try {
    const value = JSON.parse(raw) as JsonValue;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function firstLine(text: string): string | null {
  return text.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? null;
}
