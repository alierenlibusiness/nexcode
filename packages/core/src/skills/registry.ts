import type { AssignmentKind, NexcodeConfig } from "../config/schema";
import type { SkillHint } from "../engine/prompt";

/**
 * Beceri kayıt defteri.
 *
 * Beceriler kullanıcının koyduğu **proje standardıdır** ve teslimat kalitesini yükseltir.
 * Operatör tüm katalog yerine göreve göre skorlanmış kısa liste görür; uzman tam rehberi
 * ancak gerekirse dosyadan okur. Böylece envanter büyüdükçe prompt maliyeti artmaz.
 */

export interface SkillDefinition {
  name: string;
  description: string;
  keywords: readonly string[];
  /** Bu beceriyi hangi görev türleri kullanabilir; boş = hepsi. */
  kinds: readonly AssignmentKind[];
  /** Tam rehber metni (uzman gerekirse dosyadan okur). */
  body: string;
  /** Rehberin diskteki yolu. */
  path: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * `---` blokuyla başlayan beceri dosyasını ayrıştırır. Frontmatter yoksa dosya adı ad,
 * ilk başlık ya da ilk satır açıklama olarak kullanılır — hiçbir dosya sessizce düşmez.
 */
export function parseSkillFile(path: string, raw: string): SkillDefinition {
  const fallbackName = path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.md$/i, "") ?? "skill";

  const match = FRONTMATTER.exec(raw);
  const body = match === null ? raw : raw.slice(match[0].length);

  const fields = new Map<string, string>();
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    fields.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }

  const description =
    fields.get("description") ??
    body
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find((line) => line !== "") ??
    fallbackName;

  return {
    name: fields.get("name") ?? fallbackName,
    description,
    keywords: splitList(fields.get("keywords")),
    kinds: splitList(fields.get("kinds")).filter(isAssignmentKind),
    body: body.trim(),
    path,
  };
}

function splitList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
}

function isAssignmentKind(value: string): value is AssignmentKind {
  return value === "plan" || value === "implement" || value === "review" || value === "research";
}

/** Eşleştirme için metni normalize eder (Türkçe karakterler dahil). */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase("tr")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((token) => token.length > 2),
  );
}

/**
 * Bir becerinin göreve uygunluk skoru.
 *
 * Ad eşleşmesi en güçlü sinyaldir; anahtar kelimeler onu takip eder; açıklama en zayıfıdır.
 * Görev türü kısıtı varsa ve uyuşmuyorsa beceri hiç önerilmez.
 */
export function scoreSkill(skill: SkillDefinition, text: string, kind?: AssignmentKind): number {
  if (kind !== undefined && skill.kinds.length > 0 && !skill.kinds.includes(kind)) return 0;

  const tokens = tokenize(text);
  if (tokens.size === 0) return 0;

  let score = 0;
  for (const part of skill.name.split(/[-_\s]+/)) {
    if (part.length > 2 && tokens.has(part.toLocaleLowerCase("tr"))) score += 5;
  }
  for (const keyword of skill.keywords) {
    if (tokens.has(keyword)) score += 3;
    else if (keyword.includes(" ") && text.toLocaleLowerCase("tr").includes(keyword)) score += 3;
  }
  for (const token of tokenize(skill.description)) {
    if (tokens.has(token)) score += 1;
  }
  return score;
}

export interface MatchOptions {
  kind?: AssignmentKind;
  limit: number;
  /** Kısa liste açıklamalarının karakter bütçesi. */
  charBudget: number;
}

/** Göreve uygun beceri kısa listesi — skoru sıfır olanlar hiç önerilmez. */
export function matchSkills(
  skills: readonly SkillDefinition[],
  text: string,
  options: MatchOptions,
): SkillHint[] {
  const scored = skills
    .map((skill) => ({ skill, score: scoreSkill(skill, text, options.kind) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, options.limit);

  const perSkill = scored.length === 0 ? 0 : Math.floor(options.charBudget / scored.length);
  return scored.map(({ skill }) => ({
    name: skill.name,
    summary: skill.description.length > perSkill ? `${skill.description.slice(0, perSkill)}…` : skill.description,
    referencePath: skill.path,
  }));
}

export interface SkillSource {
  /** Beceri dizinindeki `.md` dosyalarını `{ path, raw }` olarak döner. */
  listSkillFiles: () => Promise<Array<{ path: string; raw: string }>>;
}

/**
 * Diskteki becerileri yükler ve config'in `enabled` listesine göre süzer.
 * Yalnızca etkin beceriler taranır; liste boşsa tüm katalog etkin sayılır (ilk kurulum).
 */
export class SkillRegistry {
  private skills: SkillDefinition[] = [];
  private loaded = false;

  constructor(
    private readonly source: SkillSource,
    private readonly config: () => NexcodeConfig,
  ) {}

  async load(): Promise<void> {
    const files = await this.source.listSkillFiles();
    this.skills = files.map((file) => parseSkillFile(file.path, file.raw));
    this.loaded = true;
  }

  /** Paketle gelen tüm beceri adları — ilk kurulumda `skills.enabled` bunlarla doldurulur. */
  allNames(): string[] {
    return this.skills.map((skill) => skill.name).sort();
  }

  enabled(): SkillDefinition[] {
    const { enabled } = this.config().skills;
    if (enabled.length === 0) return this.skills;
    const allowed = new Set(enabled);
    return this.skills.filter((skill) => allowed.has(skill.name));
  }

  byName(name: string): SkillDefinition | undefined {
    return this.skills.find((skill) => skill.name === name);
  }

  /** Motorun `matchSkills` bağımlılığına takılan yüzey. */
  async match(text: string, kind: AssignmentKind): Promise<SkillHint[]> {
    if (!this.loaded) await this.load();
    const config = this.config();
    if (!config.skills.autoMatch) return [];
    return matchSkills(this.enabled(), text, {
      kind,
      limit: config.skills.catalogLimit,
      charBudget: config.skills.charBudget,
    });
  }
}
