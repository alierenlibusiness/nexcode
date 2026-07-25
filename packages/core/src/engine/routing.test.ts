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

const policy = roundPolicyFor("balanced", "Bir özellik ekle", FALLBACK_CONFIG);
const fastPolicy = roundPolicyFor("fast", "typo düzelt", FALLBACK_CONFIG);

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
  return { instruction: "iş", dependsOn: [], skills: [], ...over };
}

describe("buildCatalog", () => {
  it("operatörü katalog dışında tutar — kendine görev veremez", () => {
    const catalog = buildCatalog({ config: FALLBACK_CONFIG });
    expect(catalog.some((a) => a.id === "ceo")).toBe(false);
    expect(catalog.map((a) => a.id).sort()).toEqual(["backend", "devops", "frontend", "qa", "security"]);
  });

  it("her agent'a bağlayıcı allowedKinds bildirir", () => {
    const catalog = buildCatalog({ config: FALLBACK_CONFIG });
    expect(catalog.find((a) => a.id === "backend")?.allowedKinds).toEqual(["implement"]);
    expect(catalog.find((a) => a.id === "security")?.allowedKinds).toEqual(["review"]);
  });

  it("kapalı, sağlıksız ve karantinaya alınmış agent'ları çıkarır", () => {
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

  it("yerleşik agent'ları keşfedilenlerden önce sıralar", () => {
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
  it("yapılandırılmış operatörü seçer", () => {
    expect(resolveOperatorId(FALLBACK_CONFIG)).toBe("ceo");
  });

  it("seçim geçersizse ilk etkin operatör rolüne düşer", () => {
    const config = normalizeConfig({ ...FALLBACK_CONFIG, operator: { ...FALLBACK_CONFIG.operator, agentId: "yok" } });
    expect(resolveOperatorId(config)).toBe("ceo");
  });

  it("operatör yoksa null döner", () => {
    const config = normalizeConfig({ ...FALLBACK_CONFIG, agents: {} });
    expect(resolveOperatorId(config)).toBeNull();
  });
});

describe("normalizeAssignments", () => {
  const catalog = [agent("plan1", "planner"), agent("exec1", "executor"), agent("rev1", "reviewer")];

  it("geçerli atamaları olduğu gibi geçirir", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "exec1", kind: "implement" })],
      catalog,
      policy,
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.agentId).toBe("exec1");
    expect(warnings).toEqual([]);
  });

  it("rolün alamayacağı işi doğru role taşır", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "plan1", kind: "implement" })],
      catalog,
      policy,
    );
    expect(assignments[0]?.agentId).toBe("exec1");
    expect(assignments[0]?.repairedFrom).toBe("plan1");
    expect(warnings[0]).toContain("implement işini alamaz");
  });

  it("katalogda olmayan agent'ı uygun agent'a yönlendirir", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "hayalet", kind: "review" })],
      catalog,
      policy,
    );
    expect(assignments[0]?.agentId).toBe("rev1");
    expect(warnings[0]).toContain("katalogda bulunamadı");
  });

  it("uygun agent hiç yoksa atamayı düşürür", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "x", kind: "review" })],
      [agent("exec1", "executor")],
      policy,
    );
    expect(assignments).toEqual([]);
    expect(warnings[0]).toContain("atlandı");
  });

  it("yinelenen kimlikleri benzersizleştirir", () => {
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

  it("çözümlenemeyen bağımlılıkları düşürür", () => {
    const { assignments, warnings } = normalizeAssignments(
      [assignment({ id: "a", agentId: "exec1", kind: "implement", dependsOn: ["yok", "a"] })],
      catalog,
      policy,
    );
    expect(assignments[0]?.dependsOn).toEqual([]);
    expect(warnings.some((w) => w.includes("çözümlenemeyen"))).toBe(true);
  });

  it("bağımlılık döngüsünü kırar", () => {
    const { assignments, warnings } = normalizeAssignments(
      [
        assignment({ id: "a", agentId: "exec1", kind: "implement", dependsOn: ["b"] }),
        assignment({ id: "b", agentId: "exec1", kind: "implement", dependsOn: ["a"] }),
      ],
      catalog,
      policy,
    );
    expect(warnings.some((w) => w.includes("döngüsü kırıldı"))).toBe(true);
    expect(parallelBatches(assignments).flat()).toHaveLength(2);
  });

  it("tur başına delegasyon tavanını uygular", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      assignment({ id: `a${String(i)}`, agentId: "exec1", kind: "implement" }),
    );
    const { assignments, warnings } = normalizeAssignments(many, catalog, policy);
    expect(assignments).toHaveLength(policy.maxDelegationsPerRound);
    expect(warnings.some((w) => w.includes("tavanı"))).toBe(true);
  });
});

describe("parallelBatches", () => {
  it("bağımsız işleri aynı gruba, bağımlıları sonraki gruba koyar", () => {
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

  it("operatörün atladığı planner ve reviewer'ı ilk turda zincire ekler", () => {
    const { assignments, warnings } = enforceRoleChain(normalized([["i", "exec1", "implement"]]), catalog, policy, 1);
    expect(assignments.map((a) => a.kind)).toEqual(["plan", "implement", "review"]);
    const plan = assignments[0];
    const impl = assignments[1];
    const review = assignments[2];
    expect(impl?.dependsOn).toContain(plan?.id);
    expect(review?.dependsOn).toContain(impl?.id);
    expect(warnings).toHaveLength(2);
  });

  it("hızlı modda küçük görevlere rol enjekte etmez", () => {
    const { assignments } = enforceRoleChain(normalized([["i", "exec1", "implement"]]), catalog, fastPolicy, 1);
    expect(assignments.map((a) => a.kind)).toEqual(["implement"]);
  });

  it("sonraki turlarda zincir kurmaz", () => {
    const { assignments } = enforceRoleChain(normalized([["i", "exec1", "implement"]]), catalog, policy, 2);
    expect(assignments.map((a) => a.kind)).toEqual(["implement"]);
  });

  it("uygulama içermeyen salt inceleme görevine rol enjekte etmez", () => {
    const { assignments } = enforceRoleChain(normalized([["r", "rev1", "review"]]), catalog, policy, 1);
    expect(assignments.map((a) => a.kind)).toEqual(["review"]);
  });

  it("operatör zinciri zaten kurduysa tekrar eklemez", () => {
    const existing = normalized([
      ["p", "plan1", "plan"],
      ["i", "exec1", "implement"],
      ["r", "rev1", "review"],
    ]);
    const { assignments, warnings } = enforceRoleChain(existing, catalog, policy, 1);
    expect(assignments).toHaveLength(3);
    expect(warnings).toEqual([]);
  });

  it("katalogda planner yoksa yalnızca inceleme eklenir", () => {
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
