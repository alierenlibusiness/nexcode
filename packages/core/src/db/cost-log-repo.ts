import { randomUUID } from "node:crypto";
import type { DB } from "./connection";
import type { ConnectionMode } from "../domain/agent";

/** The cost record of a single model call. */
export interface CostLogEntry {
  agentId: string | null;
  taskId: string | null;
  provider: string;
  modelId: string;
  connectionMode: ConnectionMode;
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
  /** Subscription pool id, for a shared CLI pool such as CEO plus Backend. */
  subscriptionPoolId?: string | null;
}

export interface CostLogRow extends CostLogEntry {
  id: string;
}

/** Cost totals per provider or pool, for the cost dashboard. */
export interface CostSummaryRow {
  key: string;
  usdCost: number;
  inputTokens: number;
  outputTokens: number;
  count: number;
}

/**
 * Reads and writes cost logs in SQLite. Every model call (API or CLI) lands here; the
 * `connection_mode` field is what separates "how much was inside the subscription" from
 * "how much overflowed to the API" at the end of the month. CLI calls record usd_cost=0
 * because they are charged to the subscription pool.
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

  /** Total overflow (API) cost: the real USD spend outside the subscription. */
  totalApiCost(): number {
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(usd_cost), 0) AS total FROM cost_logs WHERE connection_mode = 'api'`)
      .get() as { total: number };
    return row.total;
  }

  /** Summary by connection mode (api vs cli): shows the subscription saving on the dashboard. */
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
