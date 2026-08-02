/**
 * The machine side of the specialist output contracts.
 *
 * Role files are kept in two languages, but the **markers the machine reads are never
 * translated**: `STATUS:` and `VERDICT:` are identical in every language, so parsing does
 * not break when the interface language changes. The Turkish equivalents (`DURUM:` /
 * `KARAR:`) are still tolerated in case a model translates the marker anyway.
 */

export type ReviewVerdict = "PASS" | "FAIL";
export type WorkerStatus = "COMPLETED" | "BLOCKED";

const VERDICT_LINE = /^\s*(?:VERDICT|KARAR)\s*:\s*(PASS|FAIL|GEÇTI|GEÇTİ|KALDI)\s*$/i;
const STATUS_LINE = /^\s*(?:STATUS|DURUM)\s*:\s*(COMPLETED|BLOCKED|TAMAMLANDI|ENGELLENDI|ENGELLENDİ)\s*$/i;

function normalizeVerdict(token: string): ReviewVerdict {
  const upper = token.toUpperCase();
  return upper === "PASS" || upper === "GEÇTI" || upper === "GEÇTİ" ? "PASS" : "FAIL";
}

function normalizeStatus(token: string): WorkerStatus {
  const upper = token.toUpperCase();
  return upper === "COMPLETED" || upper === "TAMAMLANDI" ? "COMPLETED" : "BLOCKED";
}

function lastNonEmptyLine(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line !== undefined && line.trim() !== "") return line;
  }
  return null;
}

/**
 * Reads the review verdict. By contract the **last** line of the output must be
 * `VERDICT: PASS` or `VERDICT: FAIL` with no text after it. If the last line does not
 * match, the verdict is undecided (`null`) and the engine treats it as a review failure: it
 * never silently assumes PASS.
 */
export function parseVerdict(text: string): ReviewVerdict | null {
  const last = lastNonEmptyLine(text);
  if (last === null) return null;
  const match = last.match(VERDICT_LINE);
  return match?.[1] !== undefined ? normalizeVerdict(match[1]) : null;
}

/** Status of the implementer's delivery report; `null` when not found. */
export function parseWorkerStatus(text: string): WorkerStatus | null {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(STATUS_LINE);
    if (match?.[1] !== undefined) return normalizeStatus(match[1]);
  }
  return null;
}

/**
 * Extracts the reasons behind a review `FAIL`, used to open a targeted fix task in the next
 * round. Only CRITICAL and HIGH findings require a fix; MEDIUM and LOW are reported as
 * remaining risk.
 */
export function extractBlockingFindings(text: string): string[] {
  const findings: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s*\[(CRITICAL|HIGH)\]\s*(.+)$/i);
    const detail = match?.[2];
    if (detail !== undefined) findings.push(detail.trim());
  }
  return findings;
}

export interface RoundOutcome {
  /** Whether every assignment in the round settled (succeeded or permanently failed). */
  allAssignmentsSettled: boolean;
  /** The most recent review verdict of the round; null when there was no review. */
  latestVerdict: ReviewVerdict | null;
  /** Whether at least one assignment in the round failed permanently. */
  hasFailure: boolean;
}

/**
 * PASS fast path: when every assignment of the round completed and the most recent review is
 * `PASS`, the second operator evaluation call is skipped and the work is delivered directly.
 *
 * From the user's point of view the most expensive outcome is finished work being held back
 * for extra verification rounds. `operator.passFastPath: false` forces the older, more
 * expensive evaluation path.
 */
export function shouldFastPathDeliver(outcome: RoundOutcome, passFastPathEnabled: boolean): boolean {
  if (!passFastPathEnabled) return false;
  if (!outcome.allAssignmentsSettled) return false;
  if (outcome.hasFailure) return false;
  return outcome.latestVerdict === "PASS";
}

/**
 * After a `PASS` no new review should be opened for the same delivery. The engine applies
 * this check to the operator's plan too: a review assignment produced while a fresh PASS
 * exists is dropped.
 */
export function shouldDropRedundantReview(latestVerdict: ReviewVerdict | null, deliverableChanged: boolean): boolean {
  return latestVerdict === "PASS" && !deliverableChanged;
}
