import {
  ALLOWED_KINDS,
  roleForKind,
  type AgentProfile,
  type AssignmentKind,
  type CliAdapter,
  type NexcodeConfig,
  type OrchestrationRole,
} from "../config/schema";
import type { OperatorAssignment } from "./protocol";
import type { RoundPolicy } from "./rounds";

/**
 * The agent catalog offered to the operator, and assignment routing.
 *
 * A role is not just prompt text, it is the **kind of work that is allowed**. Even if the
 * operator produces a wrong pairing, the engine moves the assignment to a suitable role;
 * legacy capability values in a profile cannot widen that boundary.
 */

export interface CatalogAgent {
  id: string;
  name: string;
  role: OrchestrationRole;
  domain: string | undefined;
  adapter: CliAdapter | undefined;
  /** The binding contract reported to the operator. */
  allowedKinds: readonly AssignmentKind[];
  healthy: boolean;
}

export interface CatalogInput {
  config: NexcodeConfig;
  /** Health check result; without a record an agent counts as healthy (as API-only agents do). */
  health?: Readonly<Record<string, boolean>>;
  /** Ids of agents quarantined for the session. */
  quarantined?: ReadonlySet<string>;
}

/**
 * The agent catalog the operator can see. The operator itself is not in the catalog: it
 * cannot assign work to itself.
 */
export function buildCatalog({ config, health = {}, quarantined = new Set() }: CatalogInput): CatalogAgent[] {
  const operatorId = resolveOperatorId(config);
  const entries: CatalogAgent[] = [];

  for (const profile of stableProfiles(config)) {
    if (!profile.enabled) continue;
    if (profile.id === operatorId) continue;
    if (profile.role === "operator") continue;
    if (quarantined.has(profile.id)) continue;
    if (health[profile.id] === false) continue;

    entries.push({
      id: profile.id,
      name: profile.name,
      role: profile.role,
      domain: profile.domain,
      adapter: profile.adapter,
      allowedKinds: ALLOWED_KINDS[profile.role],
      healthy: health[profile.id] !== false,
    });
  }
  return entries;
}

/** The agent acting as operator: the first enabled `operator` role when no explicit choice exists. */
export function resolveOperatorId(config: NexcodeConfig): string | null {
  const explicit = config.operator.agentId;
  const chosen = explicit === "" ? undefined : config.agents[explicit];
  if (chosen?.enabled === true && chosen.role === "operator") return chosen.id;
  return stableProfiles(config).find((profile) => profile.enabled && profile.role === "operator")?.id ?? null;
}

/** Built-in domain agents first, discovered ones after: a stable, predictable order. */
function stableProfiles(config: NexcodeConfig): AgentProfile[] {
  return Object.values(config.agents).sort((a, b) => {
    if (a.discovered !== b.discovered) return a.discovered ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
}

export interface NormalizedAssignment extends OperatorAssignment {
  role: OrchestrationRole;
  agentName: string;
  adapter: CliAdapter | undefined;
  /** Why the engine changed it, when it did (logged for transparency). */
  repairedFrom?: string;
}

export interface NormalizeResult {
  assignments: NormalizedAssignment[];
  /** Repair and drop notes surfaced to the user and the log. */
  warnings: string[];
}

/**
 * Makes the raw assignments produced by the operator executable:
 * - Work given to an unknown, disabled or unhealthy agent is moved to a suitable agent.
 * - A kind of work the role does not allow is routed to the right role.
 * - Duplicate identifiers are made unique.
 * - Non-existent `dependsOn` references are dropped and cycles are broken.
 * - The per-round delegation cap is applied.
 */
export function normalizeAssignments(
  raw: readonly OperatorAssignment[],
  catalog: readonly CatalogAgent[],
  policy: RoundPolicy,
): NormalizeResult {
  const warnings: string[] = [];
  const byId = new Map(catalog.map((agent) => [agent.id, agent]));
  const usedIds = new Set<string>();
  const out: NormalizedAssignment[] = [];

  for (const assignment of raw.slice(0, policy.maxDelegationsPerRound)) {
    let agent = byId.get(assignment.agentId);
    let repairedFrom: string | undefined;

    if (agent === undefined) {
      const replacement = pickAgentForKind(catalog, assignment.kind);
      if (replacement === undefined) {
        warnings.push(
          `"${assignment.id}" was skipped: "${assignment.agentId}" is not in the catalog and no suitable agent can take ${assignment.kind} work.`,
        );
        continue;
      }
      repairedFrom = assignment.agentId;
      warnings.push(`"${assignment.id}" -> ${replacement.name}: "${assignment.agentId}" was not found in the catalog.`);
      agent = replacement;
    }

    if (!ALLOWED_KINDS[agent.role].includes(assignment.kind)) {
      const replacement = pickAgentForKind(catalog, assignment.kind);
      if (replacement === undefined) {
        warnings.push(
          `"${assignment.id}" was skipped: there is no agent in the ${roleForKind(assignment.kind)} role that can take ${assignment.kind} work.`,
        );
        continue;
      }
      repairedFrom = agent.id;
      warnings.push(
        `"${assignment.id}" -> ${replacement.name}: ${agent.name} (${agent.role}) cannot take ${assignment.kind} work.`,
      );
      agent = replacement;
    }

    const id = uniqueId(assignment.id, usedIds);
    if (id !== assignment.id) {
      warnings.push(`The identifier "${assignment.id}" was duplicated and became "${id}".`);
    }
    usedIds.add(id);

    out.push({
      ...assignment,
      id,
      agentId: agent.id,
      agentName: agent.name,
      adapter: agent.adapter,
      role: agent.role,
      skills: assignment.skills.slice(0, Math.max(0, policy.maxDelegationsPerRound)),
      ...(repairedFrom !== undefined ? { repairedFrom } : {}),
    });
  }

  if (raw.length > policy.maxDelegationsPerRound) {
    warnings.push(
      `The per-round delegation cap (${String(policy.maxDelegationsPerRound)}) was exceeded; the rest was left to the next round.`,
    );
  }

  return { assignments: pruneDependencies(out, warnings), warnings };
}

function pickAgentForKind(catalog: readonly CatalogAgent[], kind: AssignmentKind): CatalogAgent | undefined {
  return catalog.find((agent) => agent.healthy && ALLOWED_KINDS[agent.role].includes(kind));
}

function uniqueId(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${String(i)}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Drops non-existent dependencies and breaks cycles. */
function pruneDependencies(assignments: NormalizedAssignment[], warnings: string[]): NormalizedAssignment[] {
  const ids = new Set(assignments.map((a) => a.id));
  const cleaned = assignments.map((assignment) => {
    const kept = assignment.dependsOn.filter((dep) => dep !== assignment.id && ids.has(dep));
    if (kept.length !== assignment.dependsOn.length) {
      warnings.push(`Unresolvable dependencies were dropped for "${assignment.id}".`);
    }
    return { ...assignment, dependsOn: kept };
  });

  const cycle = findCycle(cleaned);
  if (cycle === null) return cleaned;

  warnings.push(`A dependency cycle was broken: ${cycle.join(" -> ")}.`);
  const victim = cycle[cycle.length - 1];
  return cleaned.map((assignment) => (assignment.id === victim ? { ...assignment, dependsOn: [] } : assignment));
}

function findCycle(assignments: readonly NormalizedAssignment[]): string[] | null {
  const graph = new Map(assignments.map((a) => [a.id, a.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const current = state.get(id);
    if (current === "done") return null;
    if (current === "visiting") return [...stack.slice(stack.indexOf(id)), id];

    state.set(id, "visiting");
    stack.push(id);
    for (const dep of graph.get(id) ?? []) {
      const found = visit(dep);
      if (found !== null) return found;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };

  for (const assignment of assignments) {
    const found = visit(assignment.id);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Produces groups that can run in parallel while preserving dependencies (Kahn).
 * Work in the same group can run concurrently: parallel is the default, sequential the exception.
 */
export function parallelBatches(assignments: readonly NormalizedAssignment[]): NormalizedAssignment[][] {
  const remaining = new Map(assignments.map((a) => [a.id, a]));
  const settled = new Set<string>();
  const batches: NormalizedAssignment[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((a) => a.dependsOn.every((dep) => settled.has(dep)));
    if (ready.length === 0) {
      // Defensive layer: this should be unreachable after pruneDependencies.
      batches.push([...remaining.values()]);
      break;
    }
    for (const assignment of ready) {
      remaining.delete(assignment.id);
      settled.add(assignment.id);
    }
    batches.push(ready);
  }
  return batches;
}

/**
 * Guarantees the ready role chain in the first round.
 *
 * In balanced or deep mode, when the catalog has a planner, an executor and a reviewer, all
 * three are used in the FIRST plan and chained through `dependsOn` as
 * `plan -> implement -> review`. A planner or reviewer the operator skipped is added by the
 * engine: a speed optimisation must not disable the roles the user enabled.
 *
 * No role is injected into research or review-only tasks that contain no plan or implementation.
 */
export function enforceRoleChain(
  assignments: readonly NormalizedAssignment[],
  catalog: readonly CatalogAgent[],
  policy: RoundPolicy,
  round: number,
): NormalizeResult {
  const warnings: string[] = [];
  if (round !== 1 || policy.mode === "fast") return { assignments: [...assignments], warnings };

  const implementations = assignments.filter((a) => a.kind === "implement");
  if (implementations.length === 0) return { assignments: [...assignments], warnings };

  const result = [...assignments];
  const usedIds = new Set(result.map((a) => a.id));

  // 1) Planning: added to the chain when the catalog has a planner and the operator skipped it.
  const planner = pickAgentForKind(catalog, "plan");
  const hasPlan = result.some((a) => a.kind === "plan");
  if (!hasPlan && planner !== undefined) {
    const planId = uniqueId("auto-plan", usedIds);
    usedIds.add(planId);
    result.unshift({
      id: planId,
      agentId: planner.id,
      agentName: planner.name,
      adapter: planner.adapter,
      role: planner.role,
      kind: "plan",
      instruction: [
        "Produce a read-only, actionable plan and acceptance criteria for the implementation work below.",
        "Before writing a file name, function or command, verify that it really exists in the project.",
        "",
        ...implementations.map((a) => `- ${a.instruction}`),
      ].join("\n"),
      dependsOn: [],
      skills: [],
      repairedFrom: "engine:role-chain",
    });
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      if (item !== undefined && item.kind === "implement") {
        result[i] = { ...item, dependsOn: [...new Set([...item.dependsOn, planId])] };
      }
    }
    warnings.push("The planning step was added to the chain by the engine (an available planner role had been skipped).");
  }

  // 2) Independent review: audits the implementation delivery.
  const reviewer = pickAgentForKind(catalog, "review");
  const hasReview = result.some((a) => a.kind === "review");
  if (policy.requireReview && !hasReview && reviewer !== undefined) {
    const reviewId = uniqueId("auto-review", usedIds);
    usedIds.add(reviewId);
    const implementIds = result.filter((a) => a.kind === "implement").map((a) => a.id);
    result.push({
      id: reviewId,
      agentId: reviewer.id,
      agentName: reviewer.name,
      adapter: reviewer.adapter,
      role: reviewer.role,
      kind: "review",
      instruction: [
        "Independently verify the delivery against the user goal and the acceptance criteria.",
        "Do not treat the implementer's report as evidence; inspect the changed files and test results yourself.",
        "The last line of your output must be exactly `VERDICT: PASS` or `VERDICT: FAIL`.",
      ].join("\n"),
      dependsOn: implementIds,
      skills: [],
      repairedFrom: "engine:role-chain",
    });
    warnings.push("The independent review was added to the chain by the engine.");
  }

  return { assignments: result, warnings };
}
