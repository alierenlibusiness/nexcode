import { describe, expect, it } from "vitest";
import {
  CLI_ADAPTER_SPECS,
  effectiveInvocation,
  hasExplicitModelArg,
  materializePrompt,
  specFor,
} from "./adapters";

describe("specFor", () => {
  it("resolves the known adapters", () => {
    expect(specFor("claude")?.label).toBe("Claude Code");
    expect(specFor("opencode")?.promptMode).toBe("file");
  });

  it("returns no spec for the custom and undefined adapters", () => {
    expect(specFor("custom")).toBeUndefined();
    expect(specFor(undefined)).toBeUndefined();
  });
});

describe("CLI_ADAPTER_SPECS", () => {
  it("gives every adapter non-interactive default arguments", () => {
    for (const spec of Object.values(CLI_ADAPTER_SPECS)) {
      expect(spec.defaultArgs.length).toBeGreaterThan(0);
      expect(spec.binaries.length).toBeGreaterThan(0);
    }
  });

  it("leaves the Gemini model to the CLI default", () => {
    expect(CLI_ADAPTER_SPECS.gemini.modelArgs("gemini-3.5-flash")).toEqual([]);
  });

  it("carries the OpenCode autonomous permission environment", () => {
    expect(CLI_ADAPTER_SPECS.opencode.env).toBeDefined();
  });
});

describe("hasExplicitModelArg", () => {
  it("recognises an explicit model argument", () => {
    expect(hasExplicitModelArg(["--model", "x"])).toBe(true);
    expect(hasExplicitModelArg(["-m", "x"])).toBe(true);
    expect(hasExplicitModelArg(["--model=x"])).toBe(true);
    expect(hasExplicitModelArg(["-p"])).toBe(false);
  });
});

describe("effectiveInvocation", () => {
  it("puts the agent override ahead of the global setting", () => {
    const invocation = effectiveInvocation({
      adapter: "claude",
      profileArgs: [],
      agentModel: "claude-opus-4-8",
      globalModel: "claude-sonnet-4-6",
    });
    expect(invocation.args).toContain("claude-opus-4-8");
    expect(invocation.args).not.toContain("claude-sonnet-4-6");
  });

  it("applies the global setting when there is no agent override", () => {
    const invocation = effectiveInvocation({
      adapter: "claude",
      profileArgs: [],
      agentModel: "",
      globalModel: "claude-sonnet-4-6",
    });
    expect(invocation.args).toContain("claude-sonnet-4-6");
  });

  it("adds no argument when the model is empty: the CLI default is used", () => {
    const invocation = effectiveInvocation({ adapter: "claude", profileArgs: [], agentModel: "", globalModel: "" });
    expect(invocation.args).not.toContain("--model");
  });

  it("does not duplicate an explicit model argument from the profile", () => {
    const invocation = effectiveInvocation({
      adapter: "claude",
      profileArgs: ["-p", "--model", "hand-picked"],
      agentModel: "override",
      globalModel: "global",
    });
    expect(invocation.args.filter((arg) => arg === "--model")).toHaveLength(1);
    expect(invocation.args).toContain("hand-picked");
  });

  it("carries the adapter specific silence limit", () => {
    expect(effectiveInvocation({ adapter: "codex", profileArgs: [], agentModel: "", globalModel: "" }).silenceSeconds).toBe(180);
    expect(effectiveInvocation({ adapter: "opencode", profileArgs: [], agentModel: "", globalModel: "" }).silenceSeconds).toBe(300);
  });

  it("uses the profile arguments as they are for an unknown adapter", () => {
    const invocation = effectiveInvocation({
      adapter: "custom",
      profileArgs: ["--custom"],
      agentModel: "x",
      globalModel: "y",
    });
    expect(invocation.args).toEqual(["--custom"]);
    expect(invocation.silenceSeconds).toBe(300);
  });

  it("appends the prompt placeholders to the arguments", () => {
    expect(effectiveInvocation({ adapter: "codex", profileArgs: [], agentModel: "", globalModel: "" }).args).toContain(
      "{PROMPT}",
    );
    expect(
      effectiveInvocation({ adapter: "opencode", profileArgs: [], agentModel: "", globalModel: "" }).args,
    ).toContain("{PROMPT_FILE}");
  });
});

describe("materializePrompt", () => {
  it("fills in the prompt placeholder", () => {
    expect(materializePrompt(["exec", "{PROMPT}"], "hello", null)).toEqual(["exec", "hello"]);
  });

  it("fills in the file placeholder", () => {
    expect(materializePrompt(["run", "{PROMPT_FILE}"], "x", "/tmp/p.md")).toEqual(["run", "/tmp/p.md"]);
  });

  it("leaves arguments without a placeholder untouched", () => {
    expect(materializePrompt(["-p", "--json"], "x", null)).toEqual(["-p", "--json"]);
  });
});

describe("autonomous execution flags", () => {
  /**
   * Agents run non-interactively; the moment a permission prompt appears the process waits
   * silently and fails on the silence timeout. Without these flags no file can be written.
   */
  it("makes Claude Code apply file edits without asking", () => {
    const args = effectiveInvocation({ adapter: "claude", profileArgs: [], agentModel: "", globalModel: "" }).args;
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
  });

  it("confines Codex model commands to the working directory", () => {
    const args = effectiveInvocation({ adapter: "codex", profileArgs: [], agentModel: "", globalModel: "" }).args;
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("workspace-write");
  });

  it("never lets an adapter disable the CLI guards entirely", () => {
    // Isolation, the approval gate and checkpoints are our layer's job; disabling all of
    // the CLI's guards would make those layers meaningless.
    const forbidden = [
      "--dangerously-skip-permissions",
      "--allow-dangerously-skip-permissions",
      "--dangerously-bypass-approvals-and-sandbox",
      "bypassPermissions",
      "danger-full-access",
    ];

    for (const adapter of ["claude", "codex", "gemini", "opencode", "antigravity"] as const) {
      const args = effectiveInvocation({ adapter, profileArgs: [], agentModel: "", globalModel: "" }).args;
      for (const flag of forbidden) {
        expect(args, `${adapter} must not use ${flag}`).not.toContain(flag);
      }
    }
  });
});
