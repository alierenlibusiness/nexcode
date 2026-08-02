import { describe, expect, it } from "vitest";
import {
  extractBlockingFindings,
  parseVerdict,
  parseWorkerStatus,
  shouldDropRedundantReview,
  shouldFastPathDeliver,
} from "./verdict";

describe("parseVerdict", () => {
  it("reads the verdict from the last line", () => {
    expect(parseVerdict("Findings:\n- None\n\nVERDICT: PASS")).toBe("PASS");
    expect(parseVerdict("VERDICT: FAIL")).toBe("FAIL");
  });

  it("ignores trailing blank lines", () => {
    expect(parseVerdict("VERDICT: PASS\n\n   \n")).toBe("PASS");
  });

  it("treats a verdict followed by text as undecided", () => {
    expect(parseVerdict("VERDICT: PASS\nHope that helps.")).toBeNull();
  });

  it("does not accept a verdict embedded in prose", () => {
    expect(parseVerdict("I think VERDICT: PASS but I am not sure.")).toBeNull();
  });

  it("returns null when there is no verdict: it never silently assumes PASS", () => {
    expect(parseVerdict("Everything looks fine.")).toBeNull();
    expect(parseVerdict("")).toBeNull();
  });

  it("tolerates the Turkish equivalent, for the tr role prompts", () => {
    expect(parseVerdict("KARAR: GEÇTİ")).toBe("PASS");
    expect(parseVerdict("KARAR: KALDI")).toBe("FAIL");
  });
});

describe("parseWorkerStatus", () => {
  it("reads the status of the delivery report", () => {
    expect(parseWorkerStatus("STATUS: COMPLETED\nSUMMARY: ...")).toBe("COMPLETED");
    expect(parseWorkerStatus("STATUS: BLOCKED\nBLOCKED: no permission")).toBe("BLOCKED");
    expect(parseWorkerStatus("DURUM: TAMAMLANDI")).toBe("COMPLETED");
  });

  it("returns null when there is no status", () => {
    expect(parseWorkerStatus("More or less finished.")).toBeNull();
  });
});

describe("extractBlockingFindings", () => {
  it("collects only the CRITICAL and HIGH findings", () => {
    const review = [
      "FINDINGS:",
      "- [CRITICAL] src/auth.ts: the token is not validated",
      "- [HIGH] src/db.ts: SQL injection risk",
      "- [MEDIUM] src/ui.tsx: missing accessibility label",
      "- [LOW] README: typo",
      "VERDICT: FAIL",
    ].join("\n");
    expect(extractBlockingFindings(review)).toEqual([
      "src/auth.ts: the token is not validated",
      "src/db.ts: SQL injection risk",
    ]);
  });

  it("returns an empty array when there is no finding", () => {
    expect(extractBlockingFindings("FINDINGS:\n- None\nVERDICT: PASS")).toEqual([]);
  });
});

describe("shouldFastPathDeliver", () => {
  const settled = { allAssignmentsSettled: true, latestVerdict: "PASS" as const, hasFailure: false };

  it("skips the second operator call when the round settled with a fresh PASS", () => {
    expect(shouldFastPathDeliver(settled, true)).toBe(true);
  });

  it("forces the older evaluation path while passFastPath is off", () => {
    expect(shouldFastPathDeliver(settled, false)).toBe(false);
  });

  it("does not use the fast path when an assignment is unfinished", () => {
    expect(shouldFastPathDeliver({ ...settled, allAssignmentsSettled: false }, true)).toBe(false);
  });

  it("does not use the fast path when an assignment failed", () => {
    expect(shouldFastPathDeliver({ ...settled, hasFailure: true }, true)).toBe(false);
  });

  it("does not use the fast path on FAIL or without a verdict", () => {
    expect(shouldFastPathDeliver({ ...settled, latestVerdict: "FAIL" }, true)).toBe(false);
    expect(shouldFastPathDeliver({ ...settled, latestVerdict: null }, true)).toBe(false);
  });
});

describe("shouldDropRedundantReview", () => {
  it("opens no new review for the same delivery while a fresh PASS exists", () => {
    expect(shouldDropRedundantReview("PASS", false)).toBe(true);
  });

  it("allows a re-review once the delivery changed", () => {
    expect(shouldDropRedundantReview("PASS", true)).toBe(false);
  });

  it("does not drop a review after FAIL", () => {
    expect(shouldDropRedundantReview("FAIL", false)).toBe(false);
  });
});
