import type { AssignmentKind } from "../config/schema";
import type { CatalogAgent, NormalizedAssignment } from "./routing";
import type { RoundPolicy } from "./rounds";

/**
 * Prompt kurulumu ve karakter bütçeleri.
 *
 * İki değişmez korunur:
 * 1. Bağlam **sessizce kesilmez**: kesme her zaman görünür bir işaretle bildirilir.
 * 2. Büyük kullanıcı metni katı JSON operatör protokolünü bozmaz; dosyaya taşınır.
 */

/** Metni sondan kırpar (hafıza/log gibi "en yenisi önemli" içerikler için). */
export function trimFromEnd(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;
  const kept = text.slice(text.length - budget);
  return `[… ${String(text.length - budget)} karakter kırpıldı …]\n${kept}`;
}

/** Metni baştan kırpar (plan/talimat gibi "en eskisi önemli" içerikler için). */
export function trimFromStart(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}\n[… ${String(text.length - budget)} karakter kırpıldı …]`;
}

export interface PromptDigest {
  /** Modele gömülecek metin. */
  text: string;
  /** Tam metnin yazılacağı dosya; kırpma gerekmediyse null. */
  spill: { relativePath: string; content: string } | null;
}

/**
 * Kullanıcı görev metni bütçeyi aşarsa tam metin çalışma klasörünün
 * `.nexcode/TASK-<id>.md` dosyasına yazılır; prompt'a yalnızca baş + son özeti ve
 * "tam metni dosyadan oku" işareti gömülür.
 *
 * Böylece 1000+ satırlık bir spec, operatörün katı JSON protokolünü bozmaz ve
 * hiçbir bölüm kullanıcıya haber verilmeden düşürülmez.
 */
export function digestTaskPrompt(taskId: string, prompt: string, budget: number): PromptDigest {
  if (prompt.length <= budget) return { text: prompt, spill: null };

  const relativePath = `.nexcode/TASK-${taskId}.md`;
  const half = Math.floor((budget - 400) / 2);
  const head = prompt.slice(0, half);
  const tail = prompt.slice(prompt.length - half);

  const text = [
    `[Görev metni ${String(prompt.length)} karakter olduğu için tamamı buraya gömülmedi.]`,
    `[TAM METİN: çalışma klasöründeki \`${relativePath}\` dosyasında. Karar vermeden ÖNCE bu dosyayı OKU.]`,
    "",
    "── Metnin başı ──",
    head,
    "",
    `[… ortadaki ${String(prompt.length - half * 2)} karakter yalnızca dosyada …]`,
    "",
    "── Metnin sonu ──",
    tail,
  ].join("\n");

  return { text, spill: { relativePath, content: prompt } };
}

const PHASE_SCHEMA: Readonly<Record<"plan" | "evaluate", string>> = {
  plan: [
    "Bu evrede ÜÇ seçenekten tam olarak birini üret:",
    "",
    "1) Delegasyon planı:",
    '{"status":"plan","planSummary":"<kısa plan açıklaması>",',
    ' "acceptanceCriteria":["<gözlemlenebilir sonuç>"],',
    ' "assignments":[{"id":"<kısa benzersiz kimlik>","agentId":"<katalogdaki agent>",',
    '   "kind":"plan|implement|review|research","instruction":"<bağlam, kesin kapsam, beklenen',
    '   teslimat, sınırlar, doğrulama ölçütü>","dependsOn":["<önce biten atama kimliği>"],',
    '   "skills":["<kısa listeden beceri adı>"]}]}',
    "",
    "2) Delegasyon gerekmiyorsa doğrudan yanıt:",
    '{"status":"complete","final":"<kullanıcıya sonuç>","verification":"<yapılan doğrulama>","remainingRisk":"<varsa>"}',
    "",
    "3) Somut bir engel varsa:",
    '{"status":"blocked","blocked":"<engel ve kanıtı>","needed":"<gereken bilgi/yetki>"}',
  ].join("\n"),
  evaluate: [
    "Bu evrede ÜÇ seçenekten tam olarak birini üret:",
    "",
    "1) Eksik kalan iş için yeni tur:",
    '{"status":"continue","planSummary":"<neden yeni tur gerekiyor>",',
    ' "acceptanceCriteria":["<kalan kriter>"],',
    ' "assignments":[{"id":"…","agentId":"…","kind":"plan|implement|review|research",',
    '   "instruction":"…","dependsOn":[],"skills":[]}]}',
    "",
    "2) Kabul kriterleri karşılandıysa:",
    '{"status":"complete","final":"<kullanıcıya sonuç>","verification":"<önemli doğrulama>","remainingRisk":"<kalan risk veya boş>"}',
    "",
    "3) İş güvenle tamamlanamıyorsa:",
    '{"status":"blocked","blocked":"<engel ve kanıtı>","needed":"<gereken bilgi/yetki>"}',
  ].join("\n"),
};

export interface SkillHint {
  name: string;
  summary: string;
  /** Uzmanın gerektiğinde okuyacağı tam rehberin yolu. */
  referencePath: string;
}

export interface OperatorPromptInput {
  phase: "plan" | "evaluate";
  /** `roles/operator.md` içeriği. */
  roleText: string;
  goal: string;
  policy: RoundPolicy;
  round: number;
  catalog: readonly CatalogAgent[];
  /** Göreve göre skorlanmış kısa liste (tüm katalog değil). */
  skills: readonly SkillHint[];
  /** `.nexcode/CONTEXT.md` proje profili. */
  projectContext: string;
  /** Önceki turların özeti; `policy.contextCharBudget` ile sınırlanır. */
  teamState: string;
  /**
   * Çalıştırılmış doğrulama komutlarının kanıt bloğu (`verifyEvidence`).
   * Boş string kapının hiç çalışmadığı anlamına gelir ve bölüm basılmaz.
   */
  verifyEvidence?: string;
  /** Protokol hatası sonrası düzeltme talimatı. */
  repairInstruction?: string;
}

export function buildOperatorPrompt(input: OperatorPromptInput): string {
  const sections: string[] = [input.roleText.trim(), "", "═══ ÇALIŞMA EVRESİ ═══", ""];

  sections.push(
    `Evre: ${input.phase === "plan" ? "PLANLAMA" : "DEĞERLENDİRME"}`,
    `Tur: ${String(input.round)} / ${String(input.policy.maxRounds)}`,
    `Çalışma modu: ${input.policy.mode}`,
    `Bu turda en fazla ${String(input.policy.maxDelegationsPerRound)} delegasyon açabilirsin.`,
    input.policy.requireReview
      ? "Bu modda uygulama işleri bağımsız incelemeden geçmelidir."
      : "Bu mod küçük görevlerde tek uygulayıcıya izin verir; gereksiz rol açma.",
    input.policy.separatePlanning
      ? "Bu mod ayrı bir planlama delegasyonunu korur."
      : "Ayrı planlama turu açma; planlamayı ilk turun zincirine göm.",
    "",
  );

  sections.push("═══ AGENT KATALOĞU (yalnızca bu agent'lara görev verebilirsin) ═══", "");
  if (input.catalog.length === 0) {
    sections.push("(Katalog boş: uzman agent yok. Sonuç uydurma; somut engeli bildir.)");
  } else {
    for (const agent of input.catalog) {
      const kinds = agent.allowedKinds.join(", ") || "yok";
      const domain = agent.domain !== undefined ? ` · alan: ${agent.domain}` : "";
      sections.push(`- ${agent.id} · ${agent.name} · rol: ${agent.role}${domain} · alabileceği iş: ${kinds}`);
    }
  }
  sections.push("");

  if (input.skills.length > 0) {
    sections.push(
      "═══ BECERİLER (OTORİTER kaynak) ═══",
      "",
      "Bu bölüm sistemin beceri envanteridir ve TEK doğru kaynaktır. Beceri sayısı, adı veya",
      "varlığı sorulduğunda daima bunu esas al; çalıştığın CLI'ın kendi dahili becerilerini",
      "bu sistemin becerileri gibi sayma. Gerçekten ilgili olan en fazla birkaç beceriyi",
      "delegasyonun `skills` alanına ekle; uygun beceri yoksa alanı boş bırak.",
      "",
    );
    for (const skill of input.skills) {
      sections.push(`- ${skill.name}: ${skill.summary}`);
    }
    sections.push("");
  }

  if (input.projectContext.trim() !== "") {
    sections.push("═══ PROJE PROFİLİ ═══", "", input.projectContext.trim(), "");
  }

  if (input.teamState.trim() !== "") {
    sections.push(
      "═══ ÖNCEKİ TURLAR ═══",
      "",
      trimFromEnd(input.teamState.trim(), input.policy.contextCharBudget),
      "",
    );
  }

  // Çalıştırılmış kanıt, modelin kendi beyanının önüne konur.
  if (input.verifyEvidence !== undefined && input.verifyEvidence.trim() !== "") {
    sections.push("═══ DOĞRULAMA KAPISI ═══", "", input.verifyEvidence.trim(), "");
  }

  sections.push("═══ KULLANICI HEDEFİ ═══", "", input.goal, "");

  if (input.repairInstruction !== undefined) {
    sections.push("═══ PROTOKOL DÜZELTMESİ ═══", "", input.repairInstruction, "");
  }

  sections.push("═══ ÇIKTI SÖZLEŞMESİ ═══", "", PHASE_SCHEMA[input.phase], "");
  sections.push(
    "Bu JSON nesnesinden başka HİÇBİR ŞEY üretme: Markdown, kod bloğu, önsöz, sonsöz veya yorum ekleme.",
  );

  return sections.join("\n");
}

export interface WorkerPromptInput {
  /** `roles/<role>.md` içeriği. */
  roleText: string;
  assignment: NormalizedAssignment;
  goal: string;
  /** Bağımlı olduğu atamaların çıktıları (ör. plan → uygulama). */
  upstream: ReadonlyArray<{ id: string; kind: AssignmentKind; output: string }>;
  skills: readonly SkillHint[];
  projectContext: string;
  /** Sandbox açıkken yazılabilir kök. */
  workingDir: string;
  sandboxed: boolean;
  contextCharBudget: number;
}

export function buildWorkerPrompt(input: WorkerPromptInput): string {
  const sections: string[] = [input.roleText.trim(), "", "═══ ANA HEDEF ═══", "", input.goal, ""];

  sections.push("═══ SANA DEVREDİLEN İŞ ═══", "", input.assignment.instruction, "");

  if (input.upstream.length > 0) {
    sections.push("═══ ÖNCEKİ ADIMLARIN ÇIKTISI ═══", "");
    const perItem = Math.floor(input.contextCharBudget / input.upstream.length);
    for (const item of input.upstream) {
      sections.push(`── ${item.id} (${item.kind}) ──`, trimFromStart(item.output.trim(), perItem), "");
    }
  }

  if (input.projectContext.trim() !== "") {
    sections.push("═══ PROJE PROFİLİ ═══", "", input.projectContext.trim(), "");
  }

  if (input.skills.length > 0) {
    sections.push("═══ BECERİ REHBERLERİ ═══", "");
    sections.push("Önce özeti uygula; yetmezse rehber dosyasını OKU ve prosedürüne uy.", "");
    for (const skill of input.skills) {
      sections.push(`- ${skill.name}: ${skill.summary}`, `  Tam rehber: ${skill.referencePath}`);
    }
    sections.push("");
  }

  sections.push("═══ ÇALIŞMA SINIRI ═══", "");
  sections.push(`Çalışma klasörü: ${input.workingDir}`);
  if (input.sandboxed) {
    sections.push(
      "Bu klasörün DIŞINA yazma. Dışarıda değişiklik gerekiyorsa yapma; engeli bildir.",
      "Kullanıcının mevcut veya ilgisiz değişikliklerini koru; geri alma, silme ya da üzerine yazma.",
    );
  }
  sections.push("");

  return sections.join("\n");
}
