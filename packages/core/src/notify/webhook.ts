import type { NexcodeConfig } from "../config/schema";
import { logger } from "../logger";

/**
 * Görev bildirimleri.
 *
 * Görev tamamlanınca ya da başarısız olunca yapılandırılmış webhook'a `{ text, … }`
 * gövdesiyle POST edilir — Slack incoming webhook ile uyumludur. Boş URL bildirimi kapatır.
 *
 * Bildirim gönderimi **hiçbir zaman görevi başarısız kılmaz**: ağ hatası loglanır ve yutulur.
 */

export interface NotifyPayload {
  taskId: string;
  outcome: "done" | "failed";
  text: string;
  /** İnsan tarafından okunabilir görev başlığı (kısaltılmış prompt). */
  title?: string;
  workingDir?: string;
  durationMs?: number;
  usdCost?: number;
}

export interface WebhookBody {
  text: string;
  taskId: string;
  outcome: "done" | "failed";
  workingDir?: string;
  durationMs?: number;
  usdCost?: number;
}

/** Slack uyumlu gövdeyi kurar. */
export function buildWebhookBody(payload: NotifyPayload): WebhookBody {
  const icon = payload.outcome === "done" ? "✅" : "❌";
  const title = payload.title ?? payload.taskId;
  const summary = payload.text.length > 900 ? `${payload.text.slice(0, 900)}…` : payload.text;

  return {
    text: `${icon} NEXCODE — ${payload.outcome === "done" ? "task completed" : "task failed"}: ${title}\n\n${summary}`,
    taskId: payload.taskId,
    outcome: payload.outcome,
    ...(payload.workingDir !== undefined ? { workingDir: payload.workingDir } : {}),
    ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
    ...(payload.usdCost !== undefined ? { usdCost: payload.usdCost } : {}),
  };
}

/** Bu sonuç için bildirim gönderilmeli mi. */
export function shouldNotify(config: NexcodeConfig, outcome: "done" | "failed"): boolean {
  if (config.notify.webhookUrl.trim() === "") return false;
  return outcome === "done" ? config.notify.onComplete : config.notify.onFailed;
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

const defaultFetcher: Fetcher = async (url, init) => {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status };
};

export class Notifier {
  constructor(
    private readonly config: () => NexcodeConfig,
    private readonly fetcher: Fetcher = defaultFetcher,
  ) {}

  /** Bildirimi gönderir; gönderilmediyse `false` döner. Hata fırlatmaz. */
  async send(payload: NotifyPayload): Promise<boolean> {
    const config = this.config();
    if (!shouldNotify(config, payload.outcome)) return false;

    try {
      const response = await this.fetcher(config.notify.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildWebhookBody(payload)),
      });
      if (!response.ok) {
        logger.warn("notify.webhook.rejected", { status: response.status, taskId: payload.taskId });
        return false;
      }
      return true;
    } catch (error) {
      // Bildirim en iyi çabadır — görev sonucunu etkilemez.
      logger.warn("notify.webhook.failed", { error: String(error), taskId: payload.taskId });
      return false;
    }
  }
}
