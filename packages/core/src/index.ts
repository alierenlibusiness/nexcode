// The pure (native-free) public API. The renderer and the main process can both import it.
// Modules with a native dependency live under separate subpaths:
//   `@nexcode/core/db`        better-sqlite3 (main only)
//   `@nexcode/core/keyring`   OS keychain (main only)
//   `@nexcode/core/providers` node:child_process (main only)
export * from "./domain/agent";
export * from "./domain/task";
export * from "./domain/workspace";
export * from "./security/secret-store";
export * from "./ipc/channels";
export * from "./ipc/contract";
export * from "./logger";

// The configuration contract.
export * from "./config/schema";
export * from "./config/defaults";

// Orchestration engine: the pure core. Process, file and DB access are injected via EngineDeps.
export * from "./engine/events";
export * from "./engine/protocol";
export * from "./engine/rounds";
export * from "./engine/routing";
export * from "./engine/verdict";
export * from "./engine/recovery";
export * from "./engine/prompt";
export * from "./engine/live-diff";
export * from "./engine/engine";
export * from "./engine/supervisor";

// Runtime services: pure core, with file system access through ports.
export * from "./worktree/worktree";
export * from "./verify/verify-gate";
export * from "./skills/registry";
export * from "./checkpoints/checkpoints";
export * from "./schedule/schedule";
export * from "./sandbox/sandbox";
export * from "./context/project-context";
export * from "./notify/webhook";
export * from "./doctor";
export * from "./approval/gate";
export * from "./agents/definitions";

// Providers: the type and catalog layer. The runner that spawns processes is in a separate subpath.
export * from "./providers/cli/adapters";
export * from "./providers/cli/output";
export * from "./providers/types";
export * from "./providers/registry";
export * from "./providers/pricing";
export * from "./providers/cost";
export * from "./providers/quota";
export * from "./providers/anthropic";
export * from "./providers/openai-compatible";
export * from "./providers/google";
export * from "./providers/connection";

// MCP: the pure protocol layer. The client and the manager depend on `node:child_process`,
// so they are NOT here but under the `@nexcode/core/mcp` subpath (main process only).
export * from "./json";
export * from "./mcp/server";
