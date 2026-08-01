import { describe, it, expect } from "vitest";
import { VerifyGate, verifyEvidence, verifySummary, IDLE_VERIFY_REPORT, type VerifyPort } from "./verify-gate";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";

interface FakeOptions {
  /** Kırmızı dönecek komutlar. */
  failing?: string[];
  timingOut?: string[];
  stdout?: Record<string, string>;
}

function fakePort(options: FakeOptions = {}) {
  const ran: string[] = [];
  const port: VerifyPort = {
    runShell: ({ command }) => {
      ran.push(command);
      const timedOut = options.timingOut?.includes(command) ?? false;
      const failed = timedOut || (options.failing?.includes(command) ?? false);
      return Promise.resolve({
        ok: !failed,
        stdout: options.stdout?.[command] ?? "",
        stderr: failed ? `${command} düştü` : "",
        timedOut,
      });
    },
  };
  return { port, ran };
}

function config(verify: Partial<NexcodeConfig["verify"]> = {}): NexcodeConfig {
  return normalizeConfig({ ...FALLBACK_CONFIG, verify });
}

describe("VerifyGate.run", () => {
  it("komut yokken hiç süreç başlatmaz (opt-in)", async () => {
    const { port, ran } = fakePort();
    const report = await new VerifyGate(port).run(config(), "/w");

    expect(report).toEqual(IDLE_VERIFY_REPORT);
    expect(report.ran).toBe(false);
    expect(ran).toHaveLength(0);
  });

  it("tüm komutlar geçerse yeşil döner", async () => {
    const { port, ran } = fakePort();
    const report = await new VerifyGate(port).run(config({ commands: ["pnpm test", "pnpm lint"] }), "/w");

    expect(report.ran).toBe(true);
    expect(report.ok).toBe(true);
    expect(ran).toEqual(["pnpm test", "pnpm lint"]);
  });

  it("ilk kırmızıda durur, kalan komutları çalıştırmaz", async () => {
    const { port, ran } = fakePort({ failing: ["pnpm typecheck"] });
    const report = await new VerifyGate(port).run(
      config({ commands: ["pnpm typecheck", "pnpm test", "pnpm lint"] }),
      "/w",
    );

    expect(report.ok).toBe(false);
    expect(ran).toEqual(["pnpm typecheck"]);
    expect(report.commands).toHaveLength(1);
  });

  it("süre aşımını ayrı işaretler", async () => {
    const { port } = fakePort({ timingOut: ["pnpm e2e"] });
    const report = await new VerifyGate(port).run(config({ commands: ["pnpm e2e"] }), "/w");

    expect(report.commands[0]?.timedOut).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("her koşumda deneme sayacını artırır, reset sıfırlar", async () => {
    const { port } = fakePort({ failing: ["pnpm test"] });
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"] });

    expect((await gate.run(cfg, "/w")).attempt).toBe(1);
    expect((await gate.run(cfg, "/w")).attempt).toBe(2);

    gate.reset();
    expect((await gate.run(cfg, "/w")).attempt).toBe(1);
  });

  it("uzun çıktıyı ortadan kırpar ve iki ucu da korur", async () => {
    const output = `BAS${"x".repeat(5000)}SON hata burada`;
    const { port } = fakePort({ failing: ["pnpm test"], stdout: { "pnpm test": output } });
    const report = await new VerifyGate(port).run(config({ commands: ["pnpm test"], maxOutputChars: 400 }), "/w");

    const clipped = report.commands[0]?.output ?? "";
    expect(clipped.length).toBeLessThan(output.length);
    expect(clipped.startsWith("BAS")).toBe(true);
    expect(clipped).toContain("karakter atlandı");
    expect(clipped).toContain("hata burada");
  });
});

describe("VerifyGate.isBlocking", () => {
  it("yeşil kapı engellemez", async () => {
    const { port } = fakePort();
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"] });

    expect(gate.isBlocking(cfg, await gate.run(cfg, "/w"))).toBe(false);
  });

  it("çalışmamış kapı engellemez", () => {
    const { port } = fakePort();
    expect(new VerifyGate(port).isBlocking(config(), IDLE_VERIFY_REPORT)).toBe(false);
  });

  it("kırmızı kapı deneme hakkı bitene kadar engeller", async () => {
    const { port } = fakePort({ failing: ["pnpm test"] });
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"], maxAttempts: 2 });

    expect(gate.isBlocking(cfg, await gate.run(cfg, "/w"))).toBe(true);
    // İkinci deneme hakkı tüketir: iş çöpe atılmaz, uyarıyla teslim edilir.
    expect(gate.isBlocking(cfg, await gate.run(cfg, "/w"))).toBe(false);
  });

  it("blockOnFailure kapalıyken kapı yalnızca rapor eder", async () => {
    const { port } = fakePort({ failing: ["pnpm test"] });
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"], blockOnFailure: false });

    const report = await gate.run(cfg, "/w");
    expect(report.ok).toBe(false);
    expect(gate.isBlocking(cfg, report)).toBe(false);
  });
});

describe("VerifyGate.allowsFastPath", () => {
  it("kırmızı kapı kestirmeleri kapatır", async () => {
    const { port } = fakePort({ failing: ["pnpm test"] });
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"] });

    expect(gate.allowsFastPath(await gate.run(cfg, "/w"))).toBe(false);
  });

  it("kapı kapalıyken kestirmeler açık kalır", () => {
    const { port } = fakePort();
    expect(new VerifyGate(port).allowsFastPath(IDLE_VERIFY_REPORT)).toBe(true);
  });
});

describe("kanıt ve özet metinleri", () => {
  it("çalışmamış kapı için kanıt bloğu üretmez", () => {
    expect(verifyEvidence(IDLE_VERIFY_REPORT)).toBe("");
    expect(verifySummary(IDLE_VERIFY_REPORT)).toContain("tanımlı değil");
  });

  it("kırmızı kapıda düşen komutun çıktısını ve disiplin kuralını taşır", async () => {
    const { port } = fakePort({ failing: ["pnpm test"], stdout: { "pnpm test": "2 test başarısız" } });
    const gate = new VerifyGate(port);
    const report = await gate.run(config({ commands: ["pnpm test"] }), "/w");

    const evidence = verifyEvidence(report);
    expect(evidence).toContain("Durum: KIRMIZI");
    expect(evidence).toContain("pnpm test [DÜŞTÜ]");
    expect(evidence).toContain("2 test başarısız");
    expect(evidence).toContain("Kestirme teslimat yapma");
    expect(verifySummary(report)).toContain("KIRMIZI: pnpm test");
  });

  it("yeşil kapıda çıktı gövdesi gömülmez", async () => {
    const { port } = fakePort({ stdout: { "pnpm test": "hepsi geçti, uzun çıktı" } });
    const gate = new VerifyGate(port);
    const report = await gate.run(config({ commands: ["pnpm test"] }), "/w");

    const evidence = verifyEvidence(report);
    expect(evidence).toContain("Durum: YEŞİL");
    expect(evidence).toContain("pnpm test [GEÇTİ]");
    expect(evidence).not.toContain("uzun çıktı");
    expect(verifySummary(report)).toContain("yeşil (1 komut)");
  });

  it("süre aşımını özet ve kanıtta ayrı gösterir", async () => {
    const { port } = fakePort({ timingOut: ["pnpm e2e"] });
    const gate = new VerifyGate(port);
    const report = await gate.run(config({ commands: ["pnpm e2e"] }), "/w");

    expect(verifyEvidence(report)).toContain("[SÜRE AŞIMI]");
    expect(verifySummary(report)).toContain("(süre aşımı)");
  });
});

describe("verify yapılandırma normalizasyonu", () => {
  it("boş ve boşluklu komutları temizler", () => {
    expect(config({ commands: ["  pnpm test  ", "", "   "] }).verify.commands).toEqual(["pnpm test"]);
  });

  it("varsayılan olarak kapı kapalıdır", () => {
    const cfg = normalizeConfig(FALLBACK_CONFIG);
    expect(cfg.verify.commands).toEqual([]);
    expect(cfg.verify.blockOnFailure).toBe(true);
    expect(cfg.verify.maxAttempts).toBe(2);
  });
});
