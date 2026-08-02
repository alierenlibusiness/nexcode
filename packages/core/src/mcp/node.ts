// MCP layer with a native dependency (node:child_process). Used only in the main process.
// The renderer must not reach into this subpath (`@nexcode/core/mcp`); `@nexcode/core` is
// enough for the pure protocol types.
export * from "./client";
export * from "./manager";
