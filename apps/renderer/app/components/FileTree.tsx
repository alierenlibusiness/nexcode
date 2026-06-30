"use client";

import { useState } from "react";
import type { FsEntryDTO } from "../../global";

const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
  </svg>
);

const FileIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400 shrink-0">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
    <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
  </svg>
);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-500 transition-transform ${expanded ? "rotate-90" : "rotate-0"} shrink-0`}>
    <path d="m9 18 6-6-6-6"/>
  </svg>
);

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
        style={{ paddingLeft: `${String(depth * 14 + 10)}px` }}
        className={`flex w-full items-center gap-2 truncate py-1 pr-2 text-left text-xs transition duration-150 hover:bg-ink-800/80 ${
          isActive ? "bg-brand-500/15 text-brand-300 font-medium" : "text-neutral-300 hover:text-neutral-100"
        }`}
      >
        <span className="w-3 shrink-0 flex items-center justify-center">
          {entry.kind === "directory" ? <ChevronIcon expanded={expanded} /> : null}
        </span>
        {entry.kind === "directory" ? <FolderIcon /> : <FileIcon />}
        <span className="truncate select-none">{entry.name}</span>
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
    <div className="flex h-full flex-col bg-ink-950/20">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2.5 bg-ink-900/10">
        <span className="truncate text-[10px] font-bold uppercase tracking-wider text-neutral-500 select-none">
          {root ? root.split(/[\\/]/).pop() : "DOSYA GEZGİNİ"}
        </span>
        <button
          onClick={onOpenFolder}
          className="rounded-lg bg-brand-grad px-3 py-1 text-[10px] font-bold text-white transition-all shadow-glow hover:brightness-110 active:scale-95"
        >
          Klasör Aç...
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-center">
            <p className="text-[10px] text-neutral-600 italic select-none">Boş veya klasör seçilmedi.</p>
          </div>
        ) : (
          entries.map((e) => (
            <TreeNode key={e.path} entry={e} depth={0} activePath={activePath} onOpenFile={onOpenFile} />
          ))
        )}
      </div>
    </div>
  );
}
