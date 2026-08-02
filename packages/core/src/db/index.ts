// DB layer with a native dependency (better-sqlite3). Used only in the main process.
// The renderer must not reach into this subpath (`@nexcode/core/db`).
export * from "./schema";
export * from "./connection";

// Engine persistence: queue, round and assignment records, event history, operator conversation, counters.
export * from "./engine-repo";
export * from "./config-repo";
export * from "./schedule-repo";
export * from "./checkpoint-store";

// Supporting stores.
export * from "./workspace-repo";
export * from "./settings-repo";
export * from "./approval-repo";
export * from "./cost-log-repo";
export * from "./mcp-repo";
export * from "./skill-repo";
