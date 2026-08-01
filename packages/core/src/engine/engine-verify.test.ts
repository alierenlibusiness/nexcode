import { describe, expect, it } from "vitest";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { Engine, type EngineDeps, type InvokeInput, type InvokeResult } from "./engine";
import { EngineEventBus, type EngineEvent } from "./events";
import { VerifyGate, type VerifyPort } from "../verify/verify-gate";

/**
 * Doğrulama kapısının motor içindeki davranışı.
 *
 * Sınanan sözleşme: kapı kırmızıyken teslimat kestirmeleri kapanır ve operatörün
 * "tamamlandı" kararı bir kez reddedilir; buna rağmen iş asla çöpe atılmaz.
 */

const CONSENT = "2026-07-25T00:00:00.000Z";

const PLAN = JSON.stringify({
  status: "plan",
  planSummary: "Endpoint ekle",
  acceptanceCriteria: ["POST /avatar 201 döner"],
  assignments: [{ id: "impl", agentId: "backend", kind: "implement", instruction: "Endpoint ekle" }],
});

const COMPLETE = JSON.stringify({ status: "complete", final: "Bitti", verification: "testleri çalıştırdım" });

const task = { id: "t1", prompt: "Avatar yükleme ekle", executionMode: "balanced" as const, workingDir: "C:/p" };

function makeConfig(over: Partial<NexcodeConfig> = {}): NexcodeConfig {
  return normalizeConfig({ ...FALLBACK_CONFIG, autonomousConsentAcceptedAt: CONSENT, ...over });
}

/** Belirtilen komutları kırmızı döndüren sahte kapı portu. */
function gatePort(failing: string[]): { port: VerifyPort; ran: string[]; cwds: string[] } {
  const ran: string[] = [];
  const cwds: string[] = [];
  return {
    ran,
    cwds,
    port: {
      runShell: ({ command, cwd }) => {
        ran.push(command);
        cwds.push(cwd);
        const failed = failing.includes(command);
        return Promise.resolve({ ok: !failed, stdout: failed ? "2 test düştü" : "hepsi geçti", stderr: "" });
      },
    },
  };
}

function harness(
  responder: (input: InvokeInput, callIndex: number) => InvokeResult,
  options: { failing?: string[]; commands?: string[]; configOver?: Partial<NexcodeConfig> } = {},
) {
  const events: EngineEvent[] = [];
  const bus = new EngineEventBus();
  bus.subscribe((event) => events.push(event));

  const calls: InvokeInput[] = [];
  let index = 0;

  const { port, ran, cwds } = gatePort(options.failing ?? []);
  const config = makeConfig({
    verify: { ...FALLBACK_CONFIG.verify, commands: options.commands ?? ["pnpm test"] },
    ...options.configOver,
  });

  const deps: EngineDeps = {
    config: () => config,
    events: bus,
    invoke: (input) => {
      calls.push(input);
      return Promise.resolve(responder(input, index++));
    },
    loadRole: (file) => Promise.resolve(`# ${file}`),
    matchSkills: () => Promise.resolve([]),
    loadProjectContext: () => Promise.resolve(""),
    writeSpill: () => Promise.resolve(),
    verifyGate: new VerifyGate(port),
    sleep: () => Promise.resolve(),
    now: () => new Date("2026-07-25T12:00:00.000Z"),
  };

  return { engine: new Engine(deps), calls, events, gateRan: ran, gateCwds: cwds };
}

function ok(text: string): InvokeResult {
  return { ok: true, text, calls: 1, usdCost: 0.01 };
}

/** Plan turu sonrası her operatör çağrısında "tamamlandı" diyen ısrarcı operatör. */
function stubbornOperator(input: InvokeInput, i: number): InvokeResult {
  if (input.kind === "operator") return i === 0 ? ok(PLAN) : ok(COMPLETE);
  if (input.kind === "implement") return ok("STATUS: COMPLETED");
  return ok("VERDICT: PASS");
}

describe("Doğrulama kapısı: motor entegrasyonu", () => {
  it("komut tanımlı değilken kapı hiç çalışmaz ve PASS hızlı yolu korunur", async () => {
    const { engine, calls, gateRan } = harness(
      (input) => {
        if (input.kind === "operator") return ok(PLAN);
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: PASS");
      },
      { commands: [] },
    );

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(gateRan).toHaveLength(0);
    // Hızlı yol korundu: ikinci operatör değerlendirmesi yok.
    expect(calls.filter((c) => c.kind === "operator")).toHaveLength(1);
  });

  it("yeşil kapı hızlı yolu bozmaz ve sonucu doğrulamaya yazar", async () => {
    const { engine, calls, gateRan } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(gateRan).toEqual(["pnpm test"]);
    expect(calls.filter((c) => c.kind === "operator")).toHaveLength(1);
    expect(result.verification).toContain("yeşil");
  });

  it("kırmızı kapı PASS hızlı yolunu kapatır ve kararı operatöre taşır", async () => {
    const { engine, calls } = harness(stubbornOperator, { failing: ["pnpm test"] });

    await engine.runTask(task);
    // Hızlı yol kapandığı için ikinci bir operatör değerlendirmesi yapıldı.
    expect(calls.filter((c) => c.kind === "operator").length).toBeGreaterThan(1);
  });

  it("kırmızı kapıya rağmen verilen tamamlama kararını bir kez reddeder", async () => {
    const { engine, events } = harness(stubbornOperator, { failing: ["pnpm test"] });

    const result = await engine.runTask(task);
    expect(result.warnings.some((w) => w.includes("tamamlama kararı reddedildi"))).toBe(true);

    const blocked = events.filter(
      (e) => e.type === "log" && e.payload.message === "Doğrulama kapısı teslimatı engelledi",
    );
    expect(blocked).toHaveLength(1);
  });

  it("ısrarcı operatörde iş çöpe atılmaz, uyarıyla teslim edilir", async () => {
    const { engine } = harness(stubbornOperator, { failing: ["pnpm test"] });

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(result.final).toBe("Bitti");
    // Modelin beyanı korunur ama gerçek kapı sonucu da doğrulamaya işlenir.
    expect(result.verification).toContain("testleri çalıştırdım");
    expect(result.verification).toContain("KIRMIZI");
  });

  it("blockOnFailure kapalıyken kırmızı kapı teslimatı engellemez", async () => {
    const { engine, events } = harness(stubbornOperator, {
      failing: ["pnpm test"],
      configOver: { verify: { ...FALLBACK_CONFIG.verify, commands: ["pnpm test"], blockOnFailure: false } },
    });

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(
      events.some((e) => e.type === "log" && e.payload.message === "Doğrulama kapısı teslimatı engelledi"),
    ).toBe(false);
  });

  it("kapı sonucunu operatörün bir sonraki prompt'una kanıt olarak gömer", async () => {
    const { engine, calls } = harness(stubbornOperator, { failing: ["pnpm test"] });
    await engine.runTask(task);

    const secondOperatorPrompt = calls.filter((c) => c.kind === "operator")[1]?.prompt ?? "";
    expect(secondOperatorPrompt).toContain("DOĞRULAMA KAPISI");
    expect(secondOperatorPrompt).toContain("Durum: KIRMIZI");
    expect(secondOperatorPrompt).toContain("2 test düştü");
    expect(secondOperatorPrompt).toContain("Kestirme teslimat yapma");
  });

  it("kapı, izole ağaç dahil görevin çalışma dizininde koşar", async () => {
    const { engine, gateCwds } = harness(stubbornOperator, { failing: ["pnpm test"] });
    await engine.runTask({ ...task, workingDir: "C:/wt/t1", projectDir: "C:/repo" });

    // Kapı izole ağacı doğrular; özgün depoyu değil.
    expect(gateCwds).toEqual(["C:/wt/t1"]);
  });

  it("yalnızca ataması olan turlarda koşar ve o turlarda yeniden denenir", async () => {
    // Her turda yeni bir uygulama planı üretip inceleme FAIL dönerse kapı her turda çalışır.
    const { engine, gateRan } = harness(
      (input) => {
        if (input.kind === "operator") return ok(PLAN);
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: FAIL\nBLOKLAYICI: eksik test");
      },
      {
        failing: ["pnpm test"],
        configOver: { operator: { ...FALLBACK_CONFIG.operator, maxRounds: 3 } },
      },
    );

    await engine.runTask(task);
    expect(gateRan).toEqual(["pnpm test", "pnpm test", "pnpm test"]);
  });

  it("kırmızı kapı, tur bütçesi bitince kalan riske yazılır", async () => {
    const { engine } = harness(
      (input) => {
        if (input.kind === "operator") return ok(PLAN);
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: FAIL\nBLOKLAYICI: eksik test");
      },
      {
        failing: ["pnpm test"],
        configOver: { operator: { ...FALLBACK_CONFIG.operator, maxRounds: 1 } },
      },
    );

    const result = await engine.runTask(task);
    expect(result.remainingRisk).toContain("KIRMIZI");
    expect(result.warnings.some((w) => w.includes("KIRMIZI"))).toBe(true);
  });
});

describe("Proje profili dizini", () => {
  it("izolasyon varken profil özgün depodan okunur, izole ağaçtan değil", async () => {
    const readFrom: string[] = [];
    const revisedIn: string[] = [];

    const deps: EngineDeps = {
      config: () => makeConfig({ verify: { ...FALLBACK_CONFIG.verify, commands: [] } }),
      events: new EngineEventBus(),
      invoke: () => Promise.resolve(ok(COMPLETE)),
      loadRole: () => Promise.resolve("# operator"),
      matchSkills: () => Promise.resolve([]),
      loadProjectContext: (dir) => {
        readFrom.push(dir);
        return Promise.resolve("profil");
      },
      reviseProjectContext: (dir) => {
        revisedIn.push(dir);
        return Promise.resolve();
      },
      writeSpill: () => Promise.resolve(),
      sleep: () => Promise.resolve(),
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    };

    await new Engine(deps).runTask({ ...task, workingDir: "C:/wt/t1", projectDir: "C:/repo" });

    expect(readFrom).toEqual(["C:/repo"]);
    expect(revisedIn).toEqual(["C:/repo"]);
  });

  it("izolasyon yokken projectDir çalışma dizinine düşer", async () => {
    const readFrom: string[] = [];

    const deps: EngineDeps = {
      config: () => makeConfig({ verify: { ...FALLBACK_CONFIG.verify, commands: [] } }),
      events: new EngineEventBus(),
      invoke: () => Promise.resolve(ok(COMPLETE)),
      loadRole: () => Promise.resolve("# operator"),
      matchSkills: () => Promise.resolve([]),
      loadProjectContext: (dir) => {
        readFrom.push(dir);
        return Promise.resolve("");
      },
      writeSpill: () => Promise.resolve(),
      sleep: () => Promise.resolve(),
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    };

    await new Engine(deps).runTask(task);
    expect(readFrom).toEqual(["C:/p"]);
  });
});
