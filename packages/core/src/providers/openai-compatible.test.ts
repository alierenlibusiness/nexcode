import { describe, it, expect, vi } from "vitest";
import { OpenAICompatibleAdapter, defaultBaseUrl } from "./openai-compatible";
import type { CompletionRequest } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const recorded = {
  choices: [{ message: { content: "merhaba" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 4 },
};

const req: CompletionRequest = {
  model: "gpt-5.5",
  system: "Sistem talimatı.",
  messages: [{ role: "user", content: "Selam" }],
};

describe("OpenAICompatibleAdapter.complete (sözleşme testi)", () => {
  it("kayıtlı yanıtı doğru parse eder", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(recorded)) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({
      provider: "openai",
      apiKey: "sk-test",
      baseUrl: defaultBaseUrl("openai"),
      vision: true,
      fetchFn,
    });

    const result = await adapter.complete(req);

    expect(result.text).toBe("merhaba");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(result.stopReason).toBe("stop");
    expect(adapter.supportsVision()).toBe(true);
  });

  it("system mesajını ilk message olarak Bearer auth ile gönderir", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(recorded)) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({
      provider: "deepseek",
      apiKey: "ds-key",
      baseUrl: defaultBaseUrl("deepseek"),
      fetchFn,
    });
    await adapter.complete({ ...req, model: "deepseek-v4-flash" });

    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(String(url)).toBe("https://api.deepseek.com/v1/chat/completions");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer ds-key");
    const sent = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] };
    expect(sent.messages[0]).toEqual({ role: "system", content: "Sistem talimatı." });
    expect(sent.messages[1]).toEqual({ role: "user", content: "Selam" });
  });

  it("hatalı status'ta sağlayıcı adıyla hata fırlatır", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: "rate_limited" }, 429),
    ) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({
      provider: "minimax",
      apiKey: "k",
      baseUrl: defaultBaseUrl("minimax"),
      fetchFn,
    });
    await expect(adapter.complete(req)).rejects.toThrow(/minimax API 429/);
  });
});

describe("OpenAICompatibleAdapter.estimateCost", () => {
  it("DeepSeek fiyatıyla maliyet hesaplar", () => {
    const adapter = new OpenAICompatibleAdapter({
      provider: "deepseek",
      apiKey: "k",
      baseUrl: defaultBaseUrl("deepseek"),
    });
    const cost = adapter.estimateCost(
      { ...req, model: "deepseek-v4-flash" },
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    );
    // DeepSeek: $0.14 input + $0.28 output per 1M
    expect(cost.usd).toBeCloseTo(0.42, 5);
  });
});
