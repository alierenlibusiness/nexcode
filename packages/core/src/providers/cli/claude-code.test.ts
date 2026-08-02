import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeAdapter } from "./claude-code";
import type { CliRunner } from "./runner";
import type { CompletionRequest } from "../types";

const req: CompletionRequest = {
  model: "claude-opus-4-8",
  system: "You are the CEO agent.",
  messages: [{ role: "user", content: "Make a plan" }],
};

describe("ClaudeCodeAdapter (CLI mode)", () => {
  it("parses the JSON output and calls with the right arguments", async () => {
    const runner = vi.fn<CliRunner>(async () => ({
      stdout: JSON.stringify({
        result: "Here is the plan",
        usage: { input_tokens: 20, output_tokens: 8 },
        total_cost_usd: 0.01,
      }),
      stderr: "",
      exitCode: 0,
    }));
    const adapter = new ClaudeCodeAdapter({ runner });

    const result = await adapter.complete(req);
    expect(result.text).toBe("Here is the plan");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
    expect(adapter.connectionMode).toBe("cli");

    const [binary, args, input] = runner.mock.calls[0]!;
    expect(binary).toBe("claude");
    expect(args).toEqual(["-p", "--output-format", "json", "--model", "claude-opus-4-8"]);
    expect(input).toContain("[system]");
    expect(input).toContain("Make a plan");
  });

  it("throws on a non-zero exit code", async () => {
    const runner = vi.fn<CliRunner>(async () => ({
      stdout: "",
      stderr: "quota exhausted",
      exitCode: 1,
    }));
    const adapter = new ClaudeCodeAdapter({ runner });
    await expect(adapter.complete(req)).rejects.toThrow(/quota exhausted/);
  });

  it("charges CLI cost to the subscription pool (estimateCost usd=0)", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.estimateCost(req).usd).toBe(0);
  });
});
