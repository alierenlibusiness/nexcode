"use client";

import { useState, type ReactElement } from "react";
import { useEngineStream } from "./lib/engine-store";
import { CommandCenter } from "./components/CommandCenter";
import { BoardView } from "./components/BoardView";
import { LiveCodeView } from "./components/LiveCodeView";
import { TeamFlowView } from "./components/TeamFlowView";

/**
 * Uygulama kabuğu.
 *
 * Dört yüzey tek bir olay akışını paylaşır: akış bir kez kurulur, yüzey değiştirmek
 * yeniden bağlanmaya yol açmaz ve hiçbir olay kaçmaz.
 */

const SURFACES = [
  { id: "command", label: "Komuta Merkezi", hint: "Görev ver, kuyruğu ve canlı akışı izle" },
  { id: "board", label: "Pano", hint: "Görev yaşam döngüsü" },
  { id: "code", label: "Canlı Kod", hint: "Agent'ların yazdığı satırlar" },
  { id: "flow", label: "Ekip Akışı", hint: "Orkestrasyon sahnesi ve zaman çizelgesi" },
] as const;

type SurfaceId = (typeof SURFACES)[number]["id"];

export default function Page(): ReactElement {
  const [surface, setSurface] = useState<SurfaceId>("command");
  const state = useEngineStream();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-6 border-b border-ink-700 bg-ink-900/60 px-5 py-2.5 backdrop-blur">
        <div className="text-lg font-bold tracking-tight">
          <span className="text-brand-grad">NEX</span>
          <span className="text-chrome">CODE</span>
        </div>

        <nav className="flex gap-1">
          {SURFACES.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.hint}
              onClick={() => setSurface(item.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                surface === item.id
                  ? "bg-ink-800 font-medium text-white"
                  : "text-neutral-400 hover:bg-ink-800/50 hover:text-neutral-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              state.status?.running === true ? "animate-pulse bg-emerald-400" : "bg-neutral-600"
            }`}
          />
          <span className="text-neutral-400">
            {state.status?.running === true ? "Motor çalışıyor" : "Motor durdu"}
          </span>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {surface === "command" && <CommandCenter state={state} />}
        {surface === "board" && <BoardView state={state} />}
        {surface === "code" && <LiveCodeView state={state} />}
        {surface === "flow" && <TeamFlowView state={state} />}
      </main>
    </div>
  );
}
