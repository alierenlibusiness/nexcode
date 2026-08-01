import { describe, it, expect } from "vitest";
import { parseArgs } from "./cli";

/** Komut satırı ayrıştırması: `--key value`, `--key=value` ve çıplak bayraklar. */

describe("parseArgs", () => {
  it("komutu ve konumsal argümanları ayırır", () => {
    const result = parseArgs(["task", "avatar", "yükleme", "ekle"]);
    expect(result.command).toBe("task");
    expect(result.positional).toEqual(["avatar", "yükleme", "ekle"]);
  });

  it("boş girdide komut boş kalır", () => {
    expect(parseArgs([])).toEqual({ command: "", positional: [], flags: {} });
  });

  it("--key value biçimini okur", () => {
    expect(parseArgs(["task", "x", "--mode", "deep"]).flags).toEqual({ mode: "deep" });
  });

  it("--key=value biçimini okur", () => {
    expect(parseArgs(["run", "--mode=fast"]).flags).toEqual({ mode: "fast" });
  });

  it("değersiz bayrağı true yapar", () => {
    expect(parseArgs(["run", "--once"]).flags).toEqual({ once: true });
  });

  it("art arda gelen bayrakları birbirinin değeri saymaz", () => {
    expect(parseArgs(["run", "--once", "--json"]).flags).toEqual({ once: true, json: true });
  });

  it("bayrak değerini konumsal argümanla karıştırmaz", () => {
    const result = parseArgs(["task", "hedef metni", "--mode", "balanced", "--json"]);
    expect(result.positional).toEqual(["hedef metni"]);
    expect(result.flags).toEqual({ mode: "balanced", json: true });
  });

  it("içinde eşittir olan değeri bozmaz", () => {
    expect(parseArgs(["run", "--dir=C:/a=b"]).flags).toEqual({ dir: "C:/a=b" });
  });

  it("bayrak sonrası konumsal argümanı korur", () => {
    const result = parseArgs(["approvals", "--approve", "ap-1"]);
    expect(result.command).toBe("approvals");
    expect(result.flags).toEqual({ approve: "ap-1" });
  });
});
