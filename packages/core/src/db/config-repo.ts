import { existsSync, readFileSync } from "node:fs";
import type { DB } from "./connection";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { logger } from "../logger";

const CONFIG_KEY = "config";

/**
 * Kişiye özel yapılandırmanın deposu.
 *
 * İlk çalıştırmada paketle gelen `resources/nexcode.config.default.json` şablonu kopyalanır;
 * okunamazsa kod içi `FALLBACK_CONFIG` kullanılır. Her okuma ve yazma `normalizeConfig`'ten
 * geçer, böylece elle düzenlenmiş ya da eski şemadan gelen kayıtlar onarılır.
 */
export class ConfigRepository {
  constructor(
    private readonly db: DB,
    /** Paketle gelen şablonun mutlak yolu. */
    private readonly templatePath: string,
  ) {}

  load(): NexcodeConfig {
    const stored = this.db.prepare("SELECT value FROM engine_state WHERE key = ?").get(CONFIG_KEY) as
      | { value: string }
      | undefined;

    if (stored === undefined) {
      const seeded = this.readTemplate();
      this.save(seeded);
      return seeded;
    }

    try {
      return normalizeConfig(JSON.parse(stored.value));
    } catch (error) {
      // Bozuk kayıt kullanıcıyı kilitlemez; güvenli tabana dönülür ve neden loglanır.
      logger.error("config.load.invalid", { error: String(error) });
      return FALLBACK_CONFIG;
    }
  }

  save(config: NexcodeConfig): NexcodeConfig {
    const normalized = normalizeConfig(config);
    this.db
      .prepare(
        "INSERT INTO engine_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(CONFIG_KEY, JSON.stringify(normalized));
    return normalized;
  }

  /** Kullanıcının kaydını silmeden şablon değerlerine döner. */
  resetToTemplate(): NexcodeConfig {
    return this.save(this.readTemplate());
  }

  private readTemplate(): NexcodeConfig {
    if (!existsSync(this.templatePath)) {
      logger.warn("config.template.missing", { path: this.templatePath });
      return FALLBACK_CONFIG;
    }
    try {
      return normalizeConfig(JSON.parse(readFileSync(this.templatePath, "utf8")));
    } catch (error) {
      logger.error("config.template.invalid", { path: this.templatePath, error: String(error) });
      return FALLBACK_CONFIG;
    }
  }
}
