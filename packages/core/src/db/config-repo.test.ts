import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./connection";
import { ConfigRepository } from "./config-repo";
import { FALLBACK_CONFIG } from "../config/defaults";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexcode-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function templateWith(body: unknown): string {
  const path = join(dir, "template.json");
  writeFileSync(path, JSON.stringify(body), "utf8");
  return path;
}

function repo(templatePath: string): ConfigRepository {
  return new ConfigRepository(openDatabase(":memory:"), templatePath);
}

describe("ConfigRepository", () => {
  it("ilk okumada şablonu tohumlar ve kalıcı kılar", () => {
    const r = repo(templateWith({ ...FALLBACK_CONFIG, workingDir: "/tohum" }));
    expect(r.load().workingDir).toBe("/tohum");

    // İkinci okuma artık kayıttan gelir; şablon silinse de değer korunur.
    rmSync(join(dir, "template.json"), { force: true });
    expect(r.load().workingDir).toBe("/tohum");
  });

  it("şablon yoksa kod içi güvenli tabana düşer", () => {
    const r = repo(join(dir, "olmayan.json"));
    expect(r.load().workingDir).toBe(FALLBACK_CONFIG.workingDir);
  });

  it("şablon bozuksa kilitlenmez, güvenli tabana düşer", () => {
    const path = join(dir, "template.json");
    writeFileSync(path, "{ bozuk json", "utf8");
    expect(repo(path).load().workingDir).toBe(FALLBACK_CONFIG.workingDir);
  });

  it("kaydedilen kayıt bozulursa güvenli tabana düşer", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO engine_state (key, value) VALUES ('config', 'bozuk')").run();
    const r = new ConfigRepository(db, templateWith(FALLBACK_CONFIG));
    expect(r.load().workingDir).toBe(FALLBACK_CONFIG.workingDir);
  });

  it("kaydederken normalize eder ve eksik alanları tamamlar", () => {
    const r = repo(templateWith(FALLBACK_CONFIG));
    const saved = r.save({ ...FALLBACK_CONFIG, approvalMode: "ask" });
    expect(saved.approvalMode).toBe("ask");
    expect(r.load().approvalMode).toBe("ask");
  });

  it("resetToTemplate kullanıcı değişikliğini şablona döndürür", () => {
    const r = repo(templateWith({ ...FALLBACK_CONFIG, workingDir: "/sablon" }));
    r.save({ ...FALLBACK_CONFIG, workingDir: "/kullanici" });
    expect(r.load().workingDir).toBe("/kullanici");

    expect(r.resetToTemplate().workingDir).toBe("/sablon");
    expect(r.load().workingDir).toBe("/sablon");
  });
});
