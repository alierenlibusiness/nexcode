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
  it("varsayılan tercih cli_first", () => {
    const { settings, workspaceId } = setup();
    expect(settings.getPreference(workspaceId, "backend")).toBe("cli_first");
  });

  it("tercihi yazar ve okur (upsert)", () => {
    const { settings, workspaceId } = setup();
    settings.setPreference(workspaceId, "backend", "api_only");
    expect(settings.getPreference(workspaceId, "backend")).toBe("api_only");
    settings.setPreference(workspaceId, "backend", "cli_only");
    expect(settings.getPreference(workspaceId, "backend")).toBe("cli_only");
  });

  it("roller arasında izole", () => {
    const { settings, workspaceId } = setup();
    settings.setPreference(workspaceId, "ceo", "api_only");
    expect(settings.getPreference(workspaceId, "frontend")).toBe("cli_first");
  });
});

describe("AgentSettingsRepository — model seçimi (Faz 2, kullanıcı AI seçer)", () => {
  it("seçim yoksa resolveModel agent varsayılanını döner", () => {
    const { settings, workspaceId } = setup();
    const m = settings.resolveModel(workspaceId, "frontend");
    expect(m).toMatchObject({ provider: "openai", modelId: "gpt-5.5" });
    expect(settings.getModelChoice(workspaceId, "frontend")).toBeNull();
  });

  it("kullanıcı seçimi resolveModel'i override eder (ör. Frontend → GLM)", () => {
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

  it("model seçimi connection_preference'ı bozmaz", () => {
    const { settings, workspaceId } = setup();
    settings.setPreference(workspaceId, "qa", "api_only");
    settings.setModelChoice(workspaceId, "qa", { provider: "kimi", modelId: "kimi-k2" });
    expect(settings.getPreference(workspaceId, "qa")).toBe("api_only");
  });

  it("registry'de olmayan model reddedilir", () => {
    const { settings, workspaceId } = setup();
    expect(() =>
      settings.setModelChoice(workspaceId, "backend", { provider: "glm", modelId: "yok" }),
    ).toThrow(/registry/);
  });
});
