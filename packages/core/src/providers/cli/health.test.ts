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
  it("returns a fresh record", () => {
    const cache = new HealthCache({ a: result() });
    expect(cache.get("a", now)?.status).toBe("ready");
  });

  it("drops the record once the TTL expires", () => {
    const cache = new HealthCache({ a: result() });
    const later = new Date("2026-07-25T17:00:00.000Z"); // +7 hours
    expect(cache.get("a", later)).toBeUndefined();
  });

  it("never loads records from an older contract version", () => {
    // When the execution contract changes, stale false-negative records must not keep an
    // agent out of the catalogue; the user should not have to clear the cache by hand.
    const cache = new HealthCache({ a: result({ status: "failed", contractVersion: 0 }) });
    expect(cache.get("a", now)).toBeUndefined();
  });

  it("writes and invalidates a record", () => {
    const cache = new HealthCache();
    cache.set("a", result({ status: "auth" }));
    expect(cache.get("a", now)?.status).toBe("auth");

    cache.invalidate("a");
    expect(cache.get("a", now)).toBeUndefined();
  });

  it("invalidates everything", () => {
    const cache = new HealthCache({ a: result(), b: result() });
    cache.invalidate();
    expect(Object.keys(cache.snapshot())).toEqual([]);
  });

  it("produces a health map for the engine's catalog input", () => {
    const cache = new HealthCache({
      ready1: result(),
      broken: result({ status: "auth" }),
    });
    expect(cache.healthMap(now)).toEqual({ ready1: true, broken: false });
  });

  it("keeps expired records out of the map so they are probed again", () => {
    const cache = new HealthCache({ a: result() });
    expect(cache.healthMap(new Date("2026-07-26T10:00:00.000Z"))).toEqual({});
  });

  it("provides a snapshot for persistence", () => {
    const cache = new HealthCache({ a: result() });
    expect(cache.snapshot().a?.contractVersion).toBe(HEALTH_CONTRACT_VERSION);
  });
});

describe("isHealthy", () => {
  it("counts only the ready status as healthy", () => {
    expect(isHealthy(result())).toBe(true);
    expect(isHealthy(result({ status: "timeout" }))).toBe(false);
    expect(isHealthy(undefined)).toBe(false);
  });
});
