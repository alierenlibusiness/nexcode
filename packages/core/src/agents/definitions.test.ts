import { describe, it, expect } from "vitest";
import { ALL_AGENTS, FAZ1_AGENTS, getAgentDefinition } from "./definitions";
import { AGENT_ROLES } from "../domain/agent";

describe("Faz 2 agent tanımları (6 agent)", () => {
  it("6 agent'ın tamamı tanımlı ve her rol için kayıt var", () => {
    expect(ALL_AGENTS.map((a) => a.role).sort()).toEqual([...AGENT_ROLES].sort());
    for (const role of AGENT_ROLES) {
      expect(getAgentDefinition(role)).toBeDefined();
    }
  });

  it("FAZ1_AGENTS hâlâ CEO/Frontend/Backend (kümülatif fazlar)", () => {
    expect(FAZ1_AGENTS.map((a) => a.role)).toEqual(["ceo", "frontend", "backend"]);
  });

  it("CEO + Backend CLI (Claude Code, paylaşılan havuz); Frontend GPT-5.5 CLI + Sonnet fallback", () => {
    expect(getAgentDefinition("ceo")?.model.connectionMode).toBe("cli");
    expect(getAgentDefinition("backend")?.model).toMatchObject({
      provider: "anthropic",
      connectionMode: "cli",
    });
    const fe = getAgentDefinition("frontend");
    expect(fe?.model).toMatchObject({ provider: "openai", modelId: "gpt-5.5", connectionMode: "cli" });
    expect(fe?.fallbackModel).toMatchObject({ provider: "anthropic", modelId: "claude-sonnet-4-6" });
  });

  it("Security: Opus API, autonomous, dosyaya yazmaz", () => {
    const sec = getAgentDefinition("security");
    expect(sec?.model).toMatchObject({ provider: "anthropic", connectionMode: "api" });
    expect(sec?.autonomy).toBe("autonomous");
    expect(sec?.toolset).not.toContain("file_write");
  });

  it("QA: DeepSeek birincil + MiniMax→Sonnet eskalasyonu (3 kademe)", () => {
    const qa = getAgentDefinition("qa");
    expect(qa?.model).toMatchObject({ provider: "deepseek", modelId: "deepseek-v4-flash" });
    expect(qa?.escalationModels?.map((m) => m.provider)).toEqual(["minimax", "anthropic"]);
  });

  it("DevOps: Gemini API, manual otonomi", () => {
    const ops = getAgentDefinition("devops");
    expect(ops?.model).toMatchObject({ provider: "google", modelId: "gemini-3.5-flash" });
    expect(ops?.autonomy).toBe("manual");
  });

  it("CEO sistem prompt'u kod yazmamayı vurgular ve file_write içermez", () => {
    const ceo = getAgentDefinition("ceo");
    expect(ceo?.systemPrompt).toMatch(/ASLA kod yazmaz/);
    expect(ceo?.toolset).not.toContain("file_write");
  });
});
