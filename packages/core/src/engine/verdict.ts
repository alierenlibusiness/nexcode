/**
 * Uzman çıktı sözleşmelerinin makine tarafı.
 *
 * Rol dosyaları iki dilde tutulur, ancak **makine tarafından okunan işaretçiler çevrilmez**:
 * `STATUS:` ve `VERDICT:` her dilde aynıdır. Böylece arayüz dili değiştiğinde motorun
 * ayrıştırması bozulmaz. Yine de bir model işaretçiyi çevirirse diye Türkçe karşılıkları
 * (`DURUM:` / `KARAR:`) tolere edilir.
 */

export type ReviewVerdict = "PASS" | "FAIL";
export type WorkerStatus = "COMPLETED" | "BLOCKED";

const VERDICT_LINE = /^\s*(?:VERDICT|KARAR)\s*:\s*(PASS|FAIL|GEÇTI|GEÇTİ|KALDI)\s*$/i;
const STATUS_LINE = /^\s*(?:STATUS|DURUM)\s*:\s*(COMPLETED|BLOCKED|TAMAMLANDI|ENGELLENDI|ENGELLENDİ)\s*$/i;

function normalizeVerdict(token: string): ReviewVerdict {
  const upper = token.toUpperCase();
  return upper === "PASS" || upper === "GEÇTI" || upper === "GEÇTİ" ? "PASS" : "FAIL";
}

function normalizeStatus(token: string): WorkerStatus {
  const upper = token.toUpperCase();
  return upper === "COMPLETED" || upper === "TAMAMLANDI" ? "COMPLETED" : "BLOCKED";
}

function lastNonEmptyLine(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line !== undefined && line.trim() !== "") return line;
  }
  return null;
}

/**
 * İnceleme kararını okur. Sözleşme gereği çıktının **son** satırı, arkasında hiçbir metin
 * olmadan `VERDICT: PASS` veya `VERDICT: FAIL` olmalıdır. Son satır uymuyorsa karar
 * belirsizdir (`null`) ve motor bunu inceleme başarısızlığı olarak ele alır: sessizce
 * PASS varsaymaz.
 */
export function parseVerdict(text: string): ReviewVerdict | null {
  const last = lastNonEmptyLine(text);
  if (last === null) return null;
  const match = last.match(VERDICT_LINE);
  return match?.[1] !== undefined ? normalizeVerdict(match[1]) : null;
}

/** Uygulayıcı teslimat raporunun durumu; bulunamazsa `null`. */
export function parseWorkerStatus(text: string): WorkerStatus | null {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(STATUS_LINE);
    if (match?.[1] !== undefined) return normalizeStatus(match[1]);
  }
  return null;
}

/**
 * Bir incelemenin `FAIL` gerekçelerini çıkarır: sonraki turda hedefli düzeltme görevi
 * açmak için kullanılır. Yalnızca CRITICAL/HIGH bulgular düzeltme gerektirir; MEDIUM/LOW
 * kalan risk olarak raporlanır.
 */
export function extractBlockingFindings(text: string): string[] {
  const findings: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s*\[(CRITICAL|HIGH)\]\s*(.+)$/i);
    const detail = match?.[2];
    if (detail !== undefined) findings.push(detail.trim());
  }
  return findings;
}

export interface RoundOutcome {
  /** Turdaki tüm atamalar bitti mi (başarılı ya da kalıcı başarısız). */
  allAssignmentsSettled: boolean;
  /** Turdaki en güncel inceleme kararı; inceleme yoksa null. */
  latestVerdict: ReviewVerdict | null;
  /** Turda en az bir atama kalıcı olarak başarısız oldu mu. */
  hasFailure: boolean;
}

/**
 * PASS hızlı yolu: turun tüm atamaları tamamlanmış ve en güncel inceleme `PASS` ise
 * ikinci operatör değerlendirme çağrısı atlanır ve iş doğrudan teslim edilir.
 *
 * Kullanıcı açısından en pahalı sonuç, bitmiş işin ek doğrulama turlarında bekletilmesidir.
 * `operator.passFastPath: false` eski (pahalı) değerlendirme yolunu zorlar.
 */
export function shouldFastPathDeliver(outcome: RoundOutcome, passFastPathEnabled: boolean): boolean {
  if (!passFastPathEnabled) return false;
  if (!outcome.allAssignmentsSettled) return false;
  if (outcome.hasFailure) return false;
  return outcome.latestVerdict === "PASS";
}

/**
 * `PASS` sonrası aynı teslimat için yeni inceleme açılmamalıdır. Motor bu kontrolü
 * operatörün planına da uygular: taze bir PASS varken üretilen review ataması düşürülür.
 */
export function shouldDropRedundantReview(latestVerdict: ReviewVerdict | null, deliverableChanged: boolean): boolean {
  return latestVerdict === "PASS" && !deliverableChanged;
}
