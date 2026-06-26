import { describe, it, expect, vi } from "vitest";
import { AntigravityCliAdapter, parseAntigravityOutput } from "./antigravity";
import type { CliRunner } from "./runner";
import type { CompletionRequest } from "../types";

const req: CompletionRequest = {
  model: "gemini-3.5-flash",
  system: "Sen DevOps agent'ısın.",
  messages: [{ role: "user", content: "Dockerfile üret" }],
};

describe("AntigravityCliAdapter (CLI modu)", () => {
  it("JSON zarfını parse eder ve doğru argümanlarla çağırır", async () => {
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

  it("JSON olmayan düz metin çıktısını sonuç sayar (toleranslı)", () => {
    const parsed = parseAntigravityOutput("sadece düz metin yanıt");
    expect(parsed.text).toBe("sadece düz metin yanıt");
    expect(parsed.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("CLI maliyeti abonelik havuzuna yazılır (usd=0)", () => {
    const adapter = new AntigravityCliAdapter();
    expect(adapter.estimateCost(req).usd).toBe(0);
  });
});
