import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import type { CommandResult, WorktreePort } from "@nexcode/core";

/**
 * Süreç ve dosya sistemi port'ları.
 *
 * Çekirdek (`@nexcode/core`) saf tutulur: worktree ve doğrulama kapısı komut çalıştırmayı
 * bilmez, yalnızca port çağırır. Süreç yönetiminin tamamı bu dosyadadır.
 */

export interface RunOptions {
  command: string;
  args?: string[];
  cwd: string;
  timeoutMs: number;
  /** Kabuk yorumlaması (kullanıcının yazdığı komutlar için). */
  shell?: boolean;
  env?: Record<string, string>;
  onChunk?: (chunk: string, stream: "stdout" | "stderr") => void;
  /** Yeni çıktı gelmezse süreci sonlandırma süresi. */
  silenceMs?: number;
  /** Standart girdiye yazılacak metin (prompt'u stdin'den alan CLI'lar için). */
  stdin?: string;
}

/**
 * Bir süreci çalıştırır ve sonucu döndürür.
 *
 * Asla `reject` etmez: çalıştırılamayan komut da bir sonuçtur ve çağıran katman bunu
 * uyarıya çevirir. Hem toplam süre hem de sessizlik zaman aşımı uygulanır; sessizlik
 * aşımı uzun süren ama ilerleyen işleri yanlışlıkla öldürmeyi engeller.
 */
export function runProcess(options: RunOptions): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      shell: options.shell ?? false,
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      clearTimeout(silenceTimer);
      resolve(result);
    };

    const kill = (reason: "timeout" | "silence"): void => {
      timedOut = true;
      child.kill();
      // Nazik sonlandırma yanıtsız kalırsa süreç ağacı asılı kalmasın.
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
      finish({
        ok: false,
        stdout,
        stderr: `${stderr}\n[${reason === "timeout" ? "süre aşımı" : "uzun süredir yeni çıktı yok"}]`.trim(),
        timedOut: true,
      });
    };

    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }

    const hardTimer = setTimeout(() => kill("timeout"), options.timeoutMs);
    let silenceTimer: NodeJS.Timeout = setTimeout(() => undefined, 0);

    const resetSilence = (): void => {
      if (options.silenceMs === undefined) return;
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => kill("silence"), options.silenceMs);
    };
    resetSilence();

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onChunk?.(text, "stdout");
      resetSilence();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      options.onChunk?.(text, "stderr");
      resetSilence();
    });

    child.on("error", (error) => {
      finish({ ok: false, stdout, stderr: `${stderr}\n${String(error)}`.trim() });
    });

    child.on("close", (code) => {
      if (timedOut) return;
      finish({ ok: code === 0, stdout, stderr });
    });
  });
}

/** Worktree katmanının ihtiyaç duyduğu süreç ve dosya sistemi işlemleri. */
export const nodeWorktreePort: WorktreePort = {
  run: ({ command, args, cwd, timeoutMs }) => runProcess({ command, args, cwd, timeoutMs }),
  runShell: ({ command, cwd, timeoutMs }) => runProcess({ command, cwd, timeoutMs, shell: true }),
  exists: (path) => Promise.resolve(existsSync(path)),
  mkdirp: (path) => {
    mkdirSync(path, { recursive: true });
    return Promise.resolve();
  },
  link: (target, linkPath) => {
    // Windows'ta junction, dizinler için yönetici izni gerektirmez.
    symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    return Promise.resolve();
  },
  removeDir: (path) => {
    rmSync(path, { recursive: true, force: true });
    return Promise.resolve();
  },
};

/** Doğrulama kapısı yalnızca kabuk komutu çalıştırır. */
export const nodeVerifyPort = {
  runShell: ({ command, cwd, timeoutMs }: { command: string; cwd: string; timeoutMs: number }) =>
    runProcess({ command, cwd, timeoutMs, shell: true }),
};
