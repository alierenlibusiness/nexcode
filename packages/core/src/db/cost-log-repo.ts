import { randomUUID } from "node:crypto";
import type { DB } from "./connection";
import type { ConnectionMode } from "../domain/agent";

/** Bir model çağrısının maliyet kaydı (PRD §9.4, §14 cost_logs). */
export interface CostLogEntry {
  agentId: string | null;
  taskId: string | null;
  provider: string;
  modelId: string;
  connectionMode: ConnectionMode;
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
  /** Abonelik havuzu kimliği — paylaşılan CLI havuzu (CEO+Backend) için (PRD §9.3). */
  subscriptionPoolId?: string | null;
}

export interface CostLogRow extends CostLogEntry {
  id: string;
}

/** Sağlayıcı/havuz bazında maliyet toplamı (cost dashboard için, PRD §9.3). */
export interface CostSummaryRow {
  key: string;
  usdCost: number;
  inputTokens: number;
  outputTokens: number;
  count: number;
}

/**
 * Maliyet loglarını SQLite'a yazar/okur. Her model çağrısı (API veya CLI) buraya düşer;
 * `connection_mode` alanı ay sonunda "ne kadarı abonelik içinde, ne kadarı taşma API"
 * ayrımını sağlar (PRD §9.4). CLI çağrılarında usd_cost=0 (abonelik havuzuna yazılır).
 */
export class CostLogRepository {
  constructor(private readonly db: DB) {}

  record(entry: CostLogEntry): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO cost_logs
          (id, agent_id, task_id, provider, model_id, connection_mode,
           input_tokens, output_tokens, usd_cost, subscription_pool_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.agentId,
        entry.taskId,
        entry.provider,
        entry.modelId,
        entry.connectionMode,
        entry.inputTokens,
        entry.outputTokens,
        entry.usdCost,
        entry.subscriptionPoolId ?? null,
      );
    return id;
  }

  /** Toplam taşma (API) maliyeti — abonelik dışı gerçek USD harcaması. */
  totalApiCost(): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(usd_cost), 0) AS total FROM cost_logs WHERE connection_mode = 'api'`)
      .get() as { total: number };
    return row.total;
  }

  /** Bağlantı moduna göre özet (api vs cli) — dashboard'da abonelik tasarrufunu gösterir. */
  summaryByConnectionMode(): CostSummaryRow[] {
    return this.db
      .prepare(
        `SELECT connection_mode AS key,
                COALESCE(SUM(usd_cost), 0) AS usdCost,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens,
                COUNT(*) AS count
         FROM cost_logs GROUP BY connection_mode`,
      )
      .all() as CostSummaryRow[];
  }

  listByTask(taskId: string): CostLogRow[] {
    return this.db
      .prepare(
        `SELECT id, agent_id AS agentId, task_id AS taskId, provider, model_id AS modelId,
                connection_mode AS connectionMode, input_tokens AS inputTokens,
                output_tokens AS outputTokens, usd_cost AS usdCost,
                subscription_pool_id AS subscriptionPoolId
         FROM cost_logs WHERE task_id = ?`,
      )
      .all(taskId) as CostLogRow[];
  }
}
