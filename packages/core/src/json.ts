/**
 * JSON üzerinden taşınabilen değerler.
 *
 * IPC, MCP ve operatör protokolü sınırlarında `any` yerine kullanılır. Saf tip modülüdür:
 * hiçbir çalışma zamanı bağımlılığı yoktur, bu yüzden renderer da güvenle import edebilir.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
