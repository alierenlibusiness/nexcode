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
