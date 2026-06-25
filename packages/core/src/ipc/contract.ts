import { z } from "zod";

/**
 * IPC sınır şemaları (PRD §15: tüm IPC kanalları Zod ile doğrulanır).
 * Main process gelen payload'ı `parse` ile doğrular; renderer dönen veriyi tip alır.
 */
export const createWorkspaceInputSchema = z.object({
  name: z.string().min(1, "İsim boş olamaz"),
  repoPath: z.string().min(1, "Repo yolu boş olamaz"),
});
export type CreateWorkspaceInputDTO = z.infer<typeof createWorkspaceInputSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  repoPath: z.string(),
  createdAt: z.string(),
});
export type WorkspaceDTO = z.infer<typeof workspaceSchema>;

export const workspaceListSchema = z.array(workspaceSchema);
export type WorkspaceListDTO = z.infer<typeof workspaceListSchema>;
