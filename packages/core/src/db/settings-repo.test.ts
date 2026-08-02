import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { WorkspaceRepository } from "./workspace-repo";
import { AgentSettingsRepository } from "./settings-repo";

function setup() {
  const db = openDatabase(":memory:");
  const ws = new WorkspaceRepository(db).create({ name: "W", repoPath: "/w" });
  return { settings: new AgentSettingsRepository(db), workspaceId: ws.id };
}

describe("AgentSettingsRepository", () => {
  it("defaults the preference to cli_first", () => {
    const { settings, workspaceId } = setup();
    expect(settings.getPreference(workspaceId, "backend")).toBe("cli_first");
  });

  it("writes and reads the preference (upsert)", () => {
    const { settings, workspaceId } = setup();
    settings.setPreference(workspaceId, "backend", "api_only");
    expect(settings.getPreference(workspaceId, "backend")).toBe("api_only");
    settings.setPreference(workspaceId, "backend", "cli_only");
    expect(settings.getPreference(workspaceId, "backend")).toBe("cli_only");
  });

  it("isolates preferences across roles", () => {
    const { settings, workspaceId } = setup();
    settings.setPreference(workspaceId, "ceo", "api_only");
    expect(settings.getPreference(workspaceId, "frontend")).toBe("cli_first");
  });
});

describe("AgentSettingsRepository: model selection (the user picks the AI)", () => {
  it("resolveModel returns the agent default when there is no choice", () => {
    const { settings, workspaceId } = setup();
    const m = settings.resolveModel(workspaceId, "frontend");
    expect(m).toMatchObject({ provider: "openai", modelId: "gpt-5.5" });
    expect(settings.getModelChoice(workspaceId, "frontend")).toBeNull();
  });

  it("lets the user's choice override resolveModel (for example Frontend to GLM)", () => {
    const { settings, workspaceId } = setup();
    settings.setModelChoice(workspaceId, "frontend", { provider: "glm", modelId: "glm-4.6" });
    expect(settings.resolveModel(workspaceId, "frontend")).toMatchObject({
      provider: "glm",
      modelId: "glm-4.6",
    });
    expect(settings.getModelChoice(workspaceId, "frontend")).toEqual({
      provider: "glm",
      modelId: "glm-4.6",
    });
  });

  it("does not disturb connection_preference when the model is selected", () => {
    const { settings, workspaceId } = setup();
    settings.setPreference(workspaceId, "qa", "api_only");
    settings.setModelChoice(workspaceId, "qa", { provider: "kimi", modelId: "kimi-k2" });
    expect(settings.getPreference(workspaceId, "qa")).toBe("api_only");
  });

  it("rejects a model that is not in the registry", () => {
    const { settings, workspaceId } = setup();
    expect(() =>
      settings.setModelChoice(workspaceId, "backend", { provider: "glm", modelId: "missing" }),
    ).toThrow(/registry/);
  });
});
