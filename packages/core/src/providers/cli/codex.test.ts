import { describe, it, expect, vi } from "vitest";
import { CodexCliAdapter, parseCodexJsonl } from "./codex";
import { CliParseError, type CliRunner } from "./runner";
import type { CompletionRequest } from "../types";

const req: CompletionRequest = {
  model: "gpt-5.5",
  system: "Sen Frontend agent'ısın.",
  messages: [{ role: "user", content: "Buton bileşeni yaz" }],
};

const jsonl = [
  JSON.stringify({ type: "item.started", item: { type: "agent_message" } }),
  "garbage non-json log line",
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "İşte buton" } }),
  JSON.stringify({ type: "turn.completed", usage: { input_tokens: 30, output_tokens: 12 } }),
].join("\n");

describe("CodexCliAdapter (CLI modu)", () => {
  it("JSONL akışını parse eder ve doğru argümanlarla çağırır", async () => {
    const runner = vi.fn<CliRunner>(async () => ({ stdout: jsonl, stderr: "", exitCode: 0 }));
    const adapter = new CodexCliAdapter({ runner });

    const result = await adapter.complete(req);
    expect(result.text).toBe("İşte buton");
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 12 });
    expect(adapter.connectionMode).toBe("cli");

    const [binary, args, input] = runner.mock.calls[0]!;
    expect(binary).toBe("codex");
    expect(args).toEqual(["exec", "--json", "--model", "gpt-5.5"]);
    expect(input).toContain("Buton bileşeni yaz");
  });

  it("CLI maliyeti abonelik havuzuna yazılır (usd=0)", () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.estimateCost(req).usd).toBe(0);
  });

  it("hiç olay yoksa CliParseError fırlatır (R3 fallback sinyali)", () => {
    expect(() => parseCodexJsonl("yalnızca düz log\nsatırları")).toThrow(CliParseError);
  });
});
