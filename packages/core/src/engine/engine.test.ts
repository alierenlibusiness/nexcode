import { describe, expect, it, vi } from "vitest";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { Engine, isRiskyPlan, planHash, type EngineDeps, type InvokeInput, type InvokeResult } from "./engine";
import { EngineEventBus, type EngineEvent } from "./events";

/**
 * Motorun uçtan uca davranışı sahte agent süreçleriyle doğrulanır: rol zinciri,
 * PASS hızlı yolu, protokol tekrarı, kurtarma/devir/karantina, onay kapısı ve bütçeler.
 */

const CONSENT = "2026-07-25T00:00:00.000Z";

function makeConfig(over: Partial<NexcodeConfig> = {}): NexcodeConfig {
  return normalizeConfig({
    ...FALLBACK_CONFIG,
    autonomousConsentAcceptedAt: CONSENT,
    agents: {
      ...FALLBACK_CONFIG.agents,
      // Katalogda planner bulunması için: yerleşik altılıda planner yoktur.
      architect: {
        id: "architect",
        name: "Architect",
        role: "planner",
        roleFile: "planner.md",
        connection: "api_only",
        model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      },
    },
    ...over,
  });
}

/** Sahte agent: `responder` her çağrıya agent id + iş türüne göre yanıt üretir. */
function harness(
  responder: (input: InvokeInput, callIndex: number) => InvokeResult | Promise<InvokeResult>,
  configOver: Partial<NexcodeConfig> = {},
  depsOver: Partial<EngineDeps> = {},
) {
  const events: EngineEvent[] = [];
  const bus = new EngineEventBus();
  bus.subscribe((event) => events.push(event));

  const calls: InvokeInput[] = [];
  let index = 0;

  const config = makeConfig(configOver);
  const deps: EngineDeps = {
    config: () => config,
    events: bus,
    invoke: async (input) => {
      calls.push(input);
      return await responder(input, index++);
    },
    loadRole: (file) => Promise.resolve(`# ${file}`),
    matchSkills: () => Promise.resolve([]),
    loadProjectContext: () => Promise.resolve(""),
    writeSpill: () => Promise.resolve(),
    sleep: () => Promise.resolve(),
    now: () => new Date("2026-07-25T12:00:00.000Z"),
    ...depsOver,
  };

  return { engine: new Engine(deps), calls, events, config };
}

function ok(text: string): InvokeResult {
  return { ok: true, text, calls: 1, usdCost: 0.01 };
}

function fail(failure: { message: string; stalled?: boolean; timedOut?: boolean }): InvokeResult {
  return { ok: false, failure, calls: 1, usdCost: 0.005 };
}

const task = { id: "t1", prompt: "Avatar yükleme özelliği ekle", executionMode: "balanced" as const, workingDir: "C:/p" };

const PLAN = JSON.stringify({
  status: "plan",
  planSummary: "Backend endpoint + inceleme",
  acceptanceCriteria: ["POST /avatar 201 döner"],
  assignments: [{ id: "impl", agentId: "backend", kind: "implement", instruction: "Endpoint ekle" }],
});

describe("Engine: mutlu yol", () => {
  it("ilk turda plan → implement → review zincirini kurar ve PASS ile teslim eder", async () => {
    const { engine, calls } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("PLAN ÖZETİ: şemayı genişlet");
      if (input.kind === "implement") return ok("STATUS: COMPLETED\nÖZET: endpoint eklendi");
      return ok("DEĞERLENDİRME: iyi\nVERDICT: PASS");
    });

    const result = await engine.runTask(task);

    expect(result.outcome).toBe("done");
    // Operatör 1 kez çağrıldı: PASS hızlı yolu ikinci değerlendirme çağrısını atladı.
    expect(calls.filter((c) => c.kind === "operator")).toHaveLength(1);
    expect(calls.map((c) => c.kind)).toEqual(["operator", "plan", "implement", "review"]);
    expect(result.rounds).toBe(1);
    expect(result.delegations).toBe(3);
  });

  it("uygulama, planın çıktısını bağlam olarak alır", async () => {
    const { engine, calls } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("ADIMLAR:\n1. avatars tablosu ekle");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    await engine.runTask(task);

    const implPrompt = calls.find((c) => c.kind === "implement")?.prompt ?? "";
    expect(implPrompt).toContain("avatars tablosu ekle");
    expect(implPrompt).toContain("ÖNCEKİ ADIMLARIN ÇIKTISI");
  });

  it("passFastPath kapalıysa ikinci operatör değerlendirmesini yapar", async () => {
    const { engine, calls } = harness(
      (input, i) => {
        if (input.kind === "operator") {
          return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"Bitti","verification":"testler geçti"}');
        }
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: PASS");
      },
      { operator: { ...FALLBACK_CONFIG.operator, agentId: "ceo", passFastPath: false } },
    );

    const result = await engine.runTask(task);
    expect(calls.filter((c) => c.kind === "operator")).toHaveLength(2);
    expect(result.final).toBe("Bitti");
  });

  it("operatör doğrudan yanıt verebilir: delegasyon açmaz", async () => {
    const { engine, calls } = harness(() =>
      ok('{"status":"complete","final":"Sistemde 64 beceri etkin.","verification":"envanterden okundu"}'),
    );

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    expect(result.final).toContain("64 beceri");
    expect(calls).toHaveLength(1);
    expect(result.delegations).toBe(0);
  });
});

describe("Engine: inceleme ve turlar", () => {
  it("FAIL sonrası ikinci turda hedefli düzeltme açar ve PASS ile biter", async () => {
    const { engine, calls } = harness((input, i) => {
      if (input.kind === "operator") {
        return i === 0
          ? ok(PLAN)
          : ok(
              JSON.stringify({
                status: "continue",
                assignments: [
                  { id: "fix", agentId: "backend", kind: "implement", instruction: "Token kontrolü ekle" },
                  { id: "recheck", agentId: "security", kind: "review", instruction: "Düzeltmeyi doğrula", dependsOn: ["fix"] },
                ],
              }),
            );
      }
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      // İlk inceleme FAIL, ikinci PASS.
      return calls.filter((c) => c.kind === "review").length === 1
        ? ok("BULGULAR:\n- [CRITICAL] src/auth.ts: token doğrulanmıyor\nVERDICT: FAIL")
        : ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);

    expect(result.rounds).toBe(2);
    expect(result.outcome).toBe("done");
    const fixPrompt = calls.find((c) => c.assignmentId === "fix")?.prompt ?? "";
    expect(fixPrompt).toContain("Token kontrolü ekle");
  });

  it("tur sınırına ulaşınca kısmi teslimat yapar", async () => {
    const { engine } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: FAIL");
    });

    const result = await engine.runTask(task);
    expect(result.rounds).toBe(3);
    expect(result.final).toContain("Tur sınırına ulaşıldı");
  });

  it("kararsız inceleme çıktısını sessizce PASS saymaz", async () => {
    const { engine } = harness((input, i) => {
      if (input.kind === "operator") {
        return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"kapanış"}');
      }
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("Bence iyi görünüyor."); // VERDICT satırı yok
    });

    const result = await engine.runTask(task);
    // Hızlı yol devreye girmedi; karar ikinci turdaki operatör değerlendirmesine kaldı.
    expect(result.rounds).toBe(2);
    expect(result.final).toBe("kapanış");
  });
});

describe("Engine: protokol dayanıklılığı", () => {
  it("bozuk çıktıdan sonra düzeltme talimatıyla yeniden dener", async () => {
    const { engine, calls } = harness((input, i) => {
      if (input.kind === "operator") return i === 0 ? ok("Tabii, hemen başlıyorum!") : ok(PLAN);
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("done");
    const second = calls.filter((c) => c.kind === "operator")[1]?.prompt ?? "";
    expect(second).toContain("PROTOKOL DÜZELTMESİ");
  });

  it("deneme hakkı bitince görevi başarısız sayar", async () => {
    const { engine, calls } = harness(() => ok("hiç JSON yok"));

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("failed");
    expect(result.final).toContain("geçerli bir karar üretemedi");
    // 1 ilk deneme + protocolRetries(2) = 3
    expect(calls).toHaveLength(3);
  });

  it("operatör somut engeli bildirirse görev bloklanır", async () => {
    const { engine } = harness(() => ok('{"status":"blocked","blocked":"Repo salt okunur","needed":"yazma izni"}'));

    const result = await engine.runTask(task);
    expect(result.outcome).toBe("blocked");
    expect(result.final).toContain("Repo salt okunur");
    expect(result.final).toContain("yazma izni");
  });
});

describe("Engine: kurtarma", () => {
  it("geçici hatada aynı agent ile yeniden dener", async () => {
    let implAttempts = 0;
    const { engine } = harness((input, i) => {
      if (input.kind === "operator") {
        return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"tamam"}');
      }
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") {
        implAttempts++;
        return implAttempts === 1 ? fail({ message: "429 Too Many Requests" }) : ok("STATUS: COMPLETED");
      }
      return ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);
    expect(implAttempts).toBe(2);
    expect(result.outcome).toBe("done");
  });

  it("yetki hatasında agent'ı karantinaya alır ve işi devreder", async () => {
    const seen: string[] = [];
    const { engine } = harness((input, i) => {
      if (input.kind === "operator") {
        return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"devredildi"}');
      }
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") {
        seen.push(input.agent.id);
        return input.agent.id === "backend" ? fail({ message: "401 Unauthorized" }) : ok("STATUS: COMPLETED");
      }
      return ok("VERDICT: PASS");
    });

    const result = await engine.runTask(task);
    expect(seen[0]).toBe("backend");
    expect(seen[1]).not.toBe("backend");
    expect(result.outcome).toBe("done");
  });

  it("sessizlik aşımında ilerlemenin korunduğunu bildirir", async () => {
    const { engine } = harness(
      (input, i) => {
        if (input.kind === "operator") {
          return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"kapanış"}');
        }
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return fail({ message: "no output", stalled: true });
        return ok("VERDICT: PASS");
      },
      { resilience: { transientRetries: 0, retryBaseSeconds: 1, maxFailoverAgents: 0 } },
    );

    const result = await engine.runTask(task);
    const history = result.final;
    expect(history).toBeDefined();
    expect(result.outcome).toBe("done");
  });

  it("bağımlı olduğu iş başarısızsa alt işi hiç başlatmaz", async () => {
    const started: string[] = [];
    const { engine } = harness(
      (input, i) => {
        started.push(String(input.assignmentId));
        if (input.kind === "operator") {
          return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"kapanış"}');
        }
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return fail({ message: "segmentation fault" });
        return ok("VERDICT: PASS");
      },
      { resilience: { transientRetries: 0, retryBaseSeconds: 1, maxFailoverAgents: 0 } },
    );

    await engine.runTask(task);
    // auto-review, impl'e bağlı olduğu için hiç çağrılmadı.
    expect(started.filter((id) => id.startsWith("auto-review"))).toHaveLength(0);
  });
});

describe("Engine: güvenlik ve bütçeler", () => {
  it("otonom onay olmadan başlatılmaz", async () => {
    const { engine, calls } = harness(() => ok(PLAN), { autonomousConsentAcceptedAt: null });
    const result = await engine.runTask(task);
    expect(result.outcome).toBe("failed");
    expect(result.final).toContain("Otonom çalışma onayı");
    expect(calls).toHaveLength(0);
  });

  it("günlük çağrı bütçesi dolduğunda görev başlatılmaz", async () => {
    const { engine, calls } = harness(() => ok(PLAN));
    engine.resetSession(FALLBACK_CONFIG.dailyCallBudget);
    const result = await engine.runTask(task);
    expect(result.final).toContain("Günlük çağrı bütçesi");
    expect(calls).toHaveLength(0);
  });

  it("riskli plan reddedilirse görev bloklanır", async () => {
    const requestApproval = vi.fn().mockResolvedValue(false);
    const { engine } = harness(
      () =>
        ok(
          JSON.stringify({
            status: "plan",
            planSummary: "Sunucuya deploy et",
            assignments: [{ id: "d", agentId: "devops", kind: "implement", instruction: "git push && deploy" }],
          }),
        ),
      { approvalMode: "ask" },
      { requestApproval },
    );

    const result = await engine.runTask(task);
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(result.outcome).toBe("blocked");
    expect(result.final).toContain("reddedildi");
  });

  it("riskli olmayan plan onay istemez", async () => {
    const requestApproval = vi.fn().mockResolvedValue(true);
    const { engine } = harness(
      (input, i) => {
        if (input.kind === "operator") {
          return i === 0 ? ok(PLAN) : ok('{"status":"complete","final":"ok"}');
        }
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: PASS");
      },
      { approvalMode: "ask" },
      { requestApproval },
    );

    await engine.runTask(task);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("sandbox açıkken uzmana yazma sınırını bildirir", async () => {
    const { engine, calls } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    await engine.runTask(task);
    expect(calls.find((c) => c.kind === "implement")?.prompt).toContain("DIŞINA yazma");
  });
});

describe("Engine: yaşam döngüsü kancaları", () => {
  it("görev öncesi checkpoint alır ve canlı diff'i durdurur", async () => {
    const createCheckpoint = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue([{ path: "a.ts", action: "modified", added: 2, removed: 0, previewStatus: "ok", hunks: [] }]);
    const startLiveDiff = vi.fn().mockResolvedValue(stop);

    const { engine } = harness(
      (input) => {
        if (input.kind === "operator") return ok(PLAN);
        if (input.kind === "plan") return ok("plan");
        if (input.kind === "implement") return ok("STATUS: COMPLETED");
        return ok("VERDICT: PASS");
      },
      {},
      { createCheckpoint, startLiveDiff },
    );

    const result = await engine.runTask(task);
    expect(createCheckpoint).toHaveBeenCalledWith("t1", "C:/p");
    expect(startLiveDiff).toHaveBeenCalledOnce();
    expect(result.files).toHaveLength(1);
  });

  it("bütçeyi aşan görev metnini dosyaya taşır", async () => {
    const writeSpill = vi.fn().mockResolvedValue(undefined);
    const { engine, calls } = harness(
      () => ok('{"status":"complete","final":"ok"}'),
      { taskPromptCharBudget: 500 },
      { writeSpill },
    );

    const long = { ...task, prompt: `BAŞ${"x".repeat(9000)}SON` };
    const result = await engine.runTask(long);

    expect(writeSpill).toHaveBeenCalledWith("C:/p", ".nexcode/TASK-t1.md", long.prompt);
    expect(calls[0]?.prompt).toContain(".nexcode/TASK-t1.md");
    expect(result.warnings.some((w) => w.includes("taşındı"))).toBe(true);
  });

  it("teslimat sonrası proje profilini revize eder", async () => {
    const reviseProjectContext = vi.fn().mockResolvedValue(undefined);
    const { engine } = harness(() => ok('{"status":"complete","final":"bitti"}'), {}, { reviseProjectContext });

    await engine.runTask(task);
    expect(reviseProjectContext).toHaveBeenCalledWith("C:/p", "bitti");
  });

  it("olay akışında delegasyon, sonuç ve teslimat yayınlanır", async () => {
    const { engine, events } = harness((input) => {
      if (input.kind === "operator") return ok(PLAN);
      if (input.kind === "plan") return ok("plan");
      if (input.kind === "implement") return ok("STATUS: COMPLETED");
      return ok("VERDICT: PASS");
    });

    await engine.runTask(task);

    const types = new Set(events.map((e) => e.type));
    expect(types.has("status")).toBe(true);
    expect(types.has("activity")).toBe(true);
    expect(types.has("message")).toBe(true);
    expect(types.has("result")).toBe(true);
    // Sıra numaraları monoton artar.
    const seqs = events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });
});

describe("planHash / isRiskyPlan", () => {
  it("aynı plan aynı hash'i üretir, değişen plan farklı", () => {
    expect(planHash("a")).toBe(planHash("a"));
    expect(planHash("a")).not.toBe(planHash("b"));
    expect(planHash("")).toHaveLength(16);
  });

  it("riskli desenleri büyük/küçük harften bağımsız yakalar", () => {
    expect(isRiskyPlan("Sonra GIT PUSH yap", ["git push"])).toBe(true);
    expect(isRiskyPlan("testleri çalıştır", ["git push"])).toBe(false);
    expect(isRiskyPlan("her şey", [""])).toBe(false);
  });
});
