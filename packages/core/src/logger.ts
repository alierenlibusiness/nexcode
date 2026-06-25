/** Yapısal (JSON) loglama (PRD §18). */
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  const record = { ts: new Date().toISOString(), level, message, ...fields };
  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields): void => emit("debug", message, fields),
  info: (message: string, fields?: LogFields): void => emit("info", message, fields),
  warn: (message: string, fields?: LogFields): void => emit("warn", message, fields),
  error: (message: string, fields?: LogFields): void => emit("error", message, fields),
};
