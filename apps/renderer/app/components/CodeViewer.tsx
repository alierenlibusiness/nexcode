"use client";

import type { FileContentDTO } from "../../global";

/** Salt-okunur kod görüntüleyici (PRD sınırı: tam editör değil, diff/önizleme + gözlem). */
export function CodeViewer({ file, path }: { file: FileContentDTO | null; path: string | null }) {
  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-600">
        Soldan bir dosya seç — içeriği burada görünür.
      </div>
    );
  }
  if (!file) {
    return <div className="flex h-full items-center justify-center text-sm text-neutral-600">Yükleniyor…</div>;
  }
  if (file.tooLarge) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-amber-500/80">
        Dosya görüntülemek için çok büyük (&gt;2 MB).
      </div>
    );
  }

  const lines = file.content.split("\n");
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-800 px-3 py-1.5 text-[11px] text-neutral-400">
        {path}
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-neutral-900/50">
                <td className="select-none border-r border-neutral-800 px-2 text-right align-top text-neutral-600">
                  {i + 1}
                </td>
                <td className="whitespace-pre-wrap px-3 align-top text-neutral-200">{line || " "}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
