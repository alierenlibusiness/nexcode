import type { AssignmentKind } from "../config/schema";
import type { CatalogAgent, NormalizedAssignment } from "./routing";
import type { RoundPolicy } from "./rounds";

/**
 * Prompt construction and character budgets.
 *
 * Two invariants are preserved:
 * 1. Context is **never truncated silently**: truncation is always reported with a visible marker.
 * 2. Large user text does not break the strict JSON operator protocol; it spills to a file.
 */

/** Trims text from the end (for "the newest matters" content such as memory or logs). */
export function trimFromEnd(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;
  const kept = text.slice(text.length - budget);
  return `[… ${String(text.length - budget)} characters trimmed …]\n${kept}`;
}

/** Trims text from the start (for "the oldest matters" content such as plans or instructions). */
export function trimFromStart(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}\n[… ${String(text.length - budget)} characters trimmed …]`;
}

export interface PromptDigest {
  /** The text embedded into the model prompt. */
  text: string;
  /** File the full text is written to; null when no trimming was needed. */
  spill: { relativePath: string; content: string } | null;
}

/**
 * When the user task text exceeds the budget, the full text is written to
 * `.nexcode/TASK-<id>.md` in the working directory, and only a head plus tail summary and a
 * "read the full text from the file" marker are embedded into the prompt.
 *
 * This keeps a 1000+ line spec from breaking the operator's strict JSON protocol, and no
 * section is ever dropped without telling the user.
 */
export function digestTaskPrompt(taskId: string, prompt: string, budget: number): PromptDigest {
  if (prompt.length <= budget) return { text: prompt, spill: null };

  const relativePath = `.nexcode/TASK-${taskId}.md`;
  const half = Math.floor((budget - 400) / 2);
  const head = prompt.slice(0, half);
  const tail = prompt.slice(prompt.length - half);

  const text = [
    `[The task text is ${String(prompt.length)} characters, so it was not embedded in full.]`,
    `[FULL TEXT: in \`${relativePath}\` in the working directory. READ that file BEFORE deciding.]`,
    "",
    "── Start of the text ──",
    head,
    "",
    `[… the middle ${String(prompt.length - half * 2)} characters are only in the file …]`,
    "",
    "── End of the text ──",
    tail,
  ].join("\n");

  return { text, spill: { relativePath, content: prompt } };
}

const PHASE_SCHEMA: Readonly<Record<"plan" | "evaluate", string>> = {
  plan: [
    "In this phase produce exactly one of THREE options:",
    "",
    "1) A delegation plan:",
    '{"status":"plan","planSummary":"<short plan description>",',
    ' "acceptanceCriteria":["<observable outcome>"],',
    ' "assignments":[{"id":"<short unique id>","agentId":"<agent from the catalog>",',
    '   "kind":"plan|implement|review|research","instruction":"<context, exact scope, expected',
    '   deliverable, boundaries, verification criteria>","dependsOn":["<id of an assignment that finishes first>"],',
    '   "skills":["<skill name from the shortlist>"]}]}',
    "",
    "2) A direct answer when no delegation is needed:",
    '{"status":"complete","final":"<result for the user>","verification":"<verification performed>","remainingRisk":"<if any>"}',
    "",
    "3) When there is a concrete blocker:",
    '{"status":"blocked","blocked":"<blocker and its evidence>","needed":"<information or permission required>"}',
  ].join("\n"),
  evaluate: [
    "In this phase produce exactly one of THREE options:",
    "",
    "1) A new round for the work that remains:",
    '{"status":"continue","planSummary":"<why another round is needed>",',
    ' "acceptanceCriteria":["<remaining criterion>"],',
    ' "assignments":[{"id":"…","agentId":"…","kind":"plan|implement|review|research",',
    '   "instruction":"…","dependsOn":[],"skills":[]}]}',
    "",
    "2) When the acceptance criteria are met:",
    '{"status":"complete","final":"<result for the user>","verification":"<important verification>","remainingRisk":"<remaining risk or empty>"}',
    "",
    "3) When the work cannot be completed safely:",
    '{"status":"blocked","blocked":"<blocker and its evidence>","needed":"<information or permission required>"}',
  ].join("\n"),
};

export interface SkillHint {
  name: string;
  summary: string;
  /** Path to the full guide the specialist reads when needed. */
  referencePath: string;
}

export interface OperatorPromptInput {
  phase: "plan" | "evaluate";
  /** Contents of `roles/operator.md`. */
  roleText: string;
  goal: string;
  policy: RoundPolicy;
  round: number;
  catalog: readonly CatalogAgent[];
  /** Shortlist scored against the task (not the whole catalogue). */
  skills: readonly SkillHint[];
  /** The `.nexcode/CONTEXT.md` project profile. */
  projectContext: string;
  /** Summary of the previous rounds; bounded by `policy.contextCharBudget`. */
  teamState: string;
  /**
   * Evidence block of the verification commands that were run (`verifyEvidence`).
   * An empty string means the gate never ran and the section is not printed.
   */
  verifyEvidence?: string;
  /** Repair instruction after a protocol error. */
  repairInstruction?: string;
}

export function buildOperatorPrompt(input: OperatorPromptInput): string {
  const sections: string[] = [input.roleText.trim(), "", "═══ WORKING PHASE ═══", ""];

  sections.push(
    `Phase: ${input.phase === "plan" ? "PLANNING" : "EVALUATION"}`,
    `Round: ${String(input.round)} / ${String(input.policy.maxRounds)}`,
    `Execution mode: ${input.policy.mode}`,
    `You may open at most ${String(input.policy.maxDelegationsPerRound)} delegations in this round.`,
    input.policy.requireReview
      ? "In this mode implementation work must pass an independent review."
      : "This mode allows a single implementer for small tasks; do not open unnecessary roles.",
    input.policy.separatePlanning
      ? "This mode keeps a separate planning delegation."
      : "Do not open a separate planning round; fold planning into the chain of the first round.",
    "",
  );

  sections.push("═══ AGENT CATALOG (you may only assign work to these agents) ═══", "");
  if (input.catalog.length === 0) {
    sections.push("(The catalog is empty: there is no specialist agent. Do not invent a result; report the concrete blocker.)");
  } else {
    for (const agent of input.catalog) {
      const kinds = agent.allowedKinds.join(", ") || "none";
      const domain = agent.domain !== undefined ? ` · domain: ${agent.domain}` : "";
      sections.push(`- ${agent.id} · ${agent.name} · role: ${agent.role}${domain} · can take: ${kinds}`);
    }
  }
  sections.push("");

  if (input.skills.length > 0) {
    sections.push(
      "═══ SKILLS (AUTHORITATIVE source) ═══",
      "",
      "This section is the skill inventory of the system and the ONLY correct source. When",
      "asked about the number, the name or the existence of a skill, always rely on this;",
      "do not count the internal skills of the CLI you run as skills of this system. Add at",
      "most a few genuinely relevant skills to the `skills` field of a delegation; leave the",
      "field empty when no skill fits.",
      "",
    );
    for (const skill of input.skills) {
      sections.push(`- ${skill.name}: ${skill.summary}`);
    }
    sections.push("");
  }

  if (input.projectContext.trim() !== "") {
    sections.push("═══ PROJECT PROFILE ═══", "", input.projectContext.trim(), "");
  }

  if (input.teamState.trim() !== "") {
    sections.push(
      "═══ PREVIOUS ROUNDS ═══",
      "",
      trimFromEnd(input.teamState.trim(), input.policy.contextCharBudget),
      "",
    );
  }

  // Executed evidence is placed ahead of the model's own claim.
  if (input.verifyEvidence !== undefined && input.verifyEvidence.trim() !== "") {
    sections.push("═══ VERIFICATION GATE ═══", "", input.verifyEvidence.trim(), "");
  }

  sections.push("═══ USER GOAL ═══", "", input.goal, "");

  if (input.repairInstruction !== undefined) {
    sections.push("═══ PROTOCOL REPAIR ═══", "", input.repairInstruction, "");
  }

  sections.push("═══ OUTPUT CONTRACT ═══", "", PHASE_SCHEMA[input.phase], "");
  sections.push(
    "Produce NOTHING other than this JSON object: no Markdown, no code block, no preamble, no epilogue, no commentary.",
  );

  return sections.join("\n");
}

export interface WorkerPromptInput {
  /** Contents of `roles/<role>.md`. */
  roleText: string;
  assignment: NormalizedAssignment;
  goal: string;
  /** Outputs of the assignments it depends on (for example plan -> implementation). */
  upstream: ReadonlyArray<{ id: string; kind: AssignmentKind; output: string }>;
  skills: readonly SkillHint[];
  projectContext: string;
  /** Writable root while the sandbox is on. */
  workingDir: string;
  sandboxed: boolean;
  contextCharBudget: number;
}

export function buildWorkerPrompt(input: WorkerPromptInput): string {
  const sections: string[] = [input.roleText.trim(), "", "═══ MAIN GOAL ═══", "", input.goal, ""];

  sections.push("═══ WORK DELEGATED TO YOU ═══", "", input.assignment.instruction, "");

  if (input.upstream.length > 0) {
    sections.push("═══ OUTPUT OF THE PREVIOUS STEPS ═══", "");
    const perItem = Math.floor(input.contextCharBudget / input.upstream.length);
    for (const item of input.upstream) {
      sections.push(`── ${item.id} (${item.kind}) ──`, trimFromStart(item.output.trim(), perItem), "");
    }
  }

  if (input.projectContext.trim() !== "") {
    sections.push("═══ PROJECT PROFILE ═══", "", input.projectContext.trim(), "");
  }

  if (input.skills.length > 0) {
    sections.push("═══ SKILL GUIDES ═══", "");
    sections.push("Apply the summary first; if that is not enough, READ the guide file and follow its procedure.", "");
    for (const skill of input.skills) {
      sections.push(`- ${skill.name}: ${skill.summary}`, `  Full guide: ${skill.referencePath}`);
    }
    sections.push("");
  }

  sections.push("═══ WORKING BOUNDARY ═══", "");
  sections.push(`Working directory: ${input.workingDir}`);
  if (input.sandboxed) {
    sections.push(
      "Do not write OUTSIDE this directory. If a change is needed outside it, do not make it; report the blocker.",
      "Preserve the user's existing or unrelated changes; do not revert, delete or overwrite them.",
    );
  }
  sections.push("");

  return sections.join("\n");
}
