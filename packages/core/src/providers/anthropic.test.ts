import { describe, it, expect, vi } from "vitest";
import { AnthropicAdapter } from "./anthropic";
import type { CompletionRequest } from "./types";

const recordedResponse = {
  content: [{ type: "text", text: "Merhaba dünya" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 5 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const req: CompletionRequest = {
  model: "claude-opus-4-8",
  system: "Sen bir test agent'ısın.",
  messages: [{ role: "user", content: "Selam" }],
};

describe("AnthropicAdapter.complete (sözleşme testi)", () => {
  it("kayıtlı yanıtı doğru parse eder", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(recordedResponse)) as unknown as typeof fetch;
    const adapter = new AnthropicAdapter({ apiKey: "sk-test", fetchFn });

    const result = await adapter.complete(req);

    expect(result.text).toBe("Merhaba dünya");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(result.stopReason).toBe("end_turn");
  });

  it("doğru endpoint, başlık ve gövde ile çağırır", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(recordedResponse)) as unknown as typeof fetch;
    const adapter = new AnthropicAdapter({ apiKey: "sk-test", fetchFn });
    await adapter.complete(req);

    const mock = vi.mocked(fetchFn);
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const sentBody = JSON.parse(String(init?.body)) as { model: string; system?: string };
    expect(sentBody.model).toBe("claude-opus-4-8");
    expect(sentBody.system).toBe("Sen bir test agent'ısın.");
  });

  it("hatalı status'ta anlamlı hata fırlatır", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: "overloaded" }, 529),
    ) as unknown as typeof fetch;
    const adapter = new AnthropicAdapter({ apiKey: "sk-test", fetchFn });
    await expect(adapter.complete(req)).rejects.toThrow(/Anthropic API 529/);
  });
});

describe("AnthropicAdapter.estimateCost", () => {
  it("gerçek usage ile maliyeti hesaplar (Opus fiyatı)", () => {
    const adapter = new AnthropicAdapter({ apiKey: "sk-test" });
    const cost = adapter.estimateCost(req, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    // Opus: $15 input + $75 output per 1M
    expect(cost.usd).toBeCloseTo(90, 5);
  });
});
