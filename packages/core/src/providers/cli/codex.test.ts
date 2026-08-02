import { describe, it, expect, vi } from "vitest";
import { CodexCliAdapter, parseCodexJsonl } from "./codex";
import { CliParseError, type CliRunner } from "./runner";
import type { CompletionRequest } from "../types";

const req: CompletionRequest = {
  model: "gpt-5.5",
  system: "You are the Frontend agent.",
  messages: [{ role: "user", content: "Write a button component" }],
};

const jsonl = [
  JSON.stringify({ type: "item.started", item: { type: "agent_message" } }),
  "garbage non-json log line",
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Here is the button" } }),
  JSON.stringify({ type: "turn.completed", usage: { input_tokens: 30, output_tokens: 12 } }),
].join("\n");

describe("CodexCliAdapter (CLI mode)", () => {
  it("parses the JSONL stream and calls with the right arguments", async () => {
    const runner = vi.fn<CliRunner>(async () => ({ stdout: jsonl, stderr: "", exitCode: 0 }));
    const adapter = new CodexCliAdapter({ runner });

    const result = await adapter.complete(req);
    expect(result.text).toBe("Here is the button");
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 12 });
    expect(adapter.connectionMode).toBe("cli");

    const [binary, args, input] = runner.mock.calls[0]!;
    expect(binary).toBe("codex");
    expect(args).toEqual(["exec", "--json", "--model", "gpt-5.5"]);
    expect(input).toContain("Write a button component");
  });

  it("charges CLI cost to the subscription pool (usd=0)", () => {
    const adapter = new CodexCliAdapter();
    expect(adapter.estimateCost(req).usd).toBe(0);
  });

  it("throws CliParseError when there is no event at all (the API fallback signal)", () => {
    expect(() => parseCodexJsonl("only plain log\nlines")).toThrow(CliParseError);
  });
});
