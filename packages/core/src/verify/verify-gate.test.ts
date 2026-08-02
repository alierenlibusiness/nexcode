import { describe, it, expect } from "vitest";
import { VerifyGate, verifyEvidence, verifySummary, IDLE_VERIFY_REPORT, type VerifyPort } from "./verify-gate";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";

interface FakeOptions {
  /** Commands that should come back red. */
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
        stderr: failed ? `${command} failed` : "",
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
  it("starts no process when there is no command (opt-in)", async () => {
    const { port, ran } = fakePort();
    const report = await new VerifyGate(port).run(config(), "/w");

    expect(report).toEqual(IDLE_VERIFY_REPORT);
    expect(report.ran).toBe(false);
    expect(ran).toHaveLength(0);
  });

  it("returns green when every command passes", async () => {
    const { port, ran } = fakePort();
    const report = await new VerifyGate(port).run(config({ commands: ["pnpm test", "pnpm lint"] }), "/w");

    expect(report.ran).toBe(true);
    expect(report.ok).toBe(true);
    expect(ran).toEqual(["pnpm test", "pnpm lint"]);
  });

  it("stops at the first red command and does not run the rest", async () => {
    const { port, ran } = fakePort({ failing: ["pnpm typecheck"] });
    const report = await new VerifyGate(port).run(
      config({ commands: ["pnpm typecheck", "pnpm test", "pnpm lint"] }),
      "/w",
    );

    expect(report.ok).toBe(false);
    expect(ran).toEqual(["pnpm typecheck"]);
    expect(report.commands).toHaveLength(1);
  });

  it("marks a timeout separately", async () => {
    const { port } = fakePort({ timingOut: ["pnpm e2e"] });
    const report = await new VerifyGate(port).run(config({ commands: ["pnpm e2e"] }), "/w");

    expect(report.commands[0]?.timedOut).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("increments the attempt counter on every run and reset clears it", async () => {
    const { port } = fakePort({ failing: ["pnpm test"] });
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"] });

    expect((await gate.run(cfg, "/w")).attempt).toBe(1);
    expect((await gate.run(cfg, "/w")).attempt).toBe(2);

    gate.reset();
    expect((await gate.run(cfg, "/w")).attempt).toBe(1);
  });

  it("clips long output in the middle and keeps both ends", async () => {
    const output = `HEAD${"x".repeat(5000)}TAIL the error is here`;
    const { port } = fakePort({ failing: ["pnpm test"], stdout: { "pnpm test": output } });
    const report = await new VerifyGate(port).run(config({ commands: ["pnpm test"], maxOutputChars: 400 }), "/w");

    const clipped = report.commands[0]?.output ?? "";
    expect(clipped.length).toBeLessThan(output.length);
    expect(clipped.startsWith("HEAD")).toBe(true);
    expect(clipped).toContain("characters skipped");
    expect(clipped).toContain("the error is here");
  });
});

describe("VerifyGate.isBlocking", () => {
  it("does not block on a green gate", async () => {
    const { port } = fakePort();
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"] });

    expect(gate.isBlocking(cfg, await gate.run(cfg, "/w"))).toBe(false);
  });

  it("does not block for a gate that never ran", () => {
    const { port } = fakePort();
    expect(new VerifyGate(port).isBlocking(config(), IDLE_VERIFY_REPORT)).toBe(false);
  });

  it("blocks on a red gate until the attempts run out", async () => {
    const { port } = fakePort({ failing: ["pnpm test"] });
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"], maxAttempts: 2 });

    expect(gate.isBlocking(cfg, await gate.run(cfg, "/w"))).toBe(true);
    // The second attempt exhausts the budget: the work is delivered with a warning, not discarded.
    expect(gate.isBlocking(cfg, await gate.run(cfg, "/w"))).toBe(false);
  });

  it("only reports while blockOnFailure is off", async () => {
    const { port } = fakePort({ failing: ["pnpm test"] });
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"], blockOnFailure: false });

    const report = await gate.run(cfg, "/w");
    expect(report.ok).toBe(false);
    expect(gate.isBlocking(cfg, report)).toBe(false);
  });
});

describe("VerifyGate.allowsFastPath", () => {
  it("closes the shortcuts on a red gate", async () => {
    const { port } = fakePort({ failing: ["pnpm test"] });
    const gate = new VerifyGate(port);
    const cfg = config({ commands: ["pnpm test"] });

    expect(gate.allowsFastPath(await gate.run(cfg, "/w"))).toBe(false);
  });

  it("keeps the shortcuts open while the gate is off", () => {
    const { port } = fakePort();
    expect(new VerifyGate(port).allowsFastPath(IDLE_VERIFY_REPORT)).toBe(true);
  });
});

describe("evidence and summary text", () => {
  it("produces no evidence block for a gate that never ran", () => {
    expect(verifyEvidence(IDLE_VERIFY_REPORT)).toBe("");
    expect(verifySummary(IDLE_VERIFY_REPORT)).toContain("No verification gate is defined");
  });

  it("carries the failing command output and the discipline rule on a red gate", async () => {
    const { port } = fakePort({ failing: ["pnpm test"], stdout: { "pnpm test": "2 tests failed" } });
    const gate = new VerifyGate(port);
    const report = await gate.run(config({ commands: ["pnpm test"] }), "/w");

    const evidence = verifyEvidence(report);
    expect(evidence).toContain("Status: RED");
    expect(evidence).toContain("pnpm test [FAILED]");
    expect(evidence).toContain("2 tests failed");
    expect(evidence).toContain("Do not take a delivery shortcut");
    expect(verifySummary(report)).toContain("RED: pnpm test");
  });

  it("does not embed the output body on a green gate", async () => {
    const { port } = fakePort({ stdout: { "pnpm test": "all passed, long output" } });
    const gate = new VerifyGate(port);
    const report = await gate.run(config({ commands: ["pnpm test"] }), "/w");

    const evidence = verifyEvidence(report);
    expect(evidence).toContain("Status: GREEN");
    expect(evidence).toContain("pnpm test [PASSED]");
    expect(evidence).not.toContain("long output");
    expect(verifySummary(report)).toContain("green (1 commands)");
  });

  it("shows a timeout separately in the summary and the evidence", async () => {
    const { port } = fakePort({ timingOut: ["pnpm e2e"] });
    const gate = new VerifyGate(port);
    const report = await gate.run(config({ commands: ["pnpm e2e"] }), "/w");

    expect(verifyEvidence(report)).toContain("[TIMED OUT]");
    expect(verifySummary(report)).toContain("(timed out)");
  });
});

describe("verify configuration normalisation", () => {
  it("cleans empty and whitespace-only commands", () => {
    expect(config({ commands: ["  pnpm test  ", "", "   "] }).verify.commands).toEqual(["pnpm test"]);
  });

  it("keeps the gate off by default", () => {
    const cfg = normalizeConfig(FALLBACK_CONFIG);
    expect(cfg.verify.commands).toEqual([]);
    expect(cfg.verify.blockOnFailure).toBe(true);
    expect(cfg.verify.maxAttempts).toBe(2);
  });
});
