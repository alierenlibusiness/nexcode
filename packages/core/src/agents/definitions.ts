import type { AgentRole, AutonomyLevel, ModelRef } from "../domain/agent";

/** Bir agent'ın statik tanımı: model, otonomi, sistem prompt'u, araç seti. */
export interface AgentDefinition {
  role: AgentRole;
  title: string;
  model: ModelRef;
  autonomy: AutonomyLevel;
  systemPrompt: string;
  toolset: readonly string[];
}

// Faz 1 tek sağlayıcı (Anthropic API) ile çalışır. Frontend nihai olarak GPT-5.5'e
// (CLI, Faz 2) geçecektir; Faz 1'de Anthropic Sonnet ile vekil olarak çalışır.

export const CEO_AGENT: AgentDefinition = {
  role: "ceo",
  title: "CEO · Orkestratör",
  model: { provider: "anthropic", modelId: "claude-opus-4-8", connectionMode: "api" },
  autonomy: "supervised",
  systemPrompt: [
    "Sen NEXCODE'un CEO/orkestratör agent'ısın.",
    "Kullanıcının yüksek seviye isteğini küçük, atanabilir görevlere ayır; bağımlılık",
    "grafiği kur ve her görevi doğru agent'a (frontend/backend) ata.",
    "ASLA kod yazmaz veya dosyaya dokunmazsın — yalnızca planlar ve yönlendirirsin.",
    "Planı kısa, onaylanabilir bir görev listesi olarak sun; onay gelmeden dağıtma.",
  ].join(" "),
  toolset: ["task_create", "task_assign", "task_reprioritize", "workspace_memory_read", "agent_status_read"],
};

export const BACKEND_AGENT: AgentDefinition = {
  role: "backend",
  title: "Backend",
  model: { provider: "anthropic", modelId: "claude-opus-4-8", connectionMode: "api" },
  autonomy: "supervised",
  systemPrompt: [
    "Sen NEXCODE'un backend agent'ısın: API endpoint'leri, veritabanı şeması/migration,",
    "iş mantığı ve üçüncü parti entegrasyonlardan sorumlusun.",
    "Mevcut şemayı/migration geçmişini oku, geriye dönük uyumluluğu koru.",
    "Migration'lar ve yıkıcı eylemler her zaman insan onayı gerektirir.",
    "Ürettiğin her değişikliği gözden geçirme için işaretle.",
  ].join(" "),
  toolset: ["file_read", "file_write", "terminal", "git_diff_create", "task_handoff"],
};

export const FRONTEND_AGENT: AgentDefinition = {
  role: "frontend",
  title: "Frontend",
  // Faz 1 vekil model: Sonnet (Anthropic). Faz 2 → GPT-5.5 (Codex CLI).
  model: { provider: "anthropic", modelId: "claude-sonnet-4-6", connectionMode: "api" },
  autonomy: "supervised",
  systemPrompt: [
    "Sen NEXCODE'un frontend agent'ısın: UI bileşenleri, state bağlama, stil ve",
    "erişilebilirlikten sorumlusun.",
    "Backend'in ürettiği API sözleşmesine göre veri çekip gösterirsin.",
    "Sözleşme yoksa görevi backend'e bağımlılık olarak işaretle ve bekle.",
  ].join(" "),
  toolset: ["file_read", "file_write", "terminal", "git_diff_create"],
};

/** Faz 1'de devreye giren agent'lar (PRD §23 Faz 1). */
export const FAZ1_AGENTS: readonly AgentDefinition[] = [CEO_AGENT, FRONTEND_AGENT, BACKEND_AGENT];

export function getAgentDefinition(role: AgentRole): AgentDefinition | undefined {
  return FAZ1_AGENTS.find((agent) => agent.role === role);
}
