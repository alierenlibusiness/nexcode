import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { CostLogRepository } from "./cost-log-repo";
import { EngineRepository } from "./engine-repo";

function setup() {
  const db = openDatabase(":memory:");
  return { cost: new CostLogRepository(db), tasks: new EngineRepository(db) };
}

function repo() {
  return setup().cost;
}

describe("CostLogRepository (PRD §9.4 maliyet kaydı)", () => {
  it("API çağrısını kaydeder ve task'a göre listeler", () => {
    const { cost, tasks } = setup();
    const task = tasks.create({ prompt: "T", workingDir: "/w" });
    const id = cost.record({
      agentId: null,
      taskId: task.id,
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      connectionMode: "api",
      inputTokens: 1000,
      outputTokens: 500,
      usdCost: 0.0525,
    });
    expect(id).toBeTruthy();
    const rows = cost.listByTask(task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ connectionMode: "api", usdCost: 0.0525 });
  });

  it("CLI çağrısı usd=0 (abonelik havuzu) ile kaydedilir", () => {
    const { cost, tasks } = setup();
    const task = tasks.create({ prompt: "T", workingDir: "/w" });
    cost.record({
      agentId: null,
      taskId: task.id,
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      connectionMode: "cli",
      inputTokens: 2000,
      outputTokens: 800,
      usdCost: 0,
      subscriptionPoolId: "claude-max-20x",
    });
    expect(cost.totalApiCost()).toBe(0);
  });

  it("totalApiCost yalnızca taşma (API) modunu toplar", () => {
    const r = repo();
    r.record({ agentId: null, taskId: null, provider: "openai", modelId: "gpt-5.5", connectionMode: "cli", inputTokens: 100, outputTokens: 50, usdCost: 0 });
    r.record({ agentId: null, taskId: null, provider: "openai", modelId: "gpt-5.5", connectionMode: "api", inputTokens: 100, outputTokens: 50, usdCost: 1.25 });
    r.record({ agentId: null, taskId: null, provider: "deepseek", modelId: "deepseek-v4-flash", connectionMode: "api", inputTokens: 100, outputTokens: 50, usdCost: 0.05 });
    expect(r.totalApiCost()).toBeCloseTo(1.3, 5);
  });

  it("connection_mode bazında özet (cli vs api): dashboard tasarrufunu gösterir", () => {
    const r = repo();
    r.record({ agentId: null, taskId: null, provider: "anthropic", modelId: "claude-opus-4-8", connectionMode: "cli", inputTokens: 5000, outputTokens: 2000, usdCost: 0, subscriptionPoolId: "pool" });
    r.record({ agentId: null, taskId: null, provider: "anthropic", modelId: "claude-opus-4-8", connectionMode: "api", inputTokens: 1000, outputTokens: 400, usdCost: 0.045 });
    const summary = r.summaryByConnectionMode();
    const cli = summary.find((s) => s.key === "cli");
    const api = summary.find((s) => s.key === "api");
    expect(cli?.inputTokens).toBe(5000);
    expect(cli?.usdCost).toBe(0);
    expect(api?.usdCost).toBeCloseTo(0.045, 5);
    expect(api?.count).toBe(1);
  });
});
