import type { AgentRole, AutonomyLevel, ConnectionMode } from "@nexcode/core";

/** Yerleşik 6 agent'ın gösterim meta verisi (PRD §8 tablosu). */
export interface AgentCardInfo {
  role: AgentRole;
  title: string;
  model: string;
  connectionMode: ConnectionMode;
  autonomy: AutonomyLevel;
  summary: string;
}

export const AGENT_CARDS: readonly AgentCardInfo[] = [
  {
    role: "ceo",
    title: "CEO · Orkestratör",
    model: "Claude Opus 4.8",
    connectionMode: "cli",
    autonomy: "supervised",
    summary: "Planlar, görev grafiği kurar, atar. Kod yazmaz.",
  },
  {
    role: "frontend",
    title: "Frontend",
    model: "GPT-5.5",
    connectionMode: "cli",
    autonomy: "supervised",
    summary: "UI bileşenleri, state, stil, erişilebilirlik.",
  },
  {
    role: "backend",
    title: "Backend",
    model: "Claude Opus 4.8",
    connectionMode: "cli",
    autonomy: "supervised",
    summary: "API, şema/migration, iş mantığı, entegrasyon.",
  },
  {
    role: "security",
    title: "Security",
    model: "Claude Opus 4.8",
    connectionMode: "api",
    autonomy: "autonomous",
    summary: "Bağımlılık/secret tarama, review. Dosyaya yazmaz.",
  },
  {
    role: "qa",
    title: "QA · Test",
    model: "DeepSeek V4 Flash → MiniMax M3 → Sonnet 4.6",
    connectionMode: "api",
    autonomy: "autonomous",
    summary: "3 kademeli eskalasyon. Event-driven test.",
  },
  {
    role: "devops",
    title: "DevOps",
    model: "Gemini 3.5 Flash",
    connectionMode: "api",
    autonomy: "manual",
    summary: "CI/CD, build, deploy. Önce dry-run.",
  },
];
