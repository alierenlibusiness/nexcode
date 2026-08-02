/** Structured (JSON) logging. */
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
 * Logs are written to **stderr**, not to stdout.
 *
 * Stdout is reserved for the program's own output. The MCP stdio server uses stdout for the
 * JSON-RPC protocol; a single log line landing there breaks the client's parsing and kills
 * the connection.
 */
const defaultSink: LogSink = (record) => {
  process.stderr.write(`${JSON.stringify(record)}\n`);
};

let sink: LogSink = defaultSink;

/** Changes the log destination (for example writing to a file or devtools on the desktop). */
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
