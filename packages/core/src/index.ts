// Saf (native-bağımsız) genel API — renderer ve main process güvenle import edebilir.
// Native bağımlılıklı modüller ayrı alt yollardadır:
//   - `@nexcode/core/db`      → better-sqlite3 (yalnızca main)
//   - `@nexcode/core/keyring` → OS keychain (yalnızca main)
export * from "./domain/agent";
export * from "./domain/task";
export * from "./domain/workspace";
export * from "./security/secret-store";
export * from "./ipc/channels";
export * from "./ipc/contract";
export * from "./logger";

// Orkestrasyon çekirdeği (Faz 1) — saf (native-bağımsız) modüller
// NOT: CLI runner/adapter + factory node:child_process'e bağlı olduğundan
// burada DEĞİL, `@nexcode/core/providers` alt yolundadır (yalnızca main process).
export * from "./approval/gate";
export * from "./agents/definitions";
export * from "./agents/escalation";
export * from "./agents/message-bus";
export * from "./providers/types";
export * from "./providers/registry";
export * from "./providers/pricing";
export * from "./providers/cost";
export * from "./providers/quota";
export * from "./providers/anthropic";
export * from "./providers/openai-compatible";
export * from "./providers/google";
export * from "./providers/connection";
export * from "./tasks/queue";
export * from "./orchestrator/plan";
export * from "./orchestrator/coordination";
export * from "./orchestrator/conflict-resolver";
export * from "./orchestrator/orchestrator";
