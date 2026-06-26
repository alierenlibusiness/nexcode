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
  candidates: [{ content: { parts: [{ text: "deploy planı hazır" }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 },
};

const req: CompletionRequest = {
  model: "gemini-3.5-flash",
  system: "Sen DevOps agent'ısın.",
  messages: [{ role: "user", content: "CI pipeline kur" }],
};

describe("GoogleAdapter.complete (sözleşme testi)", () => {
  it("kayıtlı yanıtı doğru parse eder", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(recorded)) as unknown as typeof fetch;
    const adapter = new GoogleAdapter({ apiKey: "g-key", fetchFn });

    const result = await adapter.complete(req);

    expect(result.text).toBe("deploy planı hazır");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
    expect(result.stopReason).toBe("STOP");
  });

  it("model + key URL'de, systemInstruction ve model rolüyle çağırır", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(recorded)) as unknown as typeof fetch;
    const adapter = new GoogleAdapter({ apiKey: "g-key", fetchFn });
    await adapter.complete({
      ...req,
      messages: [
        { role: "user", content: "Selam" },
        { role: "assistant", content: "Merhaba" },
      ],
    });

    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(String(url)).toContain("/models/gemini-3.5-flash:generateContent?key=g-key");
    const sent = JSON.parse(String(init?.body)) as {
      contents: { role: string }[];
      systemInstruction?: { parts: { text: string }[] };
    };
    expect(sent.systemInstruction?.parts[0]?.text).toBe("Sen DevOps agent'ısın.");
    expect(sent.contents[1]?.role).toBe("model");
  });

  it("hatalı status'ta hata fırlatır", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: "bad" }, 400)) as unknown as typeof fetch;
    const adapter = new GoogleAdapter({ apiKey: "g-key", fetchFn });
    await expect(adapter.complete(req)).rejects.toThrow(/Google Gemini API 400/);
  });
});
