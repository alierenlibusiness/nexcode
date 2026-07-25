import { describe, expect, it } from "vitest";
import { FALLBACK_CONFIG } from "../config/defaults";
import { buildOperatorPrompt, buildWorkerPrompt, digestTaskPrompt, trimFromEnd, trimFromStart } from "./prompt";
import { roundPolicyFor } from "./rounds";
import { buildCatalog } from "./routing";

describe("trimFromEnd / trimFromStart", () => {
  it("bütçe içindeki metne dokunmaz", () => {
    expect(trimFromEnd("kısa", 100)).toBe("kısa");
    expect(trimFromStart("kısa", 100)).toBe("kısa");
  });

  it("kesmeyi görünür biçimde bildirir — sessizce kırpmaz", () => {
    const long = "x".repeat(500);
    expect(trimFromEnd(long, 100)).toContain("karakter kırpıldı");
    expect(trimFromStart(long, 100)).toContain("karakter kırpıldı");
  });

  it("sondan kırpma en yeni içeriği korur", () => {
    expect(trimFromEnd("eskiYENI", 4)).toContain("YENI");
  });

  it("baştan kırpma en eski içeriği korur", () => {
    expect(trimFromStart("ESKIyeni", 4)).toContain("ESKI");
  });

  it("sıfır bütçede boş döner", () => {
    expect(trimFromEnd("x", 0)).toBe("");
  });
});

describe("digestTaskPrompt", () => {
  it("bütçe içindeki görev metnini olduğu gibi bırakır", () => {
    const digest = digestTaskPrompt("t1", "Kısa görev", 6000);
    expect(digest.text).toBe("Kısa görev");
    expect(digest.spill).toBeNull();
  });

  it("büyük metni dosyaya taşır ve baş+son özetini gömer", () => {
    const prompt = `BAŞLANGIÇ${"a".repeat(9000)}BİTİŞ`;
    const digest = digestTaskPrompt("task-42", prompt, 2000);

    expect(digest.spill).not.toBeNull();
    expect(digest.spill?.relativePath).toBe(".nexcode/TASK-task-42.md");
    expect(digest.spill?.content).toBe(prompt);

    expect(digest.text).toContain("BAŞLANGIÇ");
    expect(digest.text).toContain("BİTİŞ");
    expect(digest.text).toContain(".nexcode/TASK-task-42.md");
    expect(digest.text).toContain("OKU");
    // Gömülen özet, tam metinden belirgin biçimde küçüktür.
    expect(digest.text.length).toBeLessThan(prompt.length / 2);
  });
});

describe("buildOperatorPrompt", () => {
  const catalog = buildCatalog({ config: FALLBACK_CONFIG });
  const policy = roundPolicyFor("balanced", "özellik ekle", FALLBACK_CONFIG);

  const base = {
    roleText: "# Rol: Takım Operatörü",
    goal: "Avatar yükleme ekle",
    policy,
    round: 1,
    catalog,
    skills: [],
    projectContext: "",
    teamState: "",
  } as const;

  it("evreye özgü JSON şemasını dayatır", () => {
    const planPrompt = buildOperatorPrompt({ ...base, phase: "plan" });
    expect(planPrompt).toContain('"status":"plan"');
    expect(planPrompt).toContain("HİÇBİR ŞEY üretme");

    const evalPrompt = buildOperatorPrompt({ ...base, phase: "evaluate" });
    expect(evalPrompt).toContain('"status":"continue"');
  });

  it("katalogdaki her agent'ın alabileceği iş türünü bildirir", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "plan" });
    expect(prompt).toContain("backend");
    expect(prompt).toContain("alabileceği iş: implement");
    expect(prompt).toContain("alabileceği iş: review");
    // Operatörün kendisi katalogda değildir.
    expect(prompt).not.toContain("- ceo —");
  });

  it("tur ve mod bütçesini görünür kılar", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "plan", round: 2 });
    expect(prompt).toContain("Tur: 2 / 3");
    expect(prompt).toContain("Çalışma modu: balanced");
    expect(prompt).toContain("bağımsız incelemeden geçmelidir");
  });

  it("beceri envanterini otoriter kaynak olarak işaretler", () => {
    const prompt = buildOperatorPrompt({
      ...base,
      phase: "plan",
      skills: [{ name: "unit-testing", summary: "Birim test yazımı", referencePath: "skills/unit-testing.md" }],
    });
    expect(prompt).toContain("OTORİTER kaynak");
    expect(prompt).toContain("unit-testing");
  });

  it("boş katalogda sonuç uydurmamayı söyler", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "plan", catalog: [] });
    expect(prompt).toContain("Sonuç uydurma");
  });

  it("önceki tur durumunu context bütçesiyle sınırlar", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "evaluate", teamState: "y".repeat(100_000) });
    expect(prompt).toContain("karakter kırpıldı");
    expect(prompt.length).toBeLessThan(100_000);
  });

  it("protokol düzeltmesini prompt'a ekler", () => {
    const prompt = buildOperatorPrompt({ ...base, phase: "plan", repairInstruction: "Sadece JSON üret." });
    expect(prompt).toContain("PROTOKOL DÜZELTMESİ");
  });
});

describe("buildWorkerPrompt", () => {
  const assignment = {
    id: "i1",
    agentId: "backend",
    kind: "implement" as const,
    instruction: "POST /avatar endpoint'i ekle",
    dependsOn: ["p1"],
    skills: [],
    role: "executor" as const,
    agentName: "Backend",
    adapter: undefined,
  };

  const base = {
    roleText: "# Rol: Uygulayıcı",
    assignment,
    goal: "Avatar yükleme ekle",
    upstream: [],
    skills: [],
    projectContext: "",
    workingDir: "C:/proje",
    sandboxed: true,
    contextCharBudget: 5000,
  };

  it("ana hedefi ve devredilen işi ayrı ayrı verir", () => {
    const prompt = buildWorkerPrompt(base);
    expect(prompt).toContain("ANA HEDEF");
    expect(prompt).toContain("Avatar yükleme ekle");
    expect(prompt).toContain("POST /avatar");
  });

  it("önceki adımların çıktısını aktarır", () => {
    const prompt = buildWorkerPrompt({
      ...base,
      upstream: [{ id: "p1", kind: "plan", output: "1. Şemayı güncelle" }],
    });
    expect(prompt).toContain("p1 (plan)");
    expect(prompt).toContain("Şemayı güncelle");
  });

  it("sandbox açıkken yazma sınırını açıkça bildirir", () => {
    expect(buildWorkerPrompt(base)).toContain("DIŞINA yazma");
    expect(buildWorkerPrompt({ ...base, sandboxed: false })).not.toContain("DIŞINA yazma");
  });

  it("beceri rehberinin dosya yolunu verir", () => {
    const prompt = buildWorkerPrompt({
      ...base,
      skills: [{ name: "api-design", summary: "REST sözleşmesi", referencePath: "skills/api-design.md" }],
    });
    expect(prompt).toContain("Tam rehber: skills/api-design.md");
  });

  it("upstream çıktılarını context bütçesine böler", () => {
    const prompt = buildWorkerPrompt({
      ...base,
      contextCharBudget: 200,
      upstream: [
        { id: "a", kind: "plan", output: "z".repeat(5000) },
        { id: "b", kind: "implement", output: "w".repeat(5000) },
      ],
    });
    expect(prompt).toContain("karakter kırpıldı");
    expect(prompt.length).toBeLessThan(3000);
  });
});
