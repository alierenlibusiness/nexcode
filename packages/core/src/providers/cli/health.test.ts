import { describe, expect, it } from "vitest";
import { HEALTH_CONTRACT_VERSION, HealthCache, isHealthy, type HealthResult } from "./health";

function result(over: Partial<HealthResult> = {}): HealthResult {
  return {
    status: "ready",
    checkedAt: new Date("2026-07-25T10:00:00.000Z").toISOString(),
    contractVersion: HEALTH_CONTRACT_VERSION,
    detail: "",
    ...over,
  };
}

const now = new Date("2026-07-25T10:30:00.000Z");

describe("HealthCache", () => {
  it("taze kaydı döndürür", () => {
    const cache = new HealthCache({ a: result() });
    expect(cache.get("a", now)?.status).toBe("ready");
  });

  it("TTL dolduğunda kaydı düşürür", () => {
    const cache = new HealthCache({ a: result() });
    const later = new Date("2026-07-25T17:00:00.000Z"); // +7 saat
    expect(cache.get("a", later)).toBeUndefined();
  });

  it("eski sözleşme sürümündeki kayıtları hiç yüklemez", () => {
    // Yürütme sözleşmesi değiştiğinde eski false-negative kayıtlar agent'ı katalog
    // dışında tutmamalıdır; kullanıcı elle cache temizlemek zorunda kalmaz.
    const cache = new HealthCache({ a: result({ status: "failed", contractVersion: 0 }) });
    expect(cache.get("a", now)).toBeUndefined();
  });

  it("kayıt yazar ve geçersiz kılar", () => {
    const cache = new HealthCache();
    cache.set("a", result({ status: "auth" }));
    expect(cache.get("a", now)?.status).toBe("auth");

    cache.invalidate("a");
    expect(cache.get("a", now)).toBeUndefined();
  });

  it("tümünü geçersiz kılar", () => {
    const cache = new HealthCache({ a: result(), b: result() });
    cache.invalidate();
    expect(Object.keys(cache.snapshot())).toEqual([]);
  });

  it("motorun katalog girdisi için sağlık haritası üretir", () => {
    const cache = new HealthCache({
      ready1: result(),
      broken: result({ status: "auth" }),
    });
    expect(cache.healthMap(now)).toEqual({ ready1: true, broken: false });
  });

  it("TTL dolmuş kayıtları haritaya koymaz: yeniden test edilirler", () => {
    const cache = new HealthCache({ a: result() });
    expect(cache.healthMap(new Date("2026-07-26T10:00:00.000Z"))).toEqual({});
  });

  it("kalıcılaştırma için anlık görüntü verir", () => {
    const cache = new HealthCache({ a: result() });
    expect(cache.snapshot().a?.contractVersion).toBe(HEALTH_CONTRACT_VERSION);
  });
});

describe("isHealthy", () => {
  it("yalnızca ready durumunu sağlıklı sayar", () => {
    expect(isHealthy(result())).toBe(true);
    expect(isHealthy(result({ status: "timeout" }))).toBe(false);
    expect(isHealthy(undefined)).toBe(false);
  });
});
