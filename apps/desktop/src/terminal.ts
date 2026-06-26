import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Hafif terminal/komut konsolu (PRD §5.2 terminal entegrasyonu). node-pty yerine
 * dayanıklı, native-derlemesiz bir yaklaşım: renderer tam komut satırı gönderir, main
 * onu workspace cwd'sinde yürütür ve çıktıyı stream eder. `cd` ile cwd kalıcı izlenir.
 *
 * NOT: Tam TTY (cursor app'ler, renkli prompt) gerekirse ileride node-pty'ye yükseltilir
 * (CLAUDE.md tech stack). Vibe-coding için "komut çalıştır + çıktı gör" bu modelle yeterli.
 */
export interface TerminalCallbacks {
  onData: (id: string, data: string) => void;
  onExit: (id: string, code: number) => void;
}

interface Session {
  cwd: string;
  running: ChildProcess | null;
}

function shellFor(): { bin: string; flag: string } {
  if (process.platform === "win32") return { bin: process.env["ComSpec"] ?? "powershell.exe", flag: "-Command" };
  return { bin: process.env["SHELL"] ?? "/bin/bash", flag: "-c" };
}

export class TerminalManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly cb: TerminalCallbacks) {}

  start(id: string, cwd: string): void {
    const root = cwd && existsSync(cwd) ? cwd : os.homedir();
    this.sessions.set(id, { cwd: root, running: null });
    this.cb.onData(id, `NEXCODE terminal — ${root}\r\n`);
    this.prompt(id);
  }

  private prompt(id: string): void {
    const s = this.sessions.get(id);
    if (s) this.cb.onData(id, `\r\n${s.cwd}> `);
  }

  /** Renderer'dan gelen tam komut satırı. */
  run(id: string, line: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const command = line.trim();
    this.cb.onData(id, `${command}\r\n`);

    if (!command) return this.prompt(id);
    if (command === "clear" || command === "cls") {
      this.cb.onData(id, "\x1b[2J\x1b[H");
      return this.prompt(id);
    }
    // `cd` cwd'yi kalıcı değiştirir (pipe-shell tek komut başına izole olduğundan elde tutulur).
    if (command === "cd" || command.startsWith("cd ")) {
      const target = command.slice(2).trim() || os.homedir();
      const next = path.resolve(s.cwd, target);
      if (existsSync(next) && statSync(next).isDirectory()) {
        s.cwd = next;
      } else {
        this.cb.onData(id, `cd: dizin bulunamadı: ${target}\r\n`);
      }
      return this.prompt(id);
    }

    const { bin, flag } = shellFor();
    const child = spawn(bin, [flag, command], { cwd: s.cwd, windowsHide: true });
    s.running = child;
    child.stdout.on("data", (c: Buffer) => this.cb.onData(id, c.toString().replace(/\n/g, "\r\n")));
    child.stderr.on("data", (c: Buffer) => this.cb.onData(id, c.toString().replace(/\n/g, "\r\n")));
    child.on("error", (e) => this.cb.onData(id, `hata: ${e.message}\r\n`));
    child.on("close", (code) => {
      s.running = null;
      if (code && code !== 0) this.cb.onData(id, `[çıkış kodu ${String(code)}]\r\n`);
      this.prompt(id);
    });
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (s?.running) {
      try {
        s.running.kill();
      } catch {
        /* yoksay */
      }
    }
    this.sessions.delete(id);
    this.cb.onExit(id, 0);
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}
