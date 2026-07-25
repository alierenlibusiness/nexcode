import { describe, expect, it } from "vitest";
import { normalizeConfig, type NexcodeConfig } from "./config/schema";
import { FALLBACK_CONFIG } from "./config/defaults";
import { formatDoctorReport, runDoctor, type DoctorInput } from "./doctor";
import { HEALTH_CONTRACT_VERSION } from "./providers/cli/health";

function input(over: Partial<DoctorInput> = {}): DoctorInput {
  return {
    config: normalizeConfig({ ...FALLBACK_CONFIG, autonomousConsentAcceptedAt: "2026-07-25T00:00:00.000Z" }),
    discovered: [{ adapter: "claude", command: "C:/npm/claude.cmd", version: "1.2.3" }],
    health: {},
    dataDir: "C:/Users/Ali/AppData/Roaming/NEXCODE",
    providersWithKeys: ["anthropic", "openai", "google", "deepseek"],
    nodeVersion: "v24.18.0",
    platform: "win32",
    ...over,
  };
}

function find(report: ReturnType<typeof runDoctor>, subject: string) {
  return report.diagnostics.find((d) => d.subject === subject);
}

describe("runDoctor", () => {
  it("sağlıklı kurulumu hazır bildirir", () => {
    const report = runDoctor(input());
    expect(report.ready).toBe(true);
    expect(find(report, "Operatör")?.level).toBe("ok");
    expect(find(report, "Node.js")?.level).toBe("ok");
  });

  it("eski Node sürümünü hata sayar", () => {
    const report = runDoctor(input({ nodeVersion: "v20.11.0" }));
    expect(report.ready).toBe(false);
    expect(find(report, "Node.js")?.hint).toContain("22");
  });

  it("otonom onay alınmadıysa hata verir", () => {
    const report = runDoctor(input({ config: FALLBACK_CONFIG }));
    expect(report.ready).toBe(false);
    expect(find(report, "Otonom onay")?.level).toBe("error");
  });

  it("operatör yoksa hata ve somut adım verir", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      autonomousConsentAcceptedAt: "2026-07-25T00:00:00.000Z",
      agents: { be: { id: "be", name: "Backend", role: "executor" } },
      operator: { ...FALLBACK_CONFIG.operator, agentId: "" },
    });
    const report = runDoctor(input({ config }));
    expect(find(report, "Operatör")?.level).toBe("error");
    expect(find(report, "Operatör")?.hint).toContain("operator");
  });

  it("uzman yoksa hata verir", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      autonomousConsentAcceptedAt: "2026-07-25T00:00:00.000Z",
      agents: { ceo: FALLBACK_CONFIG.agents.ceo as NexcodeConfig["agents"][string] },
    });
    const report = runDoctor(input({ config }));
    expect(find(report, "Uzmanlar")?.level).toBe("error");
    expect(report.ready).toBe(false);
  });

  it("reviewer yokken uyarır ama hazır olmayı engellemez", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      autonomousConsentAcceptedAt: "2026-07-25T00:00:00.000Z",
      agents: {
        ceo: FALLBACK_CONFIG.agents.ceo as NexcodeConfig["agents"][string],
        be: { id: "be", name: "Backend", role: "executor", connection: "cli_only" },
      },
    });
    const report = runDoctor(input({ config }));
    expect(find(report, "İnceleme")?.level).toBe("warn");
    expect(report.ready).toBe(true);
  });

  it("kurulu CLI yoksa uyarır", () => {
    const report = runDoctor(input({ discovered: [] }));
    expect(find(report, "CLI")?.level).toBe("warn");
    expect(report.ready).toBe(true);
  });

  it("sağlıksız agent'ı gerekçe ve çözüm adımıyla raporlar", () => {
    const report = runDoctor(
      input({
        health: {
          "cli-codex": {
            status: "auth",
            checkedAt: "2026-07-25T10:00:00.000Z",
            contractVersion: HEALTH_CONTRACT_VERSION,
            detail: "not logged in",
          },
        },
      }),
    );
    const entry = find(report, "Sağlık · cli-codex");
    expect(entry?.level).toBe("error");
    expect(entry?.hint).toContain("oturum açın");
  });

  it("sağlıklı agent için satır üretmez", () => {
    const report = runDoctor(
      input({
        health: {
          ok1: { status: "ready", checkedAt: "2026-07-25T10:00:00.000Z", contractVersion: HEALTH_CONTRACT_VERSION, detail: "" },
        },
      }),
    );
    expect(find(report, "Sağlık · ok1")).toBeUndefined();
  });

  it("eksik API anahtarlarını uyarı olarak listeler", () => {
    const report = runDoctor(input({ providersWithKeys: [] }));
    const entry = find(report, "API anahtarları");
    expect(entry?.level).toBe("warn");
    expect(entry?.message).toContain("anthropic");
  });

  it("çok düşük bütçeyi uyarır", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      autonomousConsentAcceptedAt: "2026-07-25T00:00:00.000Z",
      dailyCallBudget: 5,
    });
    expect(find(runDoctor(input({ config })), "Bütçe")?.level).toBe("warn");
  });
});

describe("formatDoctorReport", () => {
  it("teşhisleri simgelerle ve çözüm adımlarıyla yazar", () => {
    const text = formatDoctorReport(runDoctor(input({ nodeVersion: "v18.0.0" })));
    expect(text).toContain("✗ Node.js");
    expect(text).toContain("→ ");
    expect(text).toContain("giderilmelidir");
  });

  it("sağlıklı kurulumda olumlu sonuç yazar", () => {
    expect(formatDoctorReport(runDoctor(input()))).toContain("motor görev alabilir");
  });
});
