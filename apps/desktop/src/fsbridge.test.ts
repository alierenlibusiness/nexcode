import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertInsideRoot, readDir, readFileText, writeFileText } from "./fsbridge";

/**
 * Dosya köprüsü kapsama kontrolü.
 *
 * IPC üzerinden mutlak yol geldiği için köprünün kullanıcının açtığı klasörün dışına
 * çıkmaması gerekir.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "nexcode-fs-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "app.ts"), "export const a = 1;", "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("assertInsideRoot", () => {
  it("kök içindeki yolu kabul eder ve çözümler", () => {
    const target = path.join(root, "src", "app.ts");
    expect(assertInsideRoot(root, target)).toBe(path.resolve(target));
  });

  it("kökün kendisini kabul eder", () => {
    expect(assertInsideRoot(root, root)).toBe(path.resolve(root));
  });

  it("üst dizine çıkışı reddeder", () => {
    expect(() => assertInsideRoot(root, path.join(root, "..", "gizli.txt"))).toThrow(/dışında/);
  });

  it("kök dışındaki mutlak yolu reddeder", () => {
    const outside = path.join(tmpdir(), "baska-klasor", "id_rsa");
    expect(() => assertInsideRoot(root, outside)).toThrow(/dışında/);
  });

  it("ortasında .. olan yolu normalize ederek değerlendirir", () => {
    // `<root>/src/../src/app.ts` kök içindedir ve kabul edilmelidir.
    const inside = path.join(root, "src", "..", "src", "app.ts");
    expect(assertInsideRoot(root, inside)).toBe(path.resolve(root, "src", "app.ts"));

    // `<root>/src/../../disari` kökün dışına taşar.
    expect(() => assertInsideRoot(root, path.join(root, "src", "..", "..", "disari"))).toThrow(/dışında/);
  });

  it("ortak önek paylaşan kardeş klasörü kök içinde saymaz", () => {
    // Salt string önek kontrolü bunu yanlışlıkla kabul ederdi.
    expect(() => assertInsideRoot(root, `${root}-secrets/keys.txt`)).toThrow(/dışında/);
  });
});

describe("kapsama uygulanmış dosya işlemleri", () => {
  it("kök içindeki dosyayı okur", () => {
    const result = readFileText(path.join(root, "src", "app.ts"), root);
    expect(result.content).toBe("export const a = 1;");
    expect(result.tooLarge).toBe(false);
  });

  it("kök dışındaki dosyayı okumayı reddeder", () => {
    expect(() => readFileText(path.join(root, "..", "gizli.txt"), root)).toThrow(/dışında/);
  });

  it("kök dışına yazmayı reddeder", () => {
    expect(() => writeFileText(path.join(root, "..", "zararli.txt"), "x", root)).toThrow(/dışında/);
  });

  it("kök içine yazar", () => {
    const target = path.join(root, "src", "yeni.ts");
    writeFileText(target, "içerik", root);
    expect(readFileSync(target, "utf8")).toBe("içerik");
  });

  it("kök dışındaki dizini listelemeyi reddeder", () => {
    expect(() => readDir(path.join(root, ".."), root)).toThrow(/dışında/);
  });

  it("yok sayılan klasörleri listelemez", () => {
    mkdirSync(path.join(root, "node_modules"), { recursive: true });
    mkdirSync(path.join(root, ".git"), { recursive: true });

    const names = readDir(root, root).map((e) => e.name);
    expect(names).toContain("src");
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".git");
  });

  it("dizinleri dosyalardan önce sıralar", () => {
    writeFileSync(path.join(root, "a-dosya.txt"), "x", "utf8");
    const entries = readDir(root, root);
    expect(entries[0]?.kind).toBe("directory");
  });
});
