// Native bağımlılıklı MCP katmanı (node:child_process). Yalnızca main process'te kullanılır.
// Renderer bu alt yola (`@nexcode/core/mcp`) erişmemelidir; saf protokol tipleri için
// `@nexcode/core` yeterlidir.
export * from "./client";
export * from "./manager";
