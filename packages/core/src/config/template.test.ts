import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeConfig } from "./schema";
import { FALLBACK_CONFIG } from "./defaults";

/**
 * `resources/nexcode.config.default.json` kullanıcıya görünen, paylaşılabilir ayar
 * şablonudur; `FALLBACK_CONFIG` ise aynı değerlerin kod içi son çare kopyasıdır.
 * İkisinin ayrışması, kullanıcının gördüğü ayarla uygulamanın davranışını ayırır:
 * bu test o ayrışmayı engeller.
 */
const TEMPLATE_PATH = join(__dirname, "..", "..", "..", "..", "resources", "nexcode.config.default.json");

describe("nexcode.config.default.json", () => {
  const raw: unknown = JSON.parse(readFileSync(TEMPLATE_PATH, "utf8"));

  it("geçerli bir config'e normalize olur", () => {
    expect(() => normalizeConfig(raw)).not.toThrow();
  });

  it("FALLBACK_CONFIG ile birebir aynı davranışı üretir", () => {
    expect(normalizeConfig(raw)).toEqual(FALLBACK_CONFIG);
  });

  it("dokümantasyon anahtarları yüklemede düşürülür", () => {
    const config = normalizeConfig(raw) as unknown as Record<string, unknown>;
    for (const key of Object.keys(config)) {
      expect(key.startsWith("_")).toBe(false);
    }
  });

  it("şablonda düz metin API anahtarı bulunmaz", () => {
    // Anahtarlar OS keychain'de saklanır; şablon paylaşılabilir olmalıdır.
    const text = readFileSync(TEMPLATE_PATH, "utf8");
    expect(text).not.toMatch(/sk-[a-zA-Z0-9]{16,}/);
    expect(text).not.toMatch(/"apiKey"\s*:/);
  });
});
