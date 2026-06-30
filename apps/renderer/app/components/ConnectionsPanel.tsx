"use client";

import { useState } from "react";
import type { ProviderInfoDTO, ConnectionStatusMap } from "../../global";

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
    <div className="space-y-4 p-1">
      {/* Informative Header Callout */}
      <div className="rounded-xl border border-brand-500/20 bg-brand-950/10 p-3.5 text-[11px] leading-relaxed text-neutral-300 shadow-glow-sm">
        <p className="mb-1 font-bold text-brand-300 flex items-center gap-1.5 select-none">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-300 animate-pulse">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4"/>
            <path d="M12 8h.01"/>
          </svg>
          Geliştirici Bağlantı Modları
        </p>
        <p className="select-text">
          <span className="text-neutral-200 font-bold">API Modu:</span> AI sağlayıcısının API anahtarını aşağıya girin. Anahtarlar işletim sisteminizin yerel anahtar zincirinde (OS Keychain) şifrelenerek güvenle saklanır.
        </p>
        <p className="mt-1.5 select-text">
          <span className="text-neutral-200 font-bold">CLI Modu:</span> Bilgisayarınızda kurulu olan geliştirici abonelik CLI istemcilerini (claude, codex, antigravity) aracı olarak kullanır. Bu modda token ücretlendirmesi yapılmaz, doğrudan CLI oturumunuz kullanılır.
        </p>
      </div>

      {/* Provider API Key forms */}
      {providers.map((p) => {
        const s = status[p.id];
        const draft = drafts[p.id] ?? "";
        return (
          <div key={p.id} className="panel-flat rounded-xl p-3 border border-ink-800 bg-ink-900/30">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-neutral-200">{p.label}</span>
              <div className="flex items-center gap-1.5 select-none">
                {s?.hasApiKey ? (
                  <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[8px] font-bold text-emerald-400">
                    API ✓
                  </span>
                ) : (
                  <span className="rounded-full bg-ink-950 border border-ink-800 px-2 py-0.5 text-[8px] font-bold text-neutral-500">
                    API YOK
                  </span>
                )}
                {p.cli ? (
                  s?.cliInstalled ? (
                    <span className="rounded-full bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 text-[8px] font-bold text-brand-300">
                      CLI AKTİF
                    </span>
                  ) : (
                    <span
                      title={`'${p.cli}' terminal komutu PATH üzerinde bulunamadı`}
                      className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[8px] font-bold text-amber-400/80"
                    >
                      CLI YOK
                    </span>
                  )
                ) : (
                  <span className="rounded-full bg-ink-950 border border-ink-800 px-2 py-0.5 text-[8px] font-bold text-neutral-600">
                    SADECE API
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={draft}
                disabled={disabled}
                onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                placeholder={s?.hasApiKey ? "Anahtarı güncelle..." : `${p.label} API Key girin`}
                className="field min-w-0 flex-1 py-1.5 text-[11px] bg-ink-950"
              />
              <button
                onClick={async () => {
                  if (!draft.trim()) return;
                  await onSaveKey(p.id, draft.trim());
                  setDrafts((d) => ({ ...d, [p.id]: "" }));
                }}
                disabled={disabled || !draft.trim()}
                className="btn-ghost px-3 py-1.5 text-[11px] font-bold"
              >
                Kaydet
              </button>
            </div>
            {p.cli && !s?.cliInstalled && (
              <p className="mt-1.5 text-[9px] text-neutral-500 select-text">
                * CLI aboneliği kullanmak için terminalde <code className="text-neutral-300 bg-ink-950 px-1 py-0.5 rounded font-mono">{p.cli}</code> kurulumunu yapın.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
