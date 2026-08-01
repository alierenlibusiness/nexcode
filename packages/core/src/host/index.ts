// Motor konağı: saf çekirdeği gerçek süreçler, dosya sistemi ve veritabanıyla birleştirir.
// `node:child_process` ve `better-sqlite3` bağımlıdır; yalnızca sunucu tarafında (Electron
// main process ya da CLI) kullanılır. Renderer bu alt yola erişmemelidir.
export * from "./process-ports";
export * from "./engine-host";
export * from "./scheduler";
