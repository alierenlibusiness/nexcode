/** Yapısal (JSON) loglama. */
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface LogRecord {
  ts: string;
  level: LogLevel;
  message: string;
  [field: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

/**
 * Loglar **standart hataya** yazılır, standart çıktıya değil.
 *
 * Standart çıktı programın kendi çıktısına ayrılmıştır. MCP stdio sunucusu stdout'u
 * JSON-RPC protokolü için kullanır; oraya düşen tek bir log satırı istemcinin
 * ayrıştırmasını bozar ve bağlantıyı öldürür.
 */
const defaultSink: LogSink = (record) => {
  process.stderr.write(`${JSON.stringify(record)}\n`);
};

let sink: LogSink = defaultSink;

/** Log hedefini değiştirir (ör. masaüstünde dosyaya ya da devtools'a yazmak için). */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? defaultSink;
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  sink({ ts: new Date().toISOString(), level, message, ...fields });
}

export const logger = {
  debug: (message: string, fields?: LogFields): void => emit("debug", message, fields),
  info: (message: string, fields?: LogFields): void => emit("info", message, fields),
  warn: (message: string, fields?: LogFields): void => emit("warn", message, fields),
  error: (message: string, fields?: LogFields): void => emit("error", message, fields),
};
