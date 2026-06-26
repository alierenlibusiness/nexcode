"use client";

import { useState } from "react";
import type { ProviderInfoDTO, ConnectionStatusMap } from "../../global";

/**
 * Bağlantılar paneli — "API anahtarını nereye girerim / CLI nasıl bağlanır" netliği.
 * Her sağlayıcı için: API anahtarı durumu (girip kaydet) + CLI kurulu mu rozeti.
 */
export function ConnectionsPanel({
  providers,
  status,
  disabled,
  onSaveKey,
}: {
  providers: ProviderInfoDTO[];
  status: ConnectionStatusMap;
  disabled: boolean;
  onSaveKey: (provider: string, key: string) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-brand-700/40 bg-brand-900/10 p-3 text-[11px] leading-relaxed text-neutral-300">
        <p className="mb-1 font-semibold text-brand-300">İki bağlantı modu</p>
        <p>
          <span className="text-neutral-200">API:</span> sağlayıcının anahtarını aşağıya gir
          (OS keychain'de şifreli saklanır). <span className="text-neutral-200">CLI:</span> sistemde
          kurulu aboneliğini kullanır (claude / codex / antigravity) — anahtar gerekmez.
          Hangi agent'ın hangi modu kullanacağını <span className="text-brand-300">Agentlar</span>{" "}
          sekmesinden seçersin.
        </p>
      </div>

      {providers.map((p) => {
        const s = status[p.id];
        const draft = drafts[p.id] ?? "";
        return (
          <div key={p.id} className="panel-flat rounded-lg p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-neutral-100">{p.label}</span>
              <div className="flex items-center gap-1.5">
                {s?.hasApiKey ? (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-300">
                    API ✓
                  </span>
                ) : (
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[9px] text-neutral-500">
                    API yok
                  </span>
                )}
                {p.cli ? (
                  s?.cliInstalled ? (
                    <span className="rounded bg-brand-500/15 px-1.5 py-0.5 text-[9px] text-brand-300">
                      CLI kurulu
                    </span>
                  ) : (
                    <span
                      title={`'${p.cli}' PATH'te bulunamadı`}
                      className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-400/80"
                    >
                      CLI yok
                    </span>
                  )
                ) : (
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[9px] text-neutral-600">
                    yalnızca API
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                value={draft}
                disabled={disabled}
                onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                placeholder={s?.hasApiKey ? "anahtarı değiştir…" : `${p.label} API anahtarı`}
                className="field min-w-0 flex-1 py-1.5 text-[11px]"
              />
              <button
                onClick={async () => {
                  if (!draft.trim()) return;
                  await onSaveKey(p.id, draft.trim());
                  setDrafts((d) => ({ ...d, [p.id]: "" }));
                }}
                disabled={disabled || !draft.trim()}
                className="btn-ghost px-2.5 py-1.5 text-[11px]"
              >
                Kaydet
              </button>
            </div>
            {p.cli && !s?.cliInstalled && (
              <p className="mt-1 text-[9px] text-neutral-600">
                CLI modu için <code className="text-neutral-400">{p.cli}</code> komutunu kur ve PATH'e ekle.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
