"use client";

import type { AgentRole, ConnectionPreference } from "@nexcode/core";
import type { ProviderInfoDTO, AgentModelMap, ConnectionStatusMap } from "../../global";
import { AGENT_CARDS } from "../agents";

const CONNECTION_OPTIONS: ReadonlyArray<{ value: ConnectionPreference; label: string; hint: string }> = [
  { value: "api_only", label: "API", hint: "Doğrudan API anahtarını kullanır" },
  { value: "cli_only", label: "CLI", hint: "Yalnızca terminal CLI aboneliğini kullanır" },
  { value: "cli_first", label: "CLI → API", hint: "Öncelikle CLI kullanır, kota aşımında API'ye geçer" },
];

export function AgentPanel({
  providers,
  agentModels,
  connections,
  status,
  disabled,
  onModelChange,
  onConnectionChange,
}: {
  providers: ProviderInfoDTO[];
  agentModels: AgentModelMap;
  connections: Partial<Record<AgentRole, ConnectionPreference>>;
  status: ConnectionStatusMap;
  disabled: boolean;
  onModelChange: (role: AgentRole, provider: string, modelId: string) => void;
  onConnectionChange: (role: AgentRole, pref: ConnectionPreference) => void;
}) {
  return (
    <div className="space-y-3 p-1">
      {AGENT_CARDS.map((agent) => {
        const current = agentModels[agent.role];
        const value = current ? `${current.provider}::${current.modelId}` : "";
        const pref = connections[agent.role] ?? "cli_first";
        const providerStatus = current ? status[current.provider] : undefined;

        // Verify if selected connection preference is available
        const ready =
          pref === "api_only"
            ? providerStatus?.hasApiKey
            : pref === "cli_only"
              ? providerStatus?.cliInstalled
              : providerStatus?.cliInstalled || providerStatus?.hasApiKey;

        return (
          <div
            key={agent.role}
            className="group rounded-xl border border-ink-800 bg-ink-900/40 p-3 transition-all duration-150 hover:border-brand-500/20 hover:bg-ink-900/60"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-[9px] font-bold border border-current bg-ink-950 ${agent.accent}`}>
                  {agent.short}
                </span>
                <div>
                  <span className="text-xs font-bold text-neutral-100">{agent.title}</span>
                  <p className="text-[9px] text-neutral-500 mt-0.5 select-none">{agent.summary}</p>
                </div>
              </div>
              {!ready && !disabled && (
                <span
                  title="Seçili bağlantı yöntemi için API Key veya CLI kurulu değil"
                  className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[8px] font-bold text-amber-400/80 border border-amber-500/20 animate-pulse select-none"
                >
                  bağlantı eksik
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 mt-3">
              {/* Model selection */}
              <select
                value={value}
                disabled={disabled}
                onChange={(e) => {
                  const [provider, modelId] = e.target.value.split("::");
                  if (provider && modelId) onModelChange(agent.role, provider, modelId);
                }}
                className="field flex-1 py-1 text-[11px] bg-ink-950 border border-ink-700 cursor-pointer"
              >
                {providers.map((p) => (
                  <optgroup key={p.id} label={`${p.label}${p.cli ? " · CLI Destekli" : ""}`} className="bg-ink-950">
                    {p.models.map((m) => (
                      <option key={`${p.id}::${m.modelId}`} value={`${p.id}::${m.modelId}`} className="text-neutral-100">
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* Autonomy preference toggle buttons */}
              <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-ink-700 text-[9px] bg-ink-950 font-bold select-none shadow-sm">
                {CONNECTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    title={opt.hint}
                    disabled={disabled}
                    onClick={() => onConnectionChange(agent.role, opt.value)}
                    className={`px-2 py-1.5 transition ${
                      pref === opt.value
                        ? "bg-brand-grad text-white"
                        : "text-neutral-400 hover:bg-ink-800 hover:text-neutral-200 disabled:opacity-40"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {current?.isDefault && (
              <p className="mt-1.5 text-[9px] text-neutral-600 font-mono select-none">
                * Varsayılan agent modeli kullanılıyor
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
