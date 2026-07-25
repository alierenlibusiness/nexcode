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
 * Operatöre sunulan agent kataloğu ve atama yönlendirmesi.
 *
 * Rol seçimi yalnızca prompt metni değil, **izin verilen görev türüdür**. Operatör yanlış
 * eşleme üretse bile motor atamayı uygun role taşır; profildeki eski capability değerleri
 * bu sınırı genişletemez.
 */

export interface CatalogAgent {
  id: string;
  name: string;
  role: OrchestrationRole;
  domain: string | undefined;
  adapter: CliAdapter | undefined;
  /** Operatöre bildirilen bağlayıcı sözleşme. */
  allowedKinds: readonly AssignmentKind[];
  healthy: boolean;
}

export interface CatalogInput {
  config: NexcodeConfig;
  /** Sağlık kontrolü sonucu; kayıt yoksa agent sağlıklı sayılır (API-only agent'lar gibi). */
  health?: Readonly<Record<string, boolean>>;
  /** Oturum boyunca karantinaya alınmış agent id'leri. */
  quarantined?: ReadonlySet<string>;
}

/**
 * Operatörün görebileceği agent kataloğu. Operatörün kendisi katalogda yer almaz —
 * kendine görev veremez.
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

/** Operatör olarak çalışacak agent — açık seçim yoksa ilk etkin `operator` rolü. */
export function resolveOperatorId(config: NexcodeConfig): string | null {
  const explicit = config.operator.agentId;
  const chosen = explicit === "" ? undefined : config.agents[explicit];
  if (chosen?.enabled === true && chosen.role === "operator") return chosen.id;
  return stableProfiles(config).find((profile) => profile.enabled && profile.role === "operator")?.id ?? null;
}

/** Yerleşik alan agent'ları önce, keşfedilenler sonra — kararlı ve öngörülebilir sıra. */
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
  /** Motor tarafından değiştirildiyse nedeni (şeffaflık için loglanır). */
  repairedFrom?: string;
}

export interface NormalizeResult {
  assignments: NormalizedAssignment[];
  /** Kullanıcıya ve loga yansıyan onarım/düşürme notları. */
  warnings: string[];
}

/**
 * Operatörün ürettiği ham atamaları yürütülebilir hale getirir:
 * - Bilinmeyen/kapalı/sağlıksız agent'a verilen iş uygun bir agent'a taşınır.
 * - Rolün izin vermediği görev türü doğru role yönlendirilir.
 * - Yinelenen kimlikler benzersizleştirilir.
 * - Var olmayan `dependsOn` referansları düşürülür, döngüler kırılır.
 * - Tur başına delegasyon tavanı uygulanır.
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
          `"${assignment.id}" atlandı: "${assignment.agentId}" katalogda yok ve ${assignment.kind} işini alabilecek uygun agent bulunamadı.`,
        );
        continue;
      }
      repairedFrom = assignment.agentId;
      warnings.push(`"${assignment.id}" → ${replacement.name}: "${assignment.agentId}" katalogda bulunamadı.`);
      agent = replacement;
    }

    if (!ALLOWED_KINDS[agent.role].includes(assignment.kind)) {
      const replacement = pickAgentForKind(catalog, assignment.kind);
      if (replacement === undefined) {
        warnings.push(
          `"${assignment.id}" atlandı: ${assignment.kind} işini alabilecek ${roleForKind(assignment.kind)} rolünde agent yok.`,
        );
        continue;
      }
      repairedFrom = agent.id;
      warnings.push(
        `"${assignment.id}" → ${replacement.name}: ${agent.name} (${agent.role}) ${assignment.kind} işini alamaz.`,
      );
      agent = replacement;
    }

    const id = uniqueId(assignment.id, usedIds);
    if (id !== assignment.id) {
      warnings.push(`"${assignment.id}" kimliği yinelendiği için "${id}" olarak değiştirildi.`);
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
      `Tur başına delegasyon tavanı (${String(policy.maxDelegationsPerRound)}) aşıldı; fazlası bir sonraki tura bırakıldı.`,
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

/** Var olmayan bağımlılıkları düşürür ve döngüleri kırar. */
function pruneDependencies(assignments: NormalizedAssignment[], warnings: string[]): NormalizedAssignment[] {
  const ids = new Set(assignments.map((a) => a.id));
  const cleaned = assignments.map((assignment) => {
    const kept = assignment.dependsOn.filter((dep) => dep !== assignment.id && ids.has(dep));
    if (kept.length !== assignment.dependsOn.length) {
      warnings.push(`"${assignment.id}" için çözümlenemeyen bağımlılıklar düşürüldü.`);
    }
    return { ...assignment, dependsOn: kept };
  });

  const cycle = findCycle(cleaned);
  if (cycle === null) return cleaned;

  warnings.push(`Bağımlılık döngüsü kırıldı: ${cycle.join(" → ")}.`);
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
 * Bağımlılıkları koruyarak paralel çalıştırılabilir gruplar üretir (Kahn).
 * Aynı gruptaki işler eşzamanlı yürütülebilir — paralel varsayılan, sıralı istisnadır.
 */
export function parallelBatches(assignments: readonly NormalizedAssignment[]): NormalizedAssignment[][] {
  const remaining = new Map(assignments.map((a) => [a.id, a]));
  const settled = new Set<string>();
  const batches: NormalizedAssignment[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((a) => a.dependsOn.every((dep) => settled.has(dep)));
    if (ready.length === 0) {
      // Savunma katmanı: pruneDependencies sonrası buraya düşülmemeli.
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
 * İlk turda hazır rol zincirini garanti eder.
 *
 * Dengeli veya derin modda katalogda planner, executor ve reviewer varsa üçü de İLK planda
 * kullanılır ve `plan → implement → review` olarak `dependsOn` ile zincirlenir. Operatörün
 * atladığı planner veya reviewer motor tarafından eklenir — hız optimizasyonu, kullanıcının
 * etkinleştirdiği rolleri devre dışı bırakamaz.
 *
 * Plan/uygulama içermeyen araştırma ve salt inceleme görevlerine rol enjekte edilmez.
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

  // 1) Planlama — katalogda planner varsa ve operatör açmadıysa zincire eklenir.
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
        "Aşağıdaki uygulama işleri için salt okunur, uygulanabilir bir plan ve kabul kriterleri üret.",
        "Dosya adı, fonksiyon veya komut yazmadan önce projede gerçekten var olduklarını doğrula.",
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
    warnings.push("Planlama adımı motor tarafından zincire eklendi (hazır planner rolü atlanmıştı).");
  }

  // 2) Bağımsız inceleme — uygulama teslimatını denetler.
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
        "Teslimatı kullanıcı hedefi ve kabul kriterlerine karşı bağımsız olarak doğrula.",
        "Uygulayıcının raporunu kanıt sayma; değişen dosyaları ve test sonuçlarını kendin incele.",
        "Çıktının son satırı tam olarak `VERDICT: PASS` veya `VERDICT: FAIL` olmalıdır.",
      ].join("\n"),
      dependsOn: implementIds,
      skills: [],
      repairedFrom: "engine:role-chain",
    });
    warnings.push("Bağımsız inceleme motor tarafından zincire eklendi.");
  }

  return { assignments: result, warnings };
}
