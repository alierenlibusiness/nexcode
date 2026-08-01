import type { CliAdapter } from "../../config/schema";
import type { JsonObject, JsonValue } from "../../json";

/**
 * CLI çıktısı normalizasyonu.
 *
 * Her CLI kendi zarfını döndürür. Claude Code `--output-format json` ile çalıştığında
 * asıl yanıtı `result` alanının içine koyar ve etrafına oturum, kullanım ve maliyet
 * bilgisi sarar. Bu zarf ayıklanmazsa motor onu operatör kararı sanır ve her görev
 * "şema uyuşmazlığı" ile düşer.
 *
 * Zarf ayıklama aynı zamanda gerçek maliyeti de kazandırır: CLI'ın bildirdiği tutar,
 * tahmin yapmadan `cost_logs` kaydına yazılabilir.
 */

export interface NormalizedCliOutput {
  /** Operatör/uzman protokolüne verilecek asıl metin. */
  text: string;
  /** CLI'ın bildirdiği gerçek maliyet; bilinmiyorsa 0. */
  usdCost: number;
  /** CLI işi hata olarak bitirdiyse okunabilir sebep. */
  error: string | null;
}

/**
 * Ham stdout'u adapter'a göre asıl metne indirger.
 *
 * Zarf beklenen biçimde değilse ham metin olduğu gibi döndürülür: bir CLI sürümü çıktı
 * biçimini değiştirdiğinde sistem sessizce boş yanıt üretmek yerine çalışmayı sürdürür.
 */
export function normalizeCliOutput(adapter: CliAdapter | undefined, stdout: string): NormalizedCliOutput {
  const raw = stdout.trim();
  if (raw === "") return { text: "", usdCost: 0, error: null };

  if (adapter === "claude") return unwrapClaude(raw);
  return { text: raw, usdCost: 0, error: null };
}

/**
 * Claude Code JSON zarfı.
 *
 * Şekil: `{ type: "result", subtype, is_error, result: "<metin>", total_cost_usd, usage… }`
 */
function unwrapClaude(raw: string): NormalizedCliOutput {
  const envelope = parseObject(raw);
  if (envelope === null) return { text: raw, usdCost: 0, error: null };

  // `result` yoksa bu bir zarf değildir; metnin kendisi JSON olabilir.
  const result = envelope.result;
  if (typeof result !== "string") return { text: raw, usdCost: 0, error: null };

  const usdCost = typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : 0;
  const failed = envelope.is_error === true;
  const apiError = typeof envelope.api_error_status === "string" ? envelope.api_error_status : null;

  return {
    text: result,
    usdCost,
    error: failed ? (apiError ?? firstLine(result) ?? "CLI hata döndürdü") : null,
  };
}

function parseObject(raw: string): JsonObject | null {
  try {
    const value = JSON.parse(raw) as JsonValue;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function firstLine(text: string): string | null {
  return text.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? null;
}
