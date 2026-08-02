import { describe, it, expect, vi } from "vitest";
import { AntigravityCliAdapter, parseAntigravityOutput } from "./antigravity";
import type { CliRunner } from "./runner";
import type { CompletionRequest } from "../types";

const req: CompletionRequest = {
  model: "gemini-3.5-flash",
  system: "You are the DevOps agent.",
  messages: [{ role: "user", content: "Generate a Dockerfile" }],
};

describe("AntigravityCliAdapter (CLI mode)", () => {
  it("parses the JSON envelope and calls with the right arguments", async () => {
    const runner = vi.fn<CliRunner>(async () => ({
      stdout: JSON.stringify({ response: "FROM node:22", stats: { tokens: { input: 15, output: 6 } } }),
      stderr: "",
      exitCode: 0,
    }));
    const adapter = new AntigravityCliAdapter({ runner });

    const result = await adapter.complete(req);
    expect(result.text).toBe("FROM node:22");
    expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 6 });

    const [binary, args] = runner.mock.calls[0]!;
    expect(binary).toBe("antigravity");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
  });

  it("tolerantly treats non-JSON plain text output as the result", () => {
    const parsed = parseAntigravityOutput("just a plain text answer");
    expect(parsed.text).toBe("just a plain text answer");
    expect(parsed.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("charges CLI cost to the subscription pool (usd=0)", () => {
    const adapter = new AntigravityCliAdapter();
    expect(adapter.estimateCost(req).usd).toBe(0);
  });
});
