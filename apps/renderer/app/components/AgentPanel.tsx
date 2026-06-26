"use client";

import type { AgentRole, ConnectionPreference } from "@nexcode/core";
import type { ProviderInfoDTO, AgentModelMap } from "../../global";
import { AGENT_CARDS } from "../agents";

const CONNECTION_OPTIONS: ReadonlyArray<{ value: ConnectionPreference; label: string }> = [
  { value: "api_only", label: "API" },
  { value: "cli_only", label: "CLI" },
  { value: "cli_first", label: "CLI→API" },
];

export function AgentPanel({
  providers,
  agentModels,
  connections,
  disabled,
  onModelChange,
  onConnectionChange,
}: {
  providers: ProviderInfoDTO[];
  agentModels: AgentModelMap;
  connections: Partial<Record<AgentRole, ConnectionPreference>>;
  disabled: boolean;
  onModelChange: (role: AgentRole, provider: string, modelId: string) => void;
  onConnectionChange: (role: AgentRole, pref: ConnectionPreference) => void;
}) {
  return (
    <div className="space-y-2">
      {AGENT_CARDS.map((agent) => {
        const current = agentModels[agent.role];
        const value = current ? `${current.provider}::${current.modelId}` : "";
        return (
          <div key={agent.role} className="rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-neutral-200">{agent.title}</span>
              <div className="inline-flex overflow-hidden rounded border border-neutral-700 text-[9px]">
                {CONNECTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    disabled={disabled}
                    onClick={() => onConnectionChange(agent.role, opt.value)}
                    className={`px-1.5 py-0.5 transition ${
                      connections[agent.role] === opt.value
                        ? "bg-violet-500/30 text-violet-200"
                        : "text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <select
              value={value}
              disabled={disabled}
              onChange={(e) => {
                const [provider, modelId] = e.target.value.split("::");
                if (provider && modelId) onModelChange(agent.role, provider, modelId);
              }}
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-200 outline-none focus:border-neutral-500"
            >
              {providers.map((p) => (
                <optgroup key={p.id} label={`${p.label}${p.cli ? " · CLI" : ""}`}>
                  {p.models.map((m) => (
                    <option key={`${p.id}::${m.modelId}`} value={`${p.id}::${m.modelId}`}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {current?.isDefault && (
              <p className="mt-1 text-[9px] text-neutral-600">varsayılan (agent rolüne göre)</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
