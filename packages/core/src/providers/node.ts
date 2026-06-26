// Node-only provider katmanı (node:child_process'e bağlı) — yalnızca Electron main
// process'te kullanılır. Renderer bu alt yola (`@nexcode/core/providers`) erişmemelidir.
export * from "./cli/runner";
export * from "./cli/claude-code";
export * from "./cli/codex";
export * from "./cli/antigravity";
export * from "./factory";
