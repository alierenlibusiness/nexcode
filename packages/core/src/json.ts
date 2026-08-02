/**
 * Values that can travel over JSON.
 *
 * Used instead of `any` at the IPC, MCP and operator protocol boundaries. It is a pure type
 * module with no runtime dependency, so the renderer can import it safely too.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
