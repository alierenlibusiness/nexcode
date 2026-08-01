import { describe, expect, it } from "vitest";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { SkillRegistry, matchSkills, parseSkillFile, scoreSkill, type SkillDefinition } from "./registry";

function skill(over: Partial<SkillDefinition> & Pick<SkillDefinition, "name">): SkillDefinition {
  return { description: "", keywords: [], kinds: [], body: "", path: `skills/${over.name}.md`, ...over };
}

describe("parseSkillFile", () => {
  it("frontmatter alanlarını okur", () => {
    const parsed = parseSkillFile(
      "skills/unit-testing.md",
      ["---", "name: unit-testing", "description: Birim test yazımı", "keywords: test, vitest", "kinds: implement, review", "---", "", "# Unit Testing", "Gövde"].join("\n"),
    );
    expect(parsed.name).toBe("unit-testing");
    expect(parsed.description).toBe("Birim test yazımı");
    expect(parsed.keywords).toEqual(["test", "vitest"]);
    expect(parsed.kinds).toEqual(["implement", "review"]);
    expect(parsed.body).toContain("# Unit Testing");
  });

  it("frontmatter yoksa dosya adını ve ilk başlığı kullanır: dosya sessizce düşmez", () => {
    const parsed = parseSkillFile("skills/debugging.md", "# Hata Ayıklama\n\nAdımlar…");
    expect(parsed.name).toBe("debugging");
    expect(parsed.description).toBe("Hata Ayıklama");
  });

  it("geçersiz görev türlerini yok sayar", () => {
    const parsed = parseSkillFile("s.md", "---\nkinds: implement, deploy\n---\nx");
    expect(parsed.kinds).toEqual(["implement"]);
  });
});

describe("scoreSkill", () => {
  const testing = skill({
    name: "unit-testing",
    description: "Birim test yazımı ve kapsam",
    keywords: ["test", "vitest", "kapsam"],
  });

  it("ad eşleşmesini en güçlü sinyal sayar", () => {
    expect(scoreSkill(testing, "unit testing ekle")).toBeGreaterThan(scoreSkill(testing, "kapsam raporu"));
  });

  it("anahtar kelime eşleşmesini puanlar", () => {
    expect(scoreSkill(testing, "vitest ile doğrula")).toBeGreaterThan(0);
  });

  it("ilgisiz görevde sıfır döner", () => {
    expect(scoreSkill(testing, "logo rengini değiştir")).toBe(0);
  });

  it("görev türü kısıtına uymayan beceriyi hiç önermez", () => {
    const reviewOnly = skill({ name: "security-review", keywords: ["güvenlik"], kinds: ["review"] });
    expect(scoreSkill(reviewOnly, "güvenlik taraması", "review")).toBeGreaterThan(0);
    expect(scoreSkill(reviewOnly, "güvenlik taraması", "implement")).toBe(0);
  });

  it("türü kısıtlanmamış beceri her türde kullanılabilir", () => {
    expect(scoreSkill(testing, "test yaz", "implement")).toBeGreaterThan(0);
    expect(scoreSkill(testing, "test yaz", "review")).toBeGreaterThan(0);
  });
});

describe("matchSkills", () => {
  const catalog = [
    skill({ name: "unit-testing", description: "Birim test yazımı", keywords: ["test", "vitest"] }),
    skill({ name: "api-design", description: "REST sözleşmesi tasarımı", keywords: ["api", "rest", "endpoint"] }),
    skill({ name: "seo-on-page", description: "Sayfa içi SEO", keywords: ["seo", "meta"] }),
  ];

  it("yalnızca ilgili becerileri döndürür", () => {
    const hints = matchSkills(catalog, "REST endpoint ekle", { limit: 12, charBudget: 2400 });
    expect(hints.map((h) => h.name)).toEqual(["api-design"]);
  });

  it("skorlarına göre sıralar ve limiti uygular", () => {
    const hints = matchSkills(catalog, "api endpoint için test yaz", { limit: 1, charBudget: 2400 });
    expect(hints).toHaveLength(1);
  });

  it("hiç uygun beceri yoksa boş liste verir", () => {
    expect(matchSkills(catalog, "kahve yap", { limit: 12, charBudget: 2400 })).toEqual([]);
  });

  it("açıklamaları karakter bütçesine sığdırır", () => {
    const long = skill({
      name: "api-design",
      description: "a".repeat(500),
      keywords: ["api"],
    });
    const hints = matchSkills([long], "api tasarla", { limit: 12, charBudget: 50 });
    expect(hints[0]?.summary.length).toBeLessThanOrEqual(51);
    expect(hints[0]?.summary.endsWith("…")).toBe(true);
  });

  it("rehber dosyasının yolunu taşır: uzman gerekirse okur", () => {
    const hints = matchSkills(catalog, "endpoint", { limit: 12, charBudget: 2400 });
    expect(hints[0]?.referencePath).toBe("skills/api-design.md");
  });
});

describe("SkillRegistry", () => {
  const files = [
    { path: "skills/unit-testing.md", raw: "---\nname: unit-testing\nkeywords: test\n---\nGövde" },
    { path: "skills/api-design.md", raw: "---\nname: api-design\nkeywords: api, endpoint\n---\nGövde" },
  ];

  function registry(config: NexcodeConfig) {
    return new SkillRegistry({ listSkillFiles: () => Promise.resolve(files) }, () => config);
  }

  it("etkin liste boşken tüm katalog etkindir (ilk kurulum)", async () => {
    const reg = registry(FALLBACK_CONFIG);
    await reg.load();
    expect(reg.enabled()).toHaveLength(2);
    expect(reg.allNames()).toEqual(["api-design", "unit-testing"]);
  });

  it("yalnızca etkin listedeki becerileri tarar", async () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      skills: { ...FALLBACK_CONFIG.skills, enabled: ["api-design"] },
    });
    const reg = registry(config);
    await reg.load();
    expect(reg.enabled().map((s) => s.name)).toEqual(["api-design"]);
  });

  it("autoMatch kapalıyken hiç beceri önermez", async () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      skills: { ...FALLBACK_CONFIG.skills, autoMatch: false },
    });
    expect(await registry(config).match("endpoint ekle", "implement")).toEqual([]);
  });

  it("ilk çağrıda kendini yükler", async () => {
    const hints = await registry(FALLBACK_CONFIG).match("endpoint ekle", "implement");
    expect(hints.map((h) => h.name)).toEqual(["api-design"]);
  });

  it("beceriyi adıyla bulur", async () => {
    const reg = registry(FALLBACK_CONFIG);
    await reg.load();
    expect(reg.byName("unit-testing")?.path).toBe("skills/unit-testing.md");
    expect(reg.byName("yok")).toBeUndefined();
  });
});
