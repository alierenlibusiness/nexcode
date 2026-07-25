import { describe, expect, it } from "vitest";
import { FALLBACK_CONFIG } from "../config/defaults";
import { normalizeConfig } from "../config/schema";
import { checkWrite, isInside, isWritable, normalizePath, sandboxPolicyFor } from "./sandbox";

describe("normalizePath", () => {
  it("ayraçları birleştirir", () => {
    expect(normalizePath("C:\\Projeler\\NexCode")).toBe("C:/Projeler/NexCode");
    expect(normalizePath("/home/ali/proje")).toBe("/home/ali/proje");
  });

  it("nokta segmentlerini çözer", () => {
    expect(normalizePath("C:/a/./b/../c")).toBe("C:/a/c");
    expect(normalizePath("/a/b/../../c")).toBe("/c");
  });

  it("kökün üstüne çıkamaz", () => {
    expect(normalizePath("C:/../../etc")).toBe("C:/etc");
    expect(normalizePath("/../../etc")).toBe("/etc");
  });

  it("sürücü harfini büyütür", () => {
    expect(normalizePath("c:/temp")).toBe("C:/temp");
  });

  it("göreli yolda üst dizini korur", () => {
    expect(normalizePath("../gizli/dosya")).toBe("../gizli/dosya");
  });
});

describe("isInside", () => {
  it("alt yolları tanır", () => {
    expect(isInside("C:/proje/src/a.ts", "C:/proje")).toBe(true);
    expect(isInside("/home/ali/proje/src", "/home/ali/proje")).toBe(true);
  });

  it("aynı yolu içeride sayar", () => {
    expect(isInside("C:/proje", "C:/proje")).toBe(true);
  });

  it("dışarıdaki yolları reddeder", () => {
    expect(isInside("C:/baska/a.ts", "C:/proje")).toBe(false);
    expect(isInside("/etc/passwd", "/home/ali/proje")).toBe(false);
  });

  it("benzer önekli kardeş klasörü içeride saymaz", () => {
    expect(isInside("C:/proje-gizli/a.ts", "C:/proje")).toBe(false);
  });

  it("Windows'ta büyük/küçük harfe duyarsızdır", () => {
    expect(isInside("c:/PROJE/src/a.ts", "C:/proje")).toBe(true);
  });

  it("`..` ile kaçışı engeller", () => {
    expect(isInside("C:/proje/../gizli/a.ts", "C:/proje")).toBe(false);
  });
});

describe("isWritable / checkWrite", () => {
  const policy = sandboxPolicyFor(FALLBACK_CONFIG, "C:/proje");

  it("çalışma klasörü içine yazmaya izin verir", () => {
    expect(isWritable("C:/proje/src/a.ts", policy)).toBe(true);
  });

  it("dışarıya yazmayı engeller", () => {
    expect(isWritable("C:/Windows/system32/x.dll", policy)).toBe(false);
  });

  it("ek yazılabilir yolları kabul eder", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      sandbox: { mode: "workspace", extraWritableDirs: ["C:/paylasilan"] },
    });
    const monorepo = sandboxPolicyFor(config, "C:/proje");
    expect(isWritable("C:/paylasilan/lib/a.ts", monorepo)).toBe(true);
    expect(isWritable("C:/baska/a.ts", monorepo)).toBe(false);
  });

  it("sandbox kapalıyken her yola izin verir", () => {
    const config = normalizeConfig({ ...FALLBACK_CONFIG, sandbox: { mode: "off", extraWritableDirs: [] } });
    expect(isWritable("C:/Windows/x", sandboxPolicyFor(config, "C:/proje"))).toBe(true);
  });

  it("reddedilen yazma için kullanıcıya gösterilebilir gerekçe verir", () => {
    const check = checkWrite("C:/gizli/a.ts", policy);
    expect(check.allowed).toBe(false);
    if (check.allowed) return;
    expect(check.reason).toContain("çalışma klasörünün dışında");
    expect(check.reason).toContain("C:/proje");
    expect(check.reason).toContain("extraWritableDirs");
  });
});
