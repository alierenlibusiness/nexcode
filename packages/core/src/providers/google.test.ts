import { describe, it, expect, vi } from "vitest";
import { GoogleAdapter } from "./google";
import type { CompletionRequest } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const recorded = {
  candidates: [{ content: { parts: [{ text: "the deploy plan is ready" }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 },
};

const req: CompletionRequest = {
  model: "gemini-3.5-flash",
  system: "You are the DevOps agent.",
  messages: [{ role: "user", content: "Set up a CI pipeline" }],
};

describe("GoogleAdapter.complete (contract test)", () => {
  it("parses the recorded response correctly", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(recorded)) as unknown as typeof fetch;
    const adapter = new GoogleAdapter({ apiKey: "g-key", fetchFn });

    const result = await adapter.complete(req);

    expect(result.text).toBe("the deploy plan is ready");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
    expect(result.stopReason).toBe("STOP");
  });

  it("puts the model and key in the URL and sends systemInstruction with the model role", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(recorded)) as unknown as typeof fetch;
    const adapter = new GoogleAdapter({ apiKey: "g-key", fetchFn });
    await adapter.complete({
      ...req,
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
    });

    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(String(url)).toContain("/models/gemini-3.5-flash:generateContent?key=g-key");
    const sent = JSON.parse(String(init?.body)) as {
      contents: { role: string }[];
      systemInstruction?: { parts: { text: string }[] };
    };
    expect(sent.systemInstruction?.parts[0]?.text).toBe("You are the DevOps agent.");
    expect(sent.contents[1]?.role).toBe("model");
  });

  it("throws on a failure status", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "bad" }, 400)) as unknown as typeof fetch;
    const adapter = new GoogleAdapter({ apiKey: "g-key", fetchFn });
    await expect(adapter.complete(req)).rejects.toThrow(/Google Gemini API 400/);
  });
});
