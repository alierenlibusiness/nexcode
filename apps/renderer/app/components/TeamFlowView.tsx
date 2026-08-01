"use client";

import { useMemo, type ReactElement } from "react";
import { CLI_COLOR, type CliAdapter } from "@nexcode/core";
import type { EngineViewState, TimelineEntry } from "../lib/engine-store";
import { useKpis } from "../lib/engine-store";

/**
 * Ekip Akışı.
 *
 * Orkestrasyonu tek bakışta okunur kılan sahne: merkezde operatör çekirdeği, çevresinde
 * uzman agent düğümleri, aralarında akan veri paketleri. Sağda kronolojik zaman çizelgesi,
 * üstte KPI şeridi.
 *
 * Sahne bağımlılıksız SVG ile çizilir (WebGL kütüphanesi yüklenmez): anında açılır, ölçekli
 * kalır ve düşük GPU'lu makinelerde de akıcıdır.
 */

interface AgentNode {
  id: string;
  name: string;
  adapter: CliAdapter;
  active: boolean;
  work: number;
}

const RADIUS = 150;
const CENTER = { x: 210, y: 190 };

export function TeamFlowView({ state }: { state: EngineViewState }): ReactElement {
  const kpis = useKpis(state);
  const agents = useAgentFleet(state.timeline);

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-h-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Kpi label="Tur" value={kpis.rounds} />
          <Kpi label="Delegasyon" value={kpis.delegations} />
          <Kpi label="Agent" value={agents.length} />
          <Kpi label="Dosya" value={kpis.changedFiles} />
          <Kpi label="CLI çağrısı" value={kpis.calls} />
        </div>

        <section className="panel relative min-h-0 flex-1 overflow-hidden">
          <Scene agents={agents} running={state.status?.running ?? false} />
          <FleetLegend agents={agents} />
        </section>
      </div>

      <Timeline timeline={state.timeline} />
    </div>
  );
}

/** Olay akışından agent filosunu türetir: kim çalıştı, kaç iş aldı, şu an aktif mi. */
function useAgentFleet(timeline: TimelineEntry[]): AgentNode[] {
  return useMemo(() => {
    const byId = new Map<string, AgentNode>();

    for (const entry of timeline) {
      if (entry.agentId === undefined) continue;
      const existing = byId.get(entry.agentId);
      const adapter = (entry.adapter ?? "custom") as CliAdapter;

      if (existing === undefined) {
        byId.set(entry.agentId, {
          id: entry.agentId,
          name: entry.title.split(" ")[0] ?? entry.agentId,
          adapter,
          active: true,
          work: 1,
        });
        continue;
      }
      existing.work += 1;
      // Son olay "bitirdi" ise düğüm sönümlenir.
      existing.active = !entry.title.includes("bitirdi");
    }

    return [...byId.values()];
  }, [timeline]);
}

function Scene({ agents, running }: { agents: AgentNode[]; running: boolean }): ReactElement {
  const positions = agents.map((agent, index) => {
    // Düğümler çember üzerine eşit dağıtılır; üstten başlayıp saat yönünde ilerler.
    const angle = (index / Math.max(1, agents.length)) * Math.PI * 2 - Math.PI / 2;
    return {
      agent,
      x: CENTER.x + Math.cos(angle) * RADIUS,
      y: CENTER.y + Math.sin(angle) * RADIUS,
    };
  });

  return (
    <svg viewBox="0 0 420 380" className="h-full w-full" role="img" aria-label="Orkestrasyon sahnesi">
      <defs>
        <radialGradient id="coreGlow">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#1e9bf0" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#1268c9" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Yörünge halkaları: sahneye derinlik verir. */}
      {[RADIUS, RADIUS * 0.66, RADIUS * 0.33].map((r) => (
        <circle key={r} cx={CENTER.x} cy={CENTER.y} r={r} fill="none" stroke="#1a2233" strokeWidth="1" />
      ))}

      {positions.map(({ agent, x, y }) => {
        const color = CLI_COLOR[agent.adapter];
        return (
          <g key={agent.id}>
            <line x1={CENTER.x} y1={CENTER.y} x2={x} y2={y} stroke={color} strokeOpacity="0.25" strokeWidth="1.5" />

            {/* Veri paketi: operatörden agent'a doğru akar, yalnızca motor çalışırken. */}
            {running && agent.active && (
              <circle r="3" fill={color}>
                <animateMotion
                  dur={`${String(1.8 + (agent.work % 3) * 0.4)}s`}
                  repeatCount="indefinite"
                  path={`M ${String(CENTER.x)} ${String(CENTER.y)} L ${String(x)} ${String(y)}`}
                />
              </circle>
            )}

            <circle
              cx={x}
              cy={y}
              r={agent.active ? 17 : 14}
              fill="#0b0e14"
              stroke={color}
              strokeWidth={agent.active ? 2.5 : 1.5}
              strokeOpacity={agent.active ? 1 : 0.45}
            />
            <text x={x} y={y + 4} textAnchor="middle" className="fill-neutral-200 text-[10px] font-semibold">
              {String(agent.work)}
            </text>
            <text x={x} y={y + 32} textAnchor="middle" className="fill-neutral-500 text-[9px]">
              {truncate(agent.name, 12)}
            </text>
          </g>
        );
      })}

      {/* Operatör çekirdeği. */}
      <circle cx={CENTER.x} cy={CENTER.y} r="52" fill="url(#coreGlow)" />
      <circle cx={CENTER.x} cy={CENTER.y} r="26" fill="#0b0e14" stroke="#2ba6ff" strokeWidth="2">
        {running && <animate attributeName="r" values="26;28;26" dur="2.4s" repeatCount="indefinite" />}
      </circle>
      <text x={CENTER.x} y={CENTER.y + 4} textAnchor="middle" className="fill-brand-200 text-[10px] font-semibold">
        OPERATÖR
      </text>

      {agents.length === 0 && (
        <text x={CENTER.x} y={CENTER.y + 90} textAnchor="middle" className="fill-neutral-600 text-[11px]">
          Görev başlayınca ekip burada belirir
        </text>
      )}
    </svg>
  );
}

function FleetLegend({ agents }: { agents: AgentNode[] }): ReactElement | null {
  if (agents.length === 0) return null;

  return (
    <ul className="absolute left-3 top-3 space-y-1">
      {agents.map((agent) => (
        <li key={agent.id} className="flex items-center gap-2 text-[11px]">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: CLI_COLOR[agent.adapter], opacity: agent.active ? 1 : 0.4 }}
          />
          <span className="text-neutral-300">{truncate(agent.name, 18)}</span>
          <span className="text-neutral-600">{agent.adapter}</span>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ timeline }: { timeline: TimelineEntry[] }): ReactElement {
  return (
    <section className="panel flex min-h-0 flex-col">
      <h2 className="border-b border-ink-700 px-4 py-2.5 text-sm font-semibold text-neutral-200">Zaman çizelgesi</h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {timeline.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-600">Henüz olay yok.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-ink-700 pl-4">
            {[...timeline].reverse().map((entry) => (
              <li key={entry.seq} className="relative">
                <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${dotClass(entry.tone)}`} />
                <div className="text-xs text-neutral-300">{entry.title}</div>
                {entry.detail !== "" && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-neutral-600">{entry.detail}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div className="panel px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-neutral-100">{value}</div>
    </div>
  );
}

function dotClass(tone: TimelineEntry["tone"]): string {
  const map = { neutral: "bg-brand-400", good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-400" };
  return map[tone];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
