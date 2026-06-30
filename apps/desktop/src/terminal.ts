import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";

/**
 * Dayanıklı ve tam etkileşimli terminal yöneticisi (Persistent Shell).
 * node-pty gerektirmeden, işletim sisteminin varsayılan kabuğunu (Windows için powershell/cmd,
 * macOS/Linux için bash/zsh) arka planda tek bir kalıcı alt süreç (interactive process) olarak başlatır.
 * Kullanıcı girdilerini doğrudan bu kabuğun standart girdisine (stdin) yönlendirir.
 * Bu sayede cd komutları, ortam değişkenleri ve etkileşimli komutlar doğal olarak çalışır.
 */
export interface TerminalCallbacks {
  onData: (id: string, data: string) => void;
  onExit: (id: string, code: number) => void;
}

interface Session {
  cwd: string;
  shell: ChildProcess;
}

function shellBinary(): string {
  if (process.platform === "win32") {
    // Windows için powershell veya cmd
    return process.env["ComSpec"] ?? "powershell.exe";
  }
  return process.env["SHELL"] ?? "/bin/bash";
}

export class TerminalManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly cb: TerminalCallbacks) {}

  start(id: string, cwd: string): void {
    // Eğer bir oturum zaten varsa kapat
    if (this.sessions.has(id)) {
      this.kill(id);
    }

    const root = cwd && existsSync(cwd) ? cwd : os.homedir();
    const bin = shellBinary();

    try {
      // Kalıcı kabuk sürecini başlat
      const shell = spawn(bin, [], {
        cwd: root,
        env: {
          ...process.env,
          TERM: "xterm-256color",
        },
      });

      this.sessions.set(id, { cwd: root, shell });

      // Çıktıları dinle ve renderer'a stream et
      shell.stdout?.on("data", (data: Buffer) => {
        this.cb.onData(id, data.toString().replace(/\n/g, "\r\n"));
      });

      shell.stderr?.on("data", (data: Buffer) => {
        this.cb.onData(id, data.toString().replace(/\n/g, "\r\n"));
      });

      shell.on("error", (err) => {
        this.cb.onData(id, `\r\nHata: Terminal başlatılamadı veya çöktü: ${err.message}\r\n`);
      });

      shell.on("close", (code) => {
        this.sessions.delete(id);
        this.cb.onData(id, `\r\n[Terminal oturumu sonlandı. Çıkış kodu: ${String(code)}]\r\n`);
        this.cb.onExit(id, code ?? 0);
      });

    } catch (error: unknown) {
      const err = error as Error;
      this.cb.onData(id, `\r\nTerminal başlatılırken kritik hata oluştu: ${err.message}\r\n`);
    }
  }

  /** Renderer'dan gelen kullanıcı girdisini kabuğa yaz */
  run(id: string, line: string): void {
    const s = this.sessions.get(id);
    if (!s) {
      this.cb.onData(id, `\r\nAktif bir terminal oturumu bulunamadı. Yeniden başlatılıyor...\r\n`);
      return;
    }

    // Ctrl+C kesme sinyali simülasyonu
    if (line === "\x03") {
      s.shell.kill("SIGINT");
      return;
    }

    // Ekran temizleme komutları
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "clear" || trimmed === "cls") {
      this.cb.onData(id, "\x1b[2J\x1b[H"); // Ekranı temizle ve imleci başa al
    }

    // Girdiyi kabuğun standart girdisine (stdin) yaz ve satır atla
    s.shell.stdin?.write(line + "\n");
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      try {
        // Alt süreç ağacını güvenle sonlandır
        s.shell.stdin?.end();
        s.shell.kill("SIGKILL");
      } catch {
        /* yoksay */
      }
      this.sessions.delete(id);
    }
    this.cb.onExit(id, 0);
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.kill(id);
    }
  }
}
