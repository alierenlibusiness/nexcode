import { describe, expect, it } from "vitest";
import {
  ALLOWED_KINDS,
  adapterFromCmd,
  normalizeConfig,
  roleAllowsKind,
  roleForKind,
  silenceSecondsFor,
} from "./schema";
import { FALLBACK_CONFIG } from "./defaults";

describe("normalizeConfig", () => {
  it("boş girdiden geçerli bir config üretir", () => {
    const config = normalizeConfig({});
    expect(config.approvalMode).toBe("auto");
    expect(config.operator.maxRounds).toBe(6);
    expect(config.sandbox.mode).toBe("workspace");
    expect(config.liveDiff).toBe(true);
  });

  it("saftır — girdiyi mutasyona uğratmaz", () => {
    const input = { approvalMode: "ask", agents: { a: { id: "a", name: "A", role: "executor" } } };
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown;
    normalizeConfig(input);
    expect(input).toEqual(snapshot);
  });

  it("idempotenttir — kendi çıktısına yeniden uygulandığında değişmez", () => {
    const once = normalizeConfig({
      approvalMode: "ask",
      riskyPatterns: ["rm -rf", "rm -rf", "git push"],
      agents: { dev: { id: "dev", name: "Dev", role: "executor", cmd: "codex", adapter: "claude" } },
    });
    expect(normalizeConfig(once)).toEqual(once);
    expect(normalizeConfig(FALLBACK_CONFIG)).toEqual(FALLBACK_CONFIG);
  });

  it("bilinen cmd, çelişkili adapter alanını ezer ve eski argümanları temizler", () => {
    const config = normalizeConfig({
      agents: {
        broken: {
          id: "broken",
          name: "Broken",
          role: "executor",
          cmd: "codex",
          adapter: "claude",
          args: ["--dangerously-skip-permissions"],
          model: { provider: "anthropic", modelId: "claude-opus-4-8" },
        },
      },
    });
    expect(config.agents.broken?.adapter).toBe("codex");
    expect(config.agents.broken?.args).toEqual([]);
    // Çelişkide eski model override'ı taşınmaz.
    expect(config.agents.broken?.model).toBeUndefined();
  });

  it("özel wrapper komutlarında açıkça verilmiş adapter korunur", () => {
    const config = normalizeConfig({
      agents: {
        wrapped: { id: "wrapped", name: "Wrapped", role: "executor", cmd: "my-wrapper.sh", adapter: "opencode" },
      },
    });
    expect(config.agents.wrapped?.adapter).toBe("opencode");
  });

  it("keşfedilmiş profildeki kullanıcı seçimi olmayan model global ayarı ezemez", () => {
    const config = normalizeConfig({
      agents: {
        auto: {
          id: "auto",
          name: "Auto",
          role: "executor",
          discovered: true,
          modelOverride: false,
          model: { provider: "openai", modelId: "sistem-onerisi" },
        },
        picked: {
          id: "picked",
          name: "Picked",
          role: "executor",
          discovered: true,
          modelOverride: true,
          model: { provider: "openai", modelId: "kullanici-secimi" },
        },
      },
    });
    expect(config.agents.auto?.model).toBeUndefined();
    expect(config.agents.picked?.model?.modelId).toBe("kullanici-secimi");
  });

  it("agent kayıt anahtarı ile id alanını eşitler", () => {
    const config = normalizeConfig({
      agents: { realKey: { id: "eskiId", name: "X", role: "reviewer" } },
    });
    expect(config.agents.realKey?.id).toBe("realKey");
  });

  it("rol dosyasını rolüyle tutarlı hale getirir, özel dosyayı korur", () => {
    const config = normalizeConfig({
      agents: {
        a: { id: "a", name: "A", role: "reviewer", roleFile: "executor.md" },
        b: { id: "b", name: "B", role: "operator", roleFile: "planner.md" },
        c: { id: "c", name: "C", role: "executor", roleFile: "my-custom-role.md" },
      },
    });
    expect(config.agents.a?.roleFile).toBe("reviewer.md");
    expect(config.agents.b?.roleFile).toBe("operator.md");
    expect(config.agents.c?.roleFile).toBe("my-custom-role.md");
  });

  it("tekrarlı riskli desenleri ve beceri adlarını tekilleştirir", () => {
    const config = normalizeConfig({
      riskyPatterns: ["git push", "git push"],
      skills: { enabled: ["unit-testing", "unit-testing", "debugging"] },
    });
    expect(config.riskyPatterns).toEqual(["git push"]);
    expect(config.skills.enabled).toEqual(["unit-testing", "debugging"]);
  });

  it("geçersiz alanları reddeder", () => {
    expect(() => normalizeConfig({ approvalMode: "belki" })).toThrow();
    expect(() => normalizeConfig({ agents: { x: { id: "x", name: "X", role: "hacker" } } })).toThrow();
  });

  it("bilinmeyen alanları düşürür", () => {
    const config = normalizeConfig({ birSeyler: 42, approvalMode: "ask" });
    expect(config).not.toHaveProperty("birSeyler");
    expect(config.approvalMode).toBe("ask");
  });

  it("zamanlama tetiklerini doğrular", () => {
    const config = normalizeConfig({
      schedules: [
        {
          id: "s1",
          prompt: "Testleri çalıştır",
          trigger: { type: "weekly", at: "09:30", days: [1, 3, 5] },
          createdAt: "2026-07-25T00:00:00.000Z",
        },
      ],
    });
    expect(config.schedules[0]?.enabled).toBe(true);
    expect(config.schedules[0]?.nextRunAt).toBeNull();
    expect(() =>
      normalizeConfig({
        schedules: [{ id: "s", prompt: "p", trigger: { type: "daily", at: "9:30" }, createdAt: "x" }],
      }),
    ).toThrow();
  });
});

describe("rol / görev türü sözleşmesi", () => {
  it("rol izinli görev türünü bağlayıcı biçimde sınırlar", () => {
    expect(roleAllowsKind("executor", "implement")).toBe(true);
    expect(roleAllowsKind("executor", "review")).toBe(false);
    expect(roleAllowsKind("reviewer", "review")).toBe(true);
    expect(roleAllowsKind("reviewer", "implement")).toBe(false);
    expect(roleAllowsKind("planner", "plan")).toBe(true);
    expect(roleAllowsKind("planner", "research")).toBe(true);
    expect(roleAllowsKind("operator", "implement")).toBe(false);
  });

  it("her görev türünü doğru role yönlendirir", () => {
    expect(roleForKind("implement")).toBe("executor");
    expect(roleForKind("review")).toBe("reviewer");
    expect(roleForKind("plan")).toBe("planner");
    expect(roleForKind("research")).toBe("planner");
  });

  it("operatör uzman görevi almaz", () => {
    expect(ALLOWED_KINDS.operator).toEqual([]);
  });
});

describe("adapterFromCmd", () => {
  it("bilinen CLI adlarını platformdan bağımsız tanır", () => {
    expect(adapterFromCmd("claude")).toBe("claude");
    expect(adapterFromCmd("claude-code")).toBe("claude");
    expect(adapterFromCmd("codex.cmd")).toBe("codex");
    expect(adapterFromCmd("C:\\Users\\Ali\\AppData\\npm\\gemini.cmd")).toBe("gemini");
    expect(adapterFromCmd("/usr/local/bin/opencode")).toBe("opencode");
    expect(adapterFromCmd("antigravity.exe")).toBe("antigravity");
  });

  it("tanınmayan komutlar için undefined döner", () => {
    expect(adapterFromCmd("my-wrapper.sh")).toBeUndefined();
    expect(adapterFromCmd(undefined)).toBeUndefined();
    expect(adapterFromCmd("")).toBeUndefined();
  });
});

describe("silenceSecondsFor", () => {
  it("adapter başına sessizlik sınırını uygular", () => {
    expect(silenceSecondsFor("codex")).toBe(180);
    expect(silenceSecondsFor("gemini")).toBe(180);
    expect(silenceSecondsFor("claude")).toBe(240);
    expect(silenceSecondsFor("opencode")).toBe(300);
    expect(silenceSecondsFor(undefined)).toBe(300);
  });
});

describe("FALLBACK_CONFIG", () => {
  it("altı alan agent'ını hazır roller ve bağlantı modlarıyla getirir", () => {
    expect(Object.keys(FALLBACK_CONFIG.agents).sort()).toEqual([
      "backend",
      "ceo",
      "devops",
      "frontend",
      "qa",
      "security",
    ]);
    expect(FALLBACK_CONFIG.agents.ceo?.role).toBe("operator");
    expect(FALLBACK_CONFIG.agents.security?.role).toBe("reviewer");
    expect(FALLBACK_CONFIG.agents.security?.connection).toBe("api_only");
    expect(FALLBACK_CONFIG.agents.devops?.autonomy).toBe("manual");
  });

  it("QA eskalasyon zincirini ucuzdan pahalıya sıralar", () => {
    expect(FALLBACK_CONFIG.escalation.qa.map((m) => m.modelId)).toEqual([
      "deepseek-v4-flash",
      "minimax-m3",
      "claude-sonnet-4-6",
    ]);
  });

  it("otonom onay alınmadan gelir — motor onaysız başlatılamaz", () => {
    expect(FALLBACK_CONFIG.autonomousConsentAcceptedAt).toBeNull();
  });
});
