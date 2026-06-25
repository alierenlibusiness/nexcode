import { ipcMain } from "electron";
import { IpcChannels, createWorkspaceInputSchema, logger } from "@nexcode/core";
import { WorkspaceRepository, type DB } from "@nexcode/core/db";

/**
 * IPC handler'larını kaydeder. Gelen tüm payload'lar Zod ile doğrulanır (PRD §15).
 */
export function registerIpcHandlers(db: DB): void {
  const workspaces = new WorkspaceRepository(db);

  ipcMain.handle(IpcChannels.workspaceCreate, (_event, raw: unknown) => {
    const input = createWorkspaceInputSchema.parse(raw);
    const created = workspaces.create(input);
    logger.info("workspace.created", { id: created.id, name: created.name });
    return created;
  });

  ipcMain.handle(IpcChannels.workspaceList, () => workspaces.list());
}
