"use client";

import { useState } from "react";
import type { FsEntryDTO } from "../../global";

function TreeNode({
  entry,
  depth,
  activePath,
  onOpenFile,
}: {
  entry: FsEntryDTO;
  depth: number;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntryDTO[] | null>(null);

  async function toggle() {
    if (entry.kind === "file") {
      onOpenFile(entry.path);
      return;
    }
    const next = !expanded;
    setExpanded(next);
    if (next && children === null && window.nexcode) {
      try {
        setChildren(await window.nexcode.readDir(entry.path));
      } catch {
        setChildren([]);
      }
    }
  }

  const isActive = activePath === entry.path;
  return (
    <div>
      <button
        onClick={toggle}
        title={entry.name}
        style={{ paddingLeft: `${String(depth * 12 + 8)}px` }}
        className={`flex w-full items-center gap-1 truncate py-0.5 pr-2 text-left text-xs transition hover:bg-ink-800 ${
          isActive ? "bg-brand-500/15 text-brand-200" : "text-neutral-300"
        }`}
      >
        <span className="w-3 shrink-0 text-neutral-500">
          {entry.kind === "directory" ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className="shrink-0">{entry.kind === "directory" ? "📁" : "📄"}</span>
        <span className="truncate">{entry.name}</span>
      </button>
      {expanded &&
        children?.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        ))}
    </div>
  );
}

export function FileTree({
  root,
  entries,
  activePath,
  onOpenFile,
  onOpenFolder,
}: {
  root: string | null;
  entries: FsEntryDTO[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onOpenFolder: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          {root ? root.split(/[\\/]/).pop() : "Gezgin"}
        </span>
        <button
          onClick={onOpenFolder}
          className="rounded-md bg-brand-grad px-2 py-0.5 text-[10px] font-medium text-white transition hover:brightness-110"
        >
          Klasör Aç
        </button>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {entries.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-neutral-600">Boş veya klasör seçilmedi.</p>
        ) : (
          entries.map((e) => (
            <TreeNode key={e.path} entry={e} depth={0} activePath={activePath} onOpenFile={onOpenFile} />
          ))
        )}
      </div>
    </div>
  );
}
