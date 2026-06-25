import { describe, it, expect, vi } from "vitest";
import { openDatabase } from "../db/connection";
import { TaskRepository } from "../db/task-repo";
import { Orchestrator } from "./orchestrator";
import { parsePlan } from "./plan";
import type { AIProviderAdapter, CompletionResult } from "../providers/types";

function stubAdapter(text: string, mode: "api" | "cli" = "api"): AIProviderAdapter {
  return {
    id: "stub",
    connectionMode: mode,
    complete: vi.fn(
      async (): Promise<CompletionResult> => ({
        text,
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: "end_turn",
      }),
    ),
    estimateCost: () => ({ usd: 0, inputTokens: 0, outputTokens: 0 }),
    supportsTools: () => true,
    supportsVision: () => true,
  };
}

describe("parsePlan", () => {
  it("metindeki JSON dizisini çıkarır ve doğrular", () => {
    const out = 'İşte plan: [{"title":"API yaz","role":"backend"}] bitti';
    expect(parsePlan(out)).toEqual([{ title: "API yaz", role: "backend" }]);
  });

  it("geçersiz rolü reddeder", () => {
    expect(() => parsePlan('[{"title":"x","role":"wizard"}]')).toThrow();
  });
});

describe("Orchestrator", () => {
  it("planRequest CEO çıktısından görev oluşturur", async () => {
    const tasks = new TaskRepository(openDatabase(":memory:"));
    const planText = '[{"title":"Login API","role":"backend"},{"title":"Login UI","role":"frontend"}]';
    const orch = new Orchestrator({
      tasks,
      resolveAdapter: () => stubAdapter(planText, "cli"),
      getPreference: () => "cli_first",
    });

    const created = await orch.planRequest("Login özelliği ekle");
    expect(created).toHaveLength(2);
    expect(created[0]?.title).toBe("Login API");
    expect(created[0]?.assignedRole).toBe("backend");
    expect(tasks.listByStatus("backlog")).toHaveLength(2);
  });

  it("dispatchTask görevi in_progress→review yapar ve seçilen adapter'ı kullanır", async () => {
    const tasks = new TaskRepository(openDatabase(":memory:"));
    const task = tasks.create({ title: "API yaz", assignedRole: "backend" });
    const resolveAdapter = vi.fn(() => stubAdapter("kod üretildi", "api"));
    const orch = new Orchestrator({
      tasks,
      resolveAdapter,
      getPreference: () => "api_only",
    });

    const output = await orch.dispatchTask(task.id);
    expect(output).toBe("kod üretildi");
    expect(tasks.getById(task.id)?.status).toBe("review");
    expect(resolveAdapter).toHaveBeenCalled();
  });
});
