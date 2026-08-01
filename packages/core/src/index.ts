// Saf (native-bağımsız) genel API. Renderer ve main process güvenle import edebilir.
// Native bağımlılıklı modüller ayrı alt yollardadır:
//   `@nexcode/core/db`        better-sqlite3 (yalnızca main)
//   `@nexcode/core/keyring`   OS keychain (yalnızca main)
//   `@nexcode/core/providers` node:child_process (yalnızca main)
export * from "./domain/agent";
export * from "./domain/task";
export * from "./domain/workspace";
export * from "./security/secret-store";
export * from "./ipc/channels";
export * from "./ipc/contract";
export * from "./logger";

// Yapılandırma sözleşmesi.
export * from "./config/schema";
export * from "./config/defaults";

// Orkestrasyon motoru: saf çekirdek. Süreç, dosya ve DB erişimi EngineDeps ile enjekte edilir.
export * from "./engine/events";
export * from "./engine/protocol";
export * from "./engine/rounds";
export * from "./engine/routing";
export * from "./engine/verdict";
export * from "./engine/recovery";
export * from "./engine/prompt";
export * from "./engine/live-diff";
export * from "./engine/engine";

// Runtime servisleri: saf çekirdek, dosya sistemi erişimi port'lar üzerinden.
export * from "./skills/registry";
export * from "./checkpoints/checkpoints";
export * from "./schedule/schedule";
export * from "./sandbox/sandbox";
export * from "./context/project-context";
export * from "./notify/webhook";
export * from "./doctor";
export * from "./approval/gate";
export * from "./agents/definitions";

// Sağlayıcılar: tip ve katalog katmanı. Süreç başlatan runner ayrı alt yoldadır.
export * from "./providers/cli/adapters";
export * from "./providers/types";
export * from "./providers/registry";
export * from "./providers/pricing";
export * from "./providers/cost";
export * from "./providers/quota";
export * from "./providers/anthropic";
export * from "./providers/openai-compatible";
export * from "./providers/google";
export * from "./providers/connection";

// MCP istemci katmanı.
export * from "./mcp/client";
export * from "./mcp/manager";
