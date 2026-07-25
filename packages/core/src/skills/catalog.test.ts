import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSIGNMENT_KINDS } from "../config/schema";
import { matchSkills, parseSkillFile } from "./registry";

/**
 * Paketle gelen beceri kataloğunun sözleşmesi. Bir beceri dosyası bozulursa operatörün
 * gördüğü envanter sessizce eksilir — bu test o sessiz kaybı engeller.
 */
const SKILLS_DIR = join(__dirname, "..", "..", "..", "..", "resources", "skills");

const files = readdirSync(SKILLS_DIR).filter((file) => file.endsWith(".md"));
const skills = files.map((file) => parseSkillFile(`skills/${file}`, readFileSync(join(SKILLS_DIR, file), "utf8")));

describe("beceri kataloğu", () => {
  it("anlamlı büyüklükte bir katalog gelir", () => {
    expect(files.length).toBeGreaterThanOrEqual(50);
  });

  it("her beceri ad, açıklama ve anahtar kelime taşır", () => {
    for (const skill of skills) {
      expect(skill.name, `${skill.path} adı`).not.toBe("");
      expect(skill.description.length, `${skill.path} açıklaması`).toBeGreaterThan(10);
      expect(skill.keywords.length, `${skill.path} anahtar kelimeleri`).toBeGreaterThan(0);
    }
  });

  it("dosya adı ile beceri adı eşleşir", () => {
    for (const skill of skills) {
      expect(`skills/${skill.name}.md`).toBe(skill.path);
    }
  });

  it("beceri adları benzersizdir", () => {
    const names = skills.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("bildirilen görev türleri geçerlidir", () => {
    for (const skill of skills) {
      for (const kind of skill.kinds) {
        expect(ASSIGNMENT_KINDS, `${skill.path}`).toContain(kind);
      }
    }
  });

  it("her beceri kontrol listesi ve doğrulama bölümü içerir", () => {
    for (const skill of skills) {
      expect(skill.body, `${skill.path}`).toContain("## Checklist");
      expect(skill.body, `${skill.path}`).toContain("## Verification");
    }
  });

  it("gerçek görev metinleri ilgili becerileri getirir", () => {
    const cases: Array<[string, string]> = [
      ["Add a REST endpoint for avatar upload", "api-design"],
      ["Write unit tests for the parser", "unit-testing"],
      ["Review this diff for security vulnerabilities", "security-review"],
      ["The login page has an accessibility problem", "accessibility-audit"],
      ["Add a database migration for the new column", "database-migration"],
      ["Set up the CI pipeline", "ci-pipeline-design"],
    ];

    for (const [text, expected] of cases) {
      const hints = matchSkills(skills, text, { limit: 12, charBudget: 2400 });
      expect(hints.map((hint) => hint.name), text).toContain(expected);
    }
  });

  it("ilgisiz görevde beceri önermez", () => {
    expect(matchSkills(skills, "zzzz qqqq wwww", { limit: 12, charBudget: 2400 })).toEqual([]);
  });

  it("kısa liste katalog limitini aşmaz", () => {
    const hints = matchSkills(skills, "test api security design database review", { limit: 12, charBudget: 2400 });
    expect(hints.length).toBeLessThanOrEqual(12);
  });
});
