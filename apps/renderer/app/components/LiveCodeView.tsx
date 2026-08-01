"use client";

import { useState, type ReactElement } from "react";
import type { DiffLine, FileChangeSummary } from "@nexcode/core";
import type { EngineViewState } from "../lib/engine-store";

/**
 * Canlı Kod.
 *
 * Agent'ların çalışma klasöründe yaptığı değişiklikleri Git benzeri dosya ve hunk
 * görünümüyle akıtır. İçeriği güvenle gösterilemeyen dosyalar (ikili, hassas, sınır aşan)
 * gövde yerine nedeniyle listelenir: `.env` ve kimlik bilgileri asla ekrana basılmaz.
 */

const PREVIEW_REASON: Record<FileChangeSummary["previewStatus"], string> = {
  ok: "",
  binary: "İkili dosya, içerik gösterilmiyor",
  "too-large": "Dosya sınırı aştı, içerik gösterilmiyor",
  redacted: "Hassas dosya, içerik güvenlik nedeniyle gizlendi",
  unreadable: "Dosya okunamadı",
};

const ACTION_STYLE: Record<FileChangeSummary["action"], { label: string; className: string }> = {
  created: { label: "yeni", className: "bg-emerald-900/40 text-emerald-300" },
  modified: { label: "değişti", className: "bg-brand-900/40 text-brand-300" },
  deleted: { label: "silindi", className: "bg-rose-900/40 text-rose-300" },
};

export function LiveCodeView({ state }: { state: EngineViewState }): ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const active = state.files.find((file) => file.path === selected) ?? state.files[0] ?? null;

  if (state.files.length === 0) {
    return (
      <div className="panel flex h-full items-center justify-center">
        <div className="max-w-sm text-center">
          <p className="text-sm text-neutral-300">Henüz dosya değişikliği yok.</p>
          <p className="mt-2 text-xs leading-relaxed text-neutral-500">
            Bir görev çalışırken agent'ların yazdığı her satır burada canlı akar. Geçmiş görevlerin
            değişiklikleri sayfa açılışında yeniden yüklenir.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
      <section className="panel flex min-h-0 flex-col">
        <header className="flex items-baseline justify-between border-b border-ink-700 px-3 py-2.5">
          <h2 className="text-sm font-semibold text-neutral-200">Değişen dosyalar</h2>
          <span className="text-xs tabular-nums">
            <span className="text-emerald-400">+{String(state.lineCounts.added)}</span>{" "}
            <span className="text-rose-400">-{String(state.lineCounts.removed)}</span>
          </span>
        </header>

        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {state.files.map((file) => {
            const isActive = active?.path === file.path;
            return (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => setSelected(file.path)}
                  className={`w-full rounded-md px-2 py-1.5 text-left transition ${
                    isActive ? "bg-ink-800" : "hover:bg-ink-800/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1 py-0.5 text-[10px] ${ACTION_STYLE[file.action].className}`}>
                      {ACTION_STYLE[file.action].label}
                    </span>
                    <span className="truncate text-xs text-neutral-300" title={file.path}>
                      {basename(file.path)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="truncate text-[10px] text-neutral-600">{dirname(file.path)}</span>
                    <span className="shrink-0 text-[10px] tabular-nums">
                      <span className="text-emerald-500">+{String(file.added)}</span>{" "}
                      <span className="text-rose-500">-{String(file.removed)}</span>
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel flex min-h-0 flex-col">
        {active === null ? (
          <p className="p-6 text-center text-sm text-neutral-500">Bir dosya seç.</p>
        ) : (
          <>
            <header className="border-b border-ink-700 px-4 py-2.5">
              <h2 className="truncate font-mono text-xs text-neutral-300" title={active.path}>
                {active.path}
              </h2>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              <DiffBody file={active} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function DiffBody({ file }: { file: FileChangeSummary }): ReactElement {
  if (file.previewStatus !== "ok") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="rounded-lg border border-ink-700 bg-ink-950/60 px-4 py-3 text-center text-xs text-neutral-400">
          {PREVIEW_REASON[file.previewStatus]}
        </p>
      </div>
    );
  }

  if (file.hunks.length === 0) {
    return <p className="p-6 text-center text-xs text-neutral-500">Gösterilecek satır farkı yok.</p>;
  }

  return (
    <table className="w-full border-collapse font-mono text-xs">
      <tbody>
        {file.hunks.map((hunk, hunkIndex) => (
          <HunkRows key={`${String(hunk.oldStart)}-${String(hunkIndex)}`} hunk={hunk} />
        ))}
      </tbody>
    </table>
  );
}

function HunkRows({ hunk }: { hunk: FileChangeSummary["hunks"][number] }): ReactElement {
  return (
    <>
      <tr>
        <td colSpan={3} className="bg-ink-800/60 px-3 py-1 text-[11px] text-brand-300">
          @@ -{String(hunk.oldStart)},{String(hunk.oldLines)} +{String(hunk.newStart)},{String(hunk.newLines)} @@
        </td>
      </tr>
      {hunk.lines.map((line, index) => (
        <tr key={index} className={rowClass(line.kind)}>
          {/* Eklenen satırın eski numarası, silinen satırın yeni numarası yoktur. */}
          <td className="w-12 select-none border-r border-ink-800 px-2 text-right tabular-nums text-neutral-600">
            {line.oldLineNo === null ? "" : String(line.oldLineNo)}
          </td>
          <td className="w-12 select-none border-r border-ink-800 px-2 text-right tabular-nums text-neutral-600">
            {line.newLineNo === null ? "" : String(line.newLineNo)}
          </td>
          <td className="whitespace-pre-wrap break-all px-3 py-0.5">
            <span className="select-none text-neutral-600">{marker(line.kind)}</span>
            {line.text}
          </td>
        </tr>
      ))}
    </>
  );
}

function rowClass(kind: DiffLine["kind"]): string {
  if (kind === "added") return "bg-emerald-950/40 text-emerald-200";
  if (kind === "removed") return "bg-rose-950/40 text-rose-200";
  return "text-neutral-400";
}

function marker(kind: DiffLine["kind"]): string {
  if (kind === "added") return "+ ";
  if (kind === "removed") return "- ";
  return "  ";
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}
