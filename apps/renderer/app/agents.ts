import type { AgentRole, AutonomyLevel, ConnectionMode } from "@nexcode/core";

/** Yerleşik 6 agent'ın gösterim meta verisi (PRD §8 tablosu). */
export interface AgentCardInfo {
  role: AgentRole;
  title: string;
  model: string;
  connectionMode: ConnectionMode;
  autonomy: AutonomyLevel;
  summary: string;
  /** Görsel kimlik: kısaltma + accent rengi (Tailwind sınıfı). */
  short: string;
  accent: string;
}

export const AGENT_CARDS: readonly AgentCardInfo[] = [
  {
    role: "ceo",
    title: "CEO · Orkestratör",
    model: "Claude Opus 4.8",
    connectionMode: "cli",
    autonomy: "supervised",
    summary: "Planlar, görev grafiği kurar, atar. Kod yazmaz.",
    short: "CEO",
    accent: "text-brand-300",
  },
  {
    role: "frontend",
    title: "Frontend",
    model: "GPT-5.5",
    connectionMode: "cli",
    autonomy: "supervised",
    summary: "UI bileşenleri, state, stil, erişilebilirlik.",
    short: "FE",
    accent: "text-emerald-300",
  },
  {
    role: "backend",
    title: "Backend",
    model: "Claude Opus 4.8",
    connectionMode: "cli",
    autonomy: "supervised",
    summary: "API, şema/migration, iş mantığı, entegrasyon.",
    short: "BE",
    accent: "text-violet-300",
  },
  {
    role: "security",
    title: "Security",
    model: "Claude Opus 4.8",
    connectionMode: "api",
    autonomy: "autonomous",
    summary: "Bağımlılık/secret tarama, review. Dosyaya yazmaz.",
    short: "SEC",
    accent: "text-rose-300",
  },
  {
    role: "qa",
    title: "QA · Test",
    model: "DeepSeek → MiniMax → Sonnet",
    connectionMode: "api",
    autonomy: "autonomous",
    summary: "3 kademeli eskalasyon. Event-driven test.",
    short: "QA",
    accent: "text-amber-300",
  },
  {
    role: "devops",
    title: "DevOps",
    model: "Gemini 3.5 Flash",
    connectionMode: "api",
    autonomy: "manual",
    summary: "CI/CD, build, deploy. Önce dry-run.",
    short: "OPS",
    accent: "text-cyan-300",
  },
];
