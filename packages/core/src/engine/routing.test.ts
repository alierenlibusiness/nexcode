import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { roundPolicyFor } from "./rounds";
import {
  buildCatalog,
  enforceRoleChain,
  normalizeAssignments,
  parallelBatches,
  resolveOperatorId,
  type CatalogAgent,
  type NormalizedAssignment,
} from "./routing";
import type { OperatorAssignment } from "./protocol";

const policy = roundPolicyFor("balanced", "Add a feature", FALLBACK_CONFIG);
const fastPolicy = roundPolicyFor("fast", "fix a typo", FALLBACK_CONFIG);

function agent(id: string, role: CatalogAgent["role"]): CatalogAgent {
  const allowed = { operator: [], planner: ["plan", "research"], executor: ["implement"], reviewer: ["review"] } as const;
  return {
    id,
    name: id.toUpperCase(),
    role,
    domain: undefined,
    adapter: undefined,
    allowedKinds: allowed[role],
    healthy: true,
  };
}

function assignment(over: Partial<OperatorAssignment> & Pick<OperatorAssignment, "id" | "agentId" | "kind">): OperatorAssignment {
  return { instruction: "work", dependsOn: [], skills: [], ...over };
}

describe("buildCatalog", () => {
  it("keeps the operator out of the catalog: it cannot assign work to itself", () => {
    const catalog = buildCatalog({ config: FALLBACK_CONFIG });
    expect(catalog.some((a) => a.id === "ceo")).toBe(false);
    expect(catalog.map((a) => a.id).sort()).toEqual(["backend", "devops", "frontend", "qa", "security"]);
  });

  it("reports binding allowedKinds for every agent", () => {
    const catalog = buildCatalog({ config: FALLBACK_CONFIG });
    expect(catalog.find((a) => a.id === "backend")?.allowedKinds).toEqual(["implement"]);
    expect(catalog.find((a) => a.id === "security")?.allowedKinds).toEqual(["review"]);
  });

  it("removes disabled, unhealthy and quarantined agents", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      agents: { ...FALLBACK_CONFIG.agents, devops: { ...FALLBACK_CONFIG.agents.devops, enabled: false } },
    });
    const catalog = buildCatalog({
      config,
      health: { frontend: false },
      quarantined: new Set(["qa"]),
    });
    const ids = catalog.map((a) => a.id);
    expect(ids).not.toContain("devops");
    expect(ids).not.toContain("frontend");
    expect(ids).not.toContain("qa");
    expect(ids).toContain("backend");
  });

  it("orders built-in agents before discovered ones", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      agents: {
        ...FALLBACK_CONFIG.agents,
        "codex-cli": { id: "codex-cli", name: "Codex", role: "executor", discovered: true, cmd: "codex" },
      },
    });
    const catalog = buildCatalog({ config });
    expect(catalog[catalog.length - 1]?.id).toBe("codex-cli");
  });
});

describe("resolveOperatorId", () => {
  it("selects the configured operator", () => {
    expect(resolveOperatorId(FALLBACK_CONFIG)).toBe("ceo");
  });

  it("falls back to the first enabled operator role when the choice is invalid", () => {
    const config = normalizeConfig({ ...FALLBACK_CONFIG, operator: { ...FALLBACK_CONFIG.operator, agentId: "missing" } });
    expect(resolveOperatorId(config)).toBe("ceo");
  });

  it("returns null when there is no operator", () => {
    const config = normalizeConfig({ ...FALLBACK_CONFIG, agents: {} });
    expect(resolveOperatorId(config)).toBeNull();
  });
});

describe("normalizeAssignments", () => {
  const catalog = [agent("plan1", "planner"), agent("exec1", "executor"), agent("rev1", "reviewer")];

  it("passes valid assignments through unchanged", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "exec1", kind: "implement" })],
      catalog,
      policy,
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.agentId).toBe("exec1");
    expect(warnings).toEqual([]);
  });

  it("moves work the role cannot take to the right role", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "plan1", kind: "implement" })],
      catalog,
      policy,
    );
    expect(assignments[0]?.agentId).toBe("exec1");
    expect(assignments[0]?.repairedFrom).toBe("plan1");
    expect(warnings[0]).toContain("cannot take implement work");
  });

  it("routes an agent that is not in the catalog to a suitable agent", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "ghost", kind: "review" })],
      catalog,
      policy,
    );
    expect(assignments[0]?.agentId).toBe("rev1");
    expect(warnings[0]).toContain("was not found in the catalog");
  });

  it("drops the assignment when no suitable agent exists", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "x", kind: "review" })],
      [agent("exec1", "executor")],
      policy,
    );
    expect(assignments).toEqual([]);
    expect(warnings[0]).toContain("was skipped");
  });

  it("makes duplicate identifiers unique", () => {
    const { assignments } = normalizeAssignments(
      [
        assignment({ id: "dup", agentId: "exec1", kind: "implement" }),
        assignment({ id: "dup", agentId: "exec1", kind: "implement" }),
      ],
      catalog,
      policy,
    );
    expect(assignments.map((a) => a.id)).toEqual(["dup", "dup-2"]);
  });

  it("drops unresolvable dependencies", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "exec1", kind: "implement", dependsOn: ["missing", "a"] })],
      catalog,
      policy,
    );
    expect(assignments[0]?.dependsOn).toEqual([]);
    expect(warnings.some((w) => w.includes("Unresolvable dependencies"))).toBe(true);
  });

  it("breaks a dependency cycle", () => {
    const { assignments, warnings } = normalizeAssignments(
      [
        assignment({ id: "a", agentId: "exec1", kind: "implement", dependsOn: ["b"] }),
        assignment({ id: "b", agentId: "exec1", kind: "implement", dependsOn: ["a"] }),
      ],
      catalog,
      policy,
    );
    expect(warnings.some((w) => w.includes("dependency cycle was broken"))).toBe(true);
    expect(parallelBatches(assignments).flat()).toHaveLength(2);
  });

  it("applies the per-round delegation cap", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      assignment({ id: `a${String(i)}`, agentId: "exec1", kind: "implement" }),
    );
    const { assignments, warnings } = normalizeAssignments(many, catalog, policy);
    expect(assignments).toHaveLength(policy.maxDelegationsPerRound);
    expect(warnings.some((w) => w.includes("delegation cap"))).toBe(true);
  });
});

describe("parallelBatches", () => {
  it("puts independent work in the same group and dependents in the next", () => {
    const items: NormalizedAssignment[] = [
      { ...assignment({ id: "p", agentId: "plan1", kind: "plan" }), role: "planner", agentName: "P", adapter: undefined },
      {
        ...assignment({ id: "i1", agentId: "exec1", kind: "implement", dependsOn: ["p"] }),
        role: "executor",
        agentName: "E",
        adapter: undefined,
      },
      {
        ...assignment({ id: "i2", agentId: "exec1", kind: "implement", dependsOn: ["p"] }),
        role: "executor",
        agentName: "E",
        adapter: undefined,
      },
      {
        ...assignment({ id: "r", agentId: "rev1", kind: "review", dependsOn: ["i1", "i2"] }),
        role: "reviewer",
        agentName: "R",
        adapter: undefined,
      },
    ];
    const batches = parallelBatches(items);
    expect(batches.map((b) => b.map((a) => a.id))).toEqual([["p"], ["i1", "i2"], ["r"]]);
  });
});

describe("enforceRoleChain", () => {
  const catalog = [agent("plan1", "planner"), agent("exec1", "executor"), agent("rev1", "reviewer")];

  function normalized(kinds: ReadonlyArray<[string, string, NormalizedAssignment["kind"]]>): NormalizedAssignment[] {
    return normalizeAssignments(
      kinds.map(([id, agentId, kind]) => assignment({ id, agentId, kind })),
      catalog,
      policy,
    ).assignments;
  }

  it("adds the planner and reviewer the operator skipped to the first round chain", () => {
    const { assignments, warnings } = enforceRoleChain(normalized([["i", "exec1", "implement"]]), catalog, policy, 1);
    expect(assignments.map((a) => a.kind)).toEqual(["plan", "implement", "review"]);
    const plan = assignments[0];
    const impl = assignments[1];
    const review = assignments[2];
    expect(impl?.dependsOn).toContain(plan?.id);
    expect(review?.dependsOn).toContain(impl?.id);
    expect(warnings).toHaveLength(2);
  });

  it("injects no role into small tasks in fast mode", () => {
    const { assignments } = enforceRoleChain(normalized([["i", "exec1", "implement"]]), catalog, fastPolicy, 1);
    expect(assignments.map((a) => a.kind)).toEqual(["implement"]);
  });

  it("does not build the chain in later rounds", () => {
    const { assignments } = enforceRoleChain(normalized([["i", "exec1", "implement"]]), catalog, policy, 2);
    expect(assignments.map((a) => a.kind)).toEqual(["implement"]);
  });

  it("injects no role into a review-only task with no implementation", () => {
    const { assignments } = enforceRoleChain(normalized([["r", "rev1", "review"]]), catalog, policy, 1);
    expect(assignments.map((a) => a.kind)).toEqual(["review"]);
  });

  it("adds nothing when the operator already built the chain", () => {
    const existing = normalized([
      ["p", "plan1", "plan"],
      ["i", "exec1", "implement"],
      ["r", "rev1", "review"],
    ]);
    const { assignments, warnings } = enforceRoleChain(existing, catalog, policy, 1);
    expect(assignments).toHaveLength(3);
    expect(warnings).toEqual([]);
  });

  it("adds only the review when the catalog has no planner", () => {
    const limited = [agent("exec1", "executor"), agent("rev1", "reviewer")];
    const base = normalizeAssignments(
      [assignment({ id: "i", agentId: "exec1", kind: "implement" })],
      limited,
      policy,
    ).assignments;
    const { assignments } = enforceRoleChain(base, limited, policy, 1);
    expect(assignments.map((a) => a.kind)).toEqual(["implement", "review"]);
  });
});
