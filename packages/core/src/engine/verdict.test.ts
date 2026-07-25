import { describe, expect, it } from "vitest";
import {
  extractBlockingFindings,
  parseVerdict,
  parseWorkerStatus,
  shouldDropRedundantReview,
  shouldFastPathDeliver,
} from "./verdict";

describe("parseVerdict", () => {
  it("son satırdaki kararı okur", () => {
    expect(parseVerdict("Bulgular:\n- Yok\n\nVERDICT: PASS")).toBe("PASS");
    expect(parseVerdict("VERDICT: FAIL")).toBe("FAIL");
  });

  it("sondaki boş satırları yok sayar", () => {
    expect(parseVerdict("VERDICT: PASS\n\n   \n")).toBe("PASS");
  });

  it("karardan sonra metin varsa belirsiz sayar", () => {
    expect(parseVerdict("VERDICT: PASS\nUmarım yardımcı olmuştur.")).toBeNull();
  });

  it("metin içine gömülü kararı kabul etmez", () => {
    expect(parseVerdict("Bence VERDICT: PASS olmalı ama emin değilim.")).toBeNull();
  });

  it("karar yoksa null döner — sessizce PASS varsaymaz", () => {
    expect(parseVerdict("Her şey iyi görünüyor.")).toBeNull();
    expect(parseVerdict("")).toBeNull();
  });

  it("Türkçe karşılığı tolere eder", () => {
    expect(parseVerdict("KARAR: GEÇTİ")).toBe("PASS");
    expect(parseVerdict("KARAR: KALDI")).toBe("FAIL");
  });
});

describe("parseWorkerStatus", () => {
  it("teslimat raporunun durumunu okur", () => {
    expect(parseWorkerStatus("STATUS: COMPLETED\nÖZET: ...")).toBe("COMPLETED");
    expect(parseWorkerStatus("STATUS: BLOCKED\nBLOCKED: yetki yok")).toBe("BLOCKED");
    expect(parseWorkerStatus("DURUM: TAMAMLANDI")).toBe("COMPLETED");
  });

  it("durum yoksa null döner", () => {
    expect(parseWorkerStatus("Bitirdim sayılır.")).toBeNull();
  });
});

describe("extractBlockingFindings", () => {
  it("yalnızca CRITICAL ve HIGH bulguları toplar", () => {
    const review = [
      "BULGULAR:",
      "- [CRITICAL] src/auth.ts — token doğrulanmıyor",
      "- [HIGH] src/db.ts — SQL injection riski",
      "- [MEDIUM] src/ui.tsx — erişilebilirlik etiketi eksik",
      "- [LOW] README — yazım hatası",
      "VERDICT: FAIL",
    ].join("\n");
    expect(extractBlockingFindings(review)).toEqual([
      "src/auth.ts — token doğrulanmıyor",
      "src/db.ts — SQL injection riski",
    ]);
  });

  it("bulgu yoksa boş dizi döner", () => {
    expect(extractBlockingFindings("BULGULAR:\n- Yok\nVERDICT: PASS")).toEqual([]);
  });
});

describe("shouldFastPathDeliver", () => {
  const settled = { allAssignmentsSettled: true, latestVerdict: "PASS" as const, hasFailure: false };

  it("tur bittiğinde ve taze PASS varsa ikinci operatör çağrısını atlar", () => {
    expect(shouldFastPathDeliver(settled, true)).toBe(true);
  });

  it("passFastPath kapalıysa eski değerlendirme yolunu zorlar", () => {
    expect(shouldFastPathDeliver(settled, false)).toBe(false);
  });

  it("tamamlanmamış atama varsa hızlı yol kullanılmaz", () => {
    expect(shouldFastPathDeliver({ ...settled, allAssignmentsSettled: false }, true)).toBe(false);
  });

  it("başarısız atama varsa hızlı yol kullanılmaz", () => {
    expect(shouldFastPathDeliver({ ...settled, hasFailure: true }, true)).toBe(false);
  });

  it("FAIL veya karar yoksa hızlı yol kullanılmaz", () => {
    expect(shouldFastPathDeliver({ ...settled, latestVerdict: "FAIL" }, true)).toBe(false);
    expect(shouldFastPathDeliver({ ...settled, latestVerdict: null }, true)).toBe(false);
  });
});

describe("shouldDropRedundantReview", () => {
  it("taze PASS varken aynı teslimata yeni inceleme açılmaz", () => {
    expect(shouldDropRedundantReview("PASS", false)).toBe(true);
  });

  it("teslimat değiştiyse yeniden inceleme meşrudur", () => {
    expect(shouldDropRedundantReview("PASS", true)).toBe(false);
  });

  it("FAIL sonrası inceleme düşürülmez", () => {
    expect(shouldDropRedundantReview("FAIL", false)).toBe(false);
  });
});
