import { describe, expect, it, vi } from "vitest";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { Notifier, buildWebhookBody, shouldNotify, type Fetcher } from "./webhook";

function withNotify(over: Partial<NexcodeConfig["notify"]>): NexcodeConfig {
  return normalizeConfig({ ...FALLBACK_CONFIG, notify: { ...FALLBACK_CONFIG.notify, ...over } });
}

describe("shouldNotify", () => {
  it("boş URL bildirimi kapatır", () => {
    expect(shouldNotify(FALLBACK_CONFIG, "done")).toBe(false);
  });

  it("başarı ve başarısızlık anahtarlarına uyar", () => {
    const config = withNotify({ webhookUrl: "https://hooks.example/x", onComplete: true, onFailed: false });
    expect(shouldNotify(config, "done")).toBe(true);
    expect(shouldNotify(config, "failed")).toBe(false);
  });
});

describe("buildWebhookBody", () => {
  it("Slack uyumlu metin üretir", () => {
    const body = buildWebhookBody({ taskId: "t1", outcome: "done", text: "Endpoint eklendi", title: "Avatar" });
    expect(body.text).toContain("✅");
    expect(body.text).toContain("task completed");
    expect(body.text).toContain("Avatar");
    expect(body.taskId).toBe("t1");
  });

  it("başarısızlıkta farklı simge kullanır", () => {
    expect(buildWebhookBody({ taskId: "t1", outcome: "failed", text: "hata" }).text).toContain("❌");
  });

  it("uzun metni kısaltır", () => {
    const body = buildWebhookBody({ taskId: "t1", outcome: "done", text: "x".repeat(3000) });
    expect(body.text.length).toBeLessThan(1100);
    expect(body.text).toContain("…");
  });

  it("isteğe bağlı alanları yalnızca verildiğinde ekler", () => {
    const minimal = buildWebhookBody({ taskId: "t1", outcome: "done", text: "x" });
    expect(minimal).not.toHaveProperty("workingDir");

    const full = buildWebhookBody({ taskId: "t1", outcome: "done", text: "x", workingDir: "C:/p", usdCost: 0.5 });
    expect(full.workingDir).toBe("C:/p");
    expect(full.usdCost).toBe(0.5);
  });
});

describe("Notifier", () => {
  it("yapılandırılmış webhook'a POST eder", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue({ ok: true, status: 200 });
    const config = withNotify({ webhookUrl: "https://hooks.example/x" });

    const sent = await new Notifier(() => config, fetcher).send({ taskId: "t1", outcome: "done", text: "bitti" });

    expect(sent).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://hooks.example/x");
    expect(init?.method).toBe("POST");
    expect(init?.headers["content-type"]).toBe("application/json");
  });

  it("kapalı bildirimde istek göndermez", async () => {
    const fetcher = vi.fn<Fetcher>();
    const sent = await new Notifier(() => FALLBACK_CONFIG, fetcher).send({ taskId: "t1", outcome: "done", text: "x" });
    expect(sent).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ağ hatasını yutar: görev sonucunu etkilemez", async () => {
    const fetcher = vi.fn<Fetcher>().mockRejectedValue(new Error("ECONNREFUSED"));
    const config = withNotify({ webhookUrl: "https://hooks.example/x" });

    await expect(
      new Notifier(() => config, fetcher).send({ taskId: "t1", outcome: "failed", text: "x" }),
    ).resolves.toBe(false);
  });

  it("HTTP hatasını başarısızlık sayar ama fırlatmaz", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue({ ok: false, status: 404 });
    const config = withNotify({ webhookUrl: "https://hooks.example/x" });
    await expect(
      new Notifier(() => config, fetcher).send({ taskId: "t1", outcome: "done", text: "x" }),
    ).resolves.toBe(false);
  });
});
