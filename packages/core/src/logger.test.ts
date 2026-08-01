import { describe, it, expect, afterEach, vi } from "vitest";
import { logger, setLogSink, type LogRecord } from "./logger";

/**
 * Logger sözleşmesi.
 *
 * Kritik değişmez: loglar ASLA standart çıktıya yazılmaz. MCP stdio sunucusu stdout'u
 * JSON-RPC için kullanır; oraya düşen tek bir log satırı istemcinin ayrıştırmasını bozar.
 */

afterEach(() => {
  setLogSink(null);
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("hiçbir seviye standart çıktıya yazmaz", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(4);
  });

  it("kayıtları tek satırlık JSON olarak yazar", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    logger.info("cli.discovered", { adapter: "claude" });

    const line = String(stderr.mock.calls[0]?.[0]);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().includes("\n")).toBe(false);

    const parsed = JSON.parse(line) as LogRecord;
    expect(parsed).toMatchObject({ level: "info", message: "cli.discovered", adapter: "claude" });
    expect(Date.parse(parsed.ts)).not.toBeNaN();
  });

  it("özel sink'e yönlendirilebilir ve geri alınabilir", () => {
    const captured: LogRecord[] = [];
    setLogSink((record) => captured.push(record));

    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    logger.warn("yönlendirildi");

    expect(captured).toHaveLength(1);
    expect(captured[0]?.message).toBe("yönlendirildi");
    expect(stderr).not.toHaveBeenCalled();

    setLogSink(null);
    logger.warn("varsayılana döndü");
    expect(stderr).toHaveBeenCalledTimes(1);
  });

  it("alanlar zorunlu anahtarları ezemez", () => {
    const captured: LogRecord[] = [];
    setLogSink((record) => captured.push(record));

    logger.error("gerçek mesaj", { detail: "ek bilgi" });
    expect(captured[0]).toMatchObject({ level: "error", message: "gerçek mesaj", detail: "ek bilgi" });
  });
});
