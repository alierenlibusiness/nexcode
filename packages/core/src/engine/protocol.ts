import { z } from "zod";
import { ASSIGNMENT_KINDS } from "../config/schema";

/**
 * Operatör karar protokolü.
 *
 * Operatör her çağrıda **yalnızca** bu şemaya uyan tek bir JSON nesnesi üretir: Markdown,
 * kod bloğu, önsöz, sonsöz veya yorum yoktur. Parse yalnızca protokol hatalarında ve
 * `operator.protocolRetries` kadar tekrarlanır: model çıktısı sessizce yorumlanmaz.
 *
 * Ayrıştırma tarafı yine de bağışlayıcıdır (kod çiti, çevre metin): katı prompt + toleranslı
 * parser, tek bir biçim kaymasının turu çöpe atmasını engeller.
 */

const assignmentSchema = z.object({
  /** Kısa, anlamlı ve tur içinde benzersiz kimlik. */
  id: z.string().min(1).max(64),
  /** Katalogdaki etkin ve sağlıklı bir agent'ın id'si. */
  agentId: z.string().min(1),
  kind: z.enum(ASSIGNMENT_KINDS),
  /**
   * Bağlam, kesin kapsam, beklenen teslimat, sınırlar ve doğrulama ölçütü.
   * Uzmanın ana hedefi yeniden tahmin etmesi beklenmez.
   */
  instruction: z.string().min(1),
  /** Bu işin beklediği atama kimlikleri (aynı turdaki zincirleme). */
  dependsOn: z.array(z.string()).default([]),
  /** Motorun sunduğu kısa listeden seçilmiş beceri adları. */
  skills: z.array(z.string()).default([]),
});

export type OperatorAssignment = z.infer<typeof assignmentSchema>;

/**
 * Delegasyon gövdesi. `plan` (ilk tur) ve `continue` (sonraki turlar) aynı alanları taşır;
 * ayrık birleşim tek literal ayırıcı gerektirdiği için iki varyant olarak tanımlanır.
 */
const delegateFields = {
  /** Gözlemlenebilir, göreve özgü kabul kriterleri. */
  acceptanceCriteria: z.array(z.string()).default([]),
  assignments: z.array(assignmentSchema).min(1),
  /** Kullanıcıya görünen kısa plan açıklaması; riskli işlem varsa burada açıkça belirtilir. */
  planSummary: z.string().default(""),
};

const planSchema = z.object({ status: z.literal("plan"), ...delegateFields });
const continueSchema = z.object({ status: z.literal("continue"), ...delegateFields });

const completeSchema = z.object({
  status: z.literal("complete"),
  /** Kullanıcı açısından sonuç; ham log ve iç koordinasyon ayrıntısı içermez. */
  final: z.string().min(1),
  /** Yapılan önemli doğrulama. */
  verification: z.string().default(""),
  /** Teslimatı engellemeyen ama bilinmesi gereken kalan kısıt. */
  remainingRisk: z.string().default(""),
});

const blockedSchema = z.object({
  status: z.literal("blocked"),
  /** Somut engel ve kanıtı. */
  blocked: z.string().min(1),
  /** Devam etmek için gereken bilgi, yetki veya dış durum. */
  needed: z.string().default(""),
});

export const operatorDecisionSchema = z.discriminatedUnion("status", [
  planSchema,
  continueSchema,
  completeSchema,
  blockedSchema,
]);

export type OperatorDecision = z.infer<typeof operatorDecisionSchema>;
export type DelegateDecision = z.infer<typeof planSchema> | z.infer<typeof continueSchema>;
export type CompleteDecision = z.infer<typeof completeSchema>;
export type BlockedDecision = z.infer<typeof blockedSchema>;

export type ParseResult =
  | { ok: true; decision: OperatorDecision }
  | { ok: false; error: string };

/**
 * Metinden ilk dengeli JSON nesnesini çıkarır. Sırayla: doğrudan parse → kod çitlerini
 * soyma → ilk `{` ile eşleşen `}` arası dengeli tarama (string ve kaçış farkındalığıyla).
 */
export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const haystack = fenced?.[1]?.trim() ?? trimmed;
  if (haystack.startsWith("{")) return haystack;

  const start = haystack.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i++) {
    const char = haystack[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}

/** Operatör çıktısını karar nesnesine çevirir; başarısızlıkta düzeltilebilir bir hata metni verir. */
export function parseOperatorDecision(text: string): ParseResult {
  const raw = extractJsonObject(text);
  if (raw === null) {
    return { ok: false, error: "Çıktıda JSON nesnesi bulunamadı. Yalnızca tek bir JSON nesnesi üret." };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `JSON ayrıştırılamadı: ${error instanceof Error ? error.message : String(error)}` };
  }

  const parsed = operatorDecisionSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(kök)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `Şema uyuşmazlığı; ${issues}` };
  }

  return { ok: true, decision: parsed.data };
}

/** Karar delegasyon üretiyor mu (plan ya da continue). */
export function isDelegateDecision(decision: OperatorDecision): decision is DelegateDecision {
  return decision.status === "plan" || decision.status === "continue";
}

/**
 * Protokol hatası sonrası operatöre gönderilecek düzeltme talimatı.
 * Yeni bir plan turu harcamaz; yalnızca biçimi düzelttirir.
 */
export function protocolRepairInstruction(error: string): string {
  return [
    "Önceki çıktın protokole uymuyordu ve kullanılamadı.",
    `Hata: ${error}`,
    "Bu sefer SADECE tek bir JSON nesnesi üret. Markdown, kod bloğu, açıklama veya",
    "başka hiçbir metin ekleme. Şemayı birebir uygula.",
  ].join("\n");
}
