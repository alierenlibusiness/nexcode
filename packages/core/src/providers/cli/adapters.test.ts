import { describe, expect, it } from "vitest";
import {
  CLI_ADAPTER_SPECS,
  effectiveInvocation,
  hasExplicitModelArg,
  materializePrompt,
  specFor,
} from "./adapters";

describe("specFor", () => {
  it("bilinen adapter'ları çözer", () => {
    expect(specFor("claude")?.label).toBe("Claude Code");
    expect(specFor("opencode")?.promptMode).toBe("file");
  });

  it("custom ve tanımsız adapter için spec vermez", () => {
    expect(specFor("custom")).toBeUndefined();
    expect(specFor(undefined)).toBeUndefined();
  });
});

describe("CLI_ADAPTER_SPECS", () => {
  it("her adapter non-interactive varsayılan argümanlarla gelir", () => {
    for (const spec of Object.values(CLI_ADAPTER_SPECS)) {
      expect(spec.defaultArgs.length).toBeGreaterThan(0);
      expect(spec.binaries.length).toBeGreaterThan(0);
    }
  });

  it("Gemini modeli CLI varsayılanına bırakır", () => {
    expect(CLI_ADAPTER_SPECS.gemini.modelArgs("gemini-3.5-flash")).toEqual([]);
  });

  it("OpenCode otonom izin ortamını taşır", () => {
    expect(CLI_ADAPTER_SPECS.opencode.env).toBeDefined();
  });
});

describe("hasExplicitModelArg", () => {
  it("açık model argümanını tanır", () => {
    expect(hasExplicitModelArg(["--model", "x"])).toBe(true);
    expect(hasExplicitModelArg(["-m", "x"])).toBe(true);
    expect(hasExplicitModelArg(["--model=x"])).toBe(true);
    expect(hasExplicitModelArg(["-p"])).toBe(false);
  });
});

describe("effectiveInvocation", () => {
  it("agent override'ı global ayarın önüne koyar", () => {
    const invocation = effectiveInvocation({
      adapter: "claude",
      profileArgs: [],
      agentModel: "claude-opus-4-8",
      globalModel: "claude-sonnet-4-6",
    });
    expect(invocation.args).toContain("claude-opus-4-8");
    expect(invocation.args).not.toContain("claude-sonnet-4-6");
  });

  it("agent override yoksa global ayarı uygular", () => {
    const invocation = effectiveInvocation({
      adapter: "claude",
      profileArgs: [],
      agentModel: "",
      globalModel: "claude-sonnet-4-6",
    });
    expect(invocation.args).toContain("claude-sonnet-4-6");
  });

  it("model boşken argüman eklemez: CLI varsayılanı kullanılır", () => {
    const invocation = effectiveInvocation({ adapter: "claude", profileArgs: [], agentModel: "", globalModel: "" });
    expect(invocation.args).not.toContain("--model");
  });

  it("profilde açık model argümanı varsa yinelemez", () => {
    const invocation = effectiveInvocation({
      adapter: "claude",
      profileArgs: ["-p", "--model", "elle-secilen"],
      agentModel: "override",
      globalModel: "global",
    });
    expect(invocation.args.filter((arg) => arg === "--model")).toHaveLength(1);
    expect(invocation.args).toContain("elle-secilen");
  });

  it("adapter'a özgü sessizlik sınırını taşır", () => {
    expect(effectiveInvocation({ adapter: "codex", profileArgs: [], agentModel: "", globalModel: "" }).silenceSeconds).toBe(180);
    expect(effectiveInvocation({ adapter: "opencode", profileArgs: [], agentModel: "", globalModel: "" }).silenceSeconds).toBe(300);
  });

  it("bilinmeyen adapter'da profil argümanlarını olduğu gibi kullanır", () => {
    const invocation = effectiveInvocation({
      adapter: "custom",
      profileArgs: ["--özel"],
      agentModel: "x",
      globalModel: "y",
    });
    expect(invocation.args).toEqual(["--özel"]);
    expect(invocation.silenceSeconds).toBe(300);
  });

  it("prompt yer tutucularını argümanlara ekler", () => {
    expect(effectiveInvocation({ adapter: "codex", profileArgs: [], agentModel: "", globalModel: "" }).args).toContain(
      "{PROMPT}",
    );
    expect(
      effectiveInvocation({ adapter: "opencode", profileArgs: [], agentModel: "", globalModel: "" }).args,
    ).toContain("{PROMPT_FILE}");
  });
});

describe("materializePrompt", () => {
  it("prompt yer tutucusunu doldurur", () => {
    expect(materializePrompt(["exec", "{PROMPT}"], "merhaba", null)).toEqual(["exec", "merhaba"]);
  });

  it("dosya yer tutucusunu doldurur", () => {
    expect(materializePrompt(["run", "{PROMPT_FILE}"], "x", "/tmp/p.md")).toEqual(["run", "/tmp/p.md"]);
  });

  it("yer tutucu olmayan argümanlara dokunmaz", () => {
    expect(materializePrompt(["-p", "--json"], "x", null)).toEqual(["-p", "--json"]);
  });
});
