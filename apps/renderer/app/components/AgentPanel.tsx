"use client";

import type { AgentRole, ConnectionPreference } from "@nexcode/core";
import type { ProviderInfoDTO, AgentModelMap, ConnectionStatusMap } from "../../global";
import { AGENT_CARDS } from "../agents";

const CONNECTION_OPTIONS: ReadonlyArray<{ value: ConnectionPreference; label: string; hint: string }> = [
  { value: "api_only", label: "API", hint: "Yalnızca API anahtarı" },
  { value: "cli_only", label: "CLI", hint: "Yalnızca CLI aboneliği" },
  { value: "cli_first", label: "CLI→API", hint: "CLI öncelikli, kota dolunca API" },
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
    <div className="space-y-2.5">
      {AGENT_CARDS.map((agent) => {
        const current = agentModels[agent.role];
        const value = current ? `${current.provider}::${current.modelId}` : "";
        const pref = connections[agent.role] ?? "cli_first";
        const providerStatus = current ? status[current.provider] : undefined;
        // Seçili moda göre bağlantı hazır mı (uyarı göstermek için).
        const ready =
          pref === "api_only"
            ? providerStatus?.hasApiKey
            : pref === "cli_only"
              ? providerStatus?.cliInstalled
              : providerStatus?.cliInstalled || providerStatus?.hasApiKey;

        return (
          <div key={agent.role} className="panel-flat rounded-lg p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`grid h-6 w-9 place-items-center rounded bg-ink-800 text-[9px] font-bold ${agent.accent}`}>
                  {agent.short}
                </span>
                <span className="text-xs font-semibold text-neutral-100">{agent.title}</span>
              </div>
              {!ready && !disabled && (
                <span
                  title="Seçili bağlantı modu için anahtar/CLI eksik"
                  className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-400/80"
                >
                  bağlantı eksik
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value={value}
                disabled={disabled}
                onChange={(e) => {
                  const [provider, modelId] = e.target.value.split("::");
                  if (provider && modelId) onModelChange(agent.role, provider, modelId);
                }}
                className="field min-w-0 flex-1 py-1 text-[11px]"
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
              <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-ink-700 text-[9px]">
                {CONNECTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    title={opt.hint}
                    disabled={disabled}
                    onClick={() => onConnectionChange(agent.role, opt.value)}
                    className={`px-1.5 py-1 transition ${
                      pref === opt.value
                        ? "bg-brand-grad text-white"
                        : "text-neutral-400 hover:bg-ink-800 disabled:opacity-40"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {current?.isDefault && (
              <p className="mt-1 text-[9px] text-neutral-600">varsayılan model (agent rolüne göre)</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
