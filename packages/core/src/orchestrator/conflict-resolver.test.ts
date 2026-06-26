import { describe, it, expect } from "vitest";
import {
  pathsOverlap,
  scopesOverlap,
  detectOverlaps,
  planConcurrencyBatches,
  classifyMergeResult,
  type ScopedTask,
} from "./conflict-resolver";

describe("pathsOverlap", () => {
  it("eşit yollar çakışır", () => {
    expect(pathsOverlap("api/users.ts", "api/users.ts")).toBe(true);
  });
  it("dizin ataları çakışır (containment)", () => {
    expect(pathsOverlap("api", "api/users.ts")).toBe(true);
    expect(pathsOverlap("api/users.ts", "api")).toBe(true);
  });
  it("kardeş yollar çakışmaz", () => {
    expect(pathsOverlap("api/users.ts", "api/posts.ts")).toBe(false);
  });
  it("yol ayıracı ve trailing slash normalize edilir", () => {
    expect(pathsOverlap("api\\users.ts", "api/users.ts")).toBe(true);
    expect(pathsOverlap("api/", "api/users.ts")).toBe(true);
  });
});

describe("scopesOverlap / detectOverlaps", () => {
  const t = (id: string, ...files: string[]): ScopedTask => ({ id, fileScope: files });

  it("ortak dosya kapsamı olan görevler örtüşür", () => {
    expect(scopesOverlap(t("1", "api/users.ts"), t("2", "api/users.ts", "x.ts"))).toBe(true);
  });

  it("örtüşen çiftleri listeler", () => {
    const tasks = [t("a", "api/users.ts"), t("b", "ui/page.tsx"), t("c", "api")];
    // a ⟷ c (api içerir), b kimseyle değil
    expect(detectOverlaps(tasks)).toEqual([{ a: "a", b: "c" }]);
  });
});

describe("planConcurrencyBatches (worktree paralelliği + serileştirme)", () => {
  const t = (id: string, ...files: string[]): ScopedTask => ({ id, fileScope: files });

  it("örtüşmeyen görevler tek batch'te paralel koşar", () => {
    const tasks = [t("a", "api/users.ts"), t("b", "ui/page.tsx")];
    expect(planConcurrencyBatches(tasks)).toEqual([["a", "b"]]);
  });

  it("örtüşen görevler ayrı batch'lere serileştirilir", () => {
    const tasks = [t("a", "api"), t("b", "api/users.ts"), t("c", "ui/page.tsx")];
    // a ile b örtüşür → b sonraki batch'e; c, a ile örtüşmediği için ilk batch'te
    expect(planConcurrencyBatches(tasks)).toEqual([["a", "c"], ["b"]]);
  });

  it("boş giriş boş plan", () => {
    expect(planConcurrencyBatches([])).toEqual([]);
  });
});

describe("classifyMergeResult (merge-anı insan kapısı)", () => {
  it("otomatik birleşebilir → merge", () => {
    expect(classifyMergeResult(true)).toBe("merge");
  });
  it("birleşemez → blocked (insan onayı)", () => {
    expect(classifyMergeResult(false)).toBe("blocked");
  });
});
