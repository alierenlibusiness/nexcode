import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeAdapter } from "./claude-code";
import type { CliRunner } from "./runner";
import type { CompletionRequest } from "../types";

const req: CompletionRequest = {
  model: "claude-opus-4-8",
  system: "Sen CEO agent'ısın.",
  messages: [{ role: "user", content: "Plan yap" }],
};

describe("ClaudeCodeAdapter (CLI modu)", () => {
  it("JSON çıktıyı parse eder ve doğru argümanlarla çağırır", async () => {
    const runner = vi.fn<CliRunner>(async () => ({
      stdout: JSON.stringify({
        result: "İşte plan",
        usage: { input_tokens: 20, output_tokens: 8 },
        total_cost_usd: 0.01,
      }),
      stderr: "",
      exitCode: 0,
    }));
    const adapter = new ClaudeCodeAdapter({ runner });

    const result = await adapter.complete(req);
    expect(result.text).toBe("İşte plan");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
    expect(adapter.connectionMode).toBe("cli");

    const [binary, args, input] = runner.mock.calls[0]!;
    expect(binary).toBe("claude");
    expect(args).toEqual(["-p", "--output-format", "json", "--model", "claude-opus-4-8"]);
    expect(input).toContain("[system]");
    expect(input).toContain("Plan yap");
  });

  it("sıfır-olmayan exit kodunda hata fırlatır", async () => {
    const runner = vi.fn<CliRunner>(async () => ({
      stdout: "",
      stderr: "kota doldu",
      exitCode: 1,
    }));
    const adapter = new ClaudeCodeAdapter({ runner });
    await expect(adapter.complete(req)).rejects.toThrow(/kota doldu/);
  });

  it("CLI maliyeti abonelik havuzuna yazılır (estimateCost usd=0)", () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.estimateCost(req).usd).toBe(0);
  });
});
