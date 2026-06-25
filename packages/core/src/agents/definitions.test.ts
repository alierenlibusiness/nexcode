import { describe, it, expect } from "vitest";
import { FAZ1_AGENTS, getAgentDefinition } from "./definitions";

describe("Faz 1 agent tanımları", () => {
  it("CEO/Frontend/Backend tanımlı ve hepsi Anthropic API (Faz 1)", () => {
    expect(FAZ1_AGENTS.map((a) => a.role)).toEqual(["ceo", "frontend", "backend"]);
    for (const agent of FAZ1_AGENTS) {
      expect(agent.model.provider).toBe("anthropic");
      expect(agent.model.connectionMode).toBe("api");
      expect(agent.systemPrompt.length).toBeGreaterThan(20);
    }
  });

  it("CEO sistem prompt'u kod yazmamayı vurgular", () => {
    const ceo = getAgentDefinition("ceo");
    expect(ceo?.systemPrompt).toMatch(/ASLA kod yazmaz/);
    expect(ceo?.toolset).not.toContain("file_write");
  });

  it("bilinmeyen rol için undefined döner", () => {
    expect(getAgentDefinition("qa")).toBeUndefined();
  });
});
