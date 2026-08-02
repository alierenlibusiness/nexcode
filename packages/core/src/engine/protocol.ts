import { z } from "zod";
import { ASSIGNMENT_KINDS } from "../config/schema";

/**
 * The operator decision protocol.
 *
 * On every call the operator produces **only** a single JSON object matching this schema:
 * no Markdown, no code block, no preamble, no epilogue, no commentary. Parsing is retried
 * only on protocol errors and only `operator.protocolRetries` times: model output is never
 * silently reinterpreted.
 *
 * The parsing side is still forgiving (code fences, surrounding prose): a strict prompt plus
 * a tolerant parser keeps a single formatting slip from throwing away the round.
 */

const assignmentSchema = z.object({
  /** Short, meaningful identifier, unique within the round. */
  id: z.string().min(1).max(64),
  /** Id of an enabled and healthy agent from the catalog. */
  agentId: z.string().min(1),
  kind: z.enum(ASSIGNMENT_KINDS),
  /**
   * Context, exact scope, expected deliverable, boundaries and verification criteria.
   * The specialist is not expected to guess the main goal again.
   */
  instruction: z.string().min(1),
  /** Assignment ids this work waits for (chaining within the same round). */
  dependsOn: z.array(z.string()).default([]),
  /** Skill names chosen from the shortlist the engine offers. */
  skills: z.array(z.string()).default([]),
});

export type OperatorAssignment = z.infer<typeof assignmentSchema>;

/**
 * The delegation body. `plan` (first round) and `continue` (later rounds) carry the same
 * fields; they are defined as two variants because a discriminated union needs a single
 * literal discriminator.
 */
const delegateFields = {
  /** Observable, task specific acceptance criteria. */
  acceptanceCriteria: z.array(z.string()).default([]),
  assignments: z.array(assignmentSchema).min(1),
  /** Short plan description shown to the user; a risky operation is stated explicitly here. */
  planSummary: z.string().default(""),
};

const planSchema = z.object({ status: z.literal("plan"), ...delegateFields });
const continueSchema = z.object({ status: z.literal("continue"), ...delegateFields });

const completeSchema = z.object({
  status: z.literal("complete"),
  /** The result from the user's point of view; no raw logs or internal coordination detail. */
  final: z.string().min(1),
  /** The important verification that was performed. */
  verification: z.string().default(""),
  /** A remaining constraint that does not block delivery but should be known. */
  remainingRisk: z.string().default(""),
});

const blockedSchema = z.object({
  status: z.literal("blocked"),
  /** The concrete blocker and its evidence. */
  blocked: z.string().min(1),
  /** Information, permission or external state needed to continue. */
  needed: z.string().default(""),
});

export const operatorDecisionSchema = z.discriminatedUnion("status", [
  planSchema,
  continueSchema,
  completeSchema,
  blockedSchema,
]);

export type OperatorDecision = z.infer<typeof operatorDecisionSchema>;
export type DelegateDecision = z.infer<typeof planSchema> | z.infer<typeof continueSchema>;
export type CompleteDecision = z.infer<typeof completeSchema>;
export type BlockedDecision = z.infer<typeof blockedSchema>;

export type ParseResult =
  | { ok: true; decision: OperatorDecision }
  | { ok: false; error: string };

/**
 * Extracts the first balanced JSON object from text. In order: direct parse, stripping code
 * fences, then a balanced scan from the first `{` to its matching `}` (aware of strings and
 * escapes).
 */
export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const haystack = fenced?.[1]?.trim() ?? trimmed;
  if (haystack.startsWith("{")) return haystack;

  const start = haystack.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i++) {
    const char = haystack[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}

/** Turns operator output into a decision object; on failure it returns a repairable error text. */
export function parseOperatorDecision(text: string): ParseResult {
  const raw = extractJsonObject(text);
  if (raw === null) {
    return { ok: false, error: "No JSON object was found in the output. Produce a single JSON object only." };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const parsed = operatorDecisionSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `Schema mismatch; ${issues}` };
  }

  return { ok: true, decision: parsed.data };
}

/** Whether the decision produces delegations (plan or continue). */
export function isDelegateDecision(decision: OperatorDecision): decision is DelegateDecision {
  return decision.status === "plan" || decision.status === "continue";
}

/**
 * The repair instruction sent to the operator after a protocol error.
 * It does not spend a new planning round; it only asks for the format to be corrected.
 */
export function protocolRepairInstruction(error: string): string {
  return [
    "Your previous output did not follow the protocol and could not be used.",
    `Error: ${error}`,
    "This time produce ONLY a single JSON object. Do not add Markdown, a code block, an",
    "explanation or any other text. Follow the schema exactly.",
  ].join("\n");
}
