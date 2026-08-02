import { existsSync, readFileSync } from "node:fs";
import type { DB } from "./connection";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";
import { logger } from "../logger";

const CONFIG_KEY = "config";

/**
 * The store of the user's own configuration.
 *
 * On first run the bundled `resources/nexcode.config.default.json` template is copied; if it
 * cannot be read, the in-code `FALLBACK_CONFIG` is used. Every read and write goes through
 * `normalizeConfig`, so hand-edited records or records from an older schema are repaired.
 */
export class ConfigRepository {
  constructor(
    private readonly db: DB,
    /** Absolute path of the bundled template. */
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
      // A corrupt record must not lock the user out; fall back to a safe base and log why.
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

  /** Returns to the template values without deleting the user's record. */
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
