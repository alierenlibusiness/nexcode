import { z } from "zod";

/**
 * IPC sınır şemaları (PRD §15: tüm IPC kanalları Zod ile doğrulanır).
 * Main process gelen payload'ı `parse` ile doğrular; renderer dönen veriyi tip alır.
 */

const agentRoleSchema = z.enum(["ceo", "frontend", "backend", "security", "qa", "devops"]);
const connectionPreferenceSchema = z.enum(["api_only", "cli_only", "cli_first"]);

// --- Workspace ---
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

// --- Orkestrasyon ---
export const completionImageSchema = z.object({
  mimeType: z.string(),
  data: z.string(),
});

export const requestPlanInputSchema = z.object({
  request: z.string().min(1, "İstek boş olamaz"),
  images: z.array(completionImageSchema).optional(),
});
export type RequestPlanInputDTO = z.infer<typeof requestPlanInputSchema>;

export const taskDispatchInputSchema = z.object({ taskId: z.string().min(1) });

// --- Onay ---
export const approvalResolveInputSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["approved", "rejected"]),
});
export type ApprovalResolveInputDTO = z.infer<typeof approvalResolveInputSchema>;

// --- Bağlantı modu ---
export const connectionSetInputSchema = z.object({
  role: agentRoleSchema,
  preference: connectionPreferenceSchema,
});
export type ConnectionSetInputDTO = z.infer<typeof connectionSetInputSchema>;

// --- Sır / anahtar ---
export const secretSetApiKeyInputSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1),
});
export type SecretSetApiKeyInputDTO = z.infer<typeof secretSetApiKeyInputSchema>;

export const secretHasApiKeyInputSchema = z.object({ provider: z.string().min(1) });

// --- Faz 2: agent başına model seçimi (kullanıcı AI seçer) ---
export const agentModelSetInputSchema = z.object({
  role: agentRoleSchema,
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
export type AgentModelSetInputDTO = z.infer<typeof agentModelSetInputSchema>;

export const providerModelSchema = z.object({
  modelId: z.string(),
  label: z.string(),
  vision: z.boolean().optional(),
});
export const providerInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["anthropic", "openai-compatible", "google"]),
  cli: z.string().optional(),
  models: z.array(providerModelSchema),
});
export type ProviderInfoDTO = z.infer<typeof providerInfoSchema>;

// --- Faz 2: dosya sistemi (IDE kabuğu) ---
export const fsReadDirInputSchema = z.object({ path: z.string().min(1) });
export const fsReadFileInputSchema = z.object({ path: z.string().min(1) });
export const fsWriteFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});
export type FsWriteFileInputDTO = z.infer<typeof fsWriteFileInputSchema>;

export const fsEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "directory"]),
});
export type FsEntryDTO = z.infer<typeof fsEntrySchema>;

// --- Faz 2: terminal ---
export const terminalStartInputSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().optional(),
});
export const terminalInputSchema = z.object({ id: z.string().min(1), data: z.string() });
export const terminalResizeInputSchema = z.object({
  id: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export const terminalKillInputSchema = z.object({ id: z.string().min(1) });

// --- MCP ---
export const mcpSaveInputSchema = z.object({
  name: z.string().min(1, "İsim boş olamaz"),
  command: z.string().min(1, "Komut boş olamaz"),
  args: z.array(z.string()),
  env: z.record(z.string()),
});
export type McpSaveInputDTO = z.infer<typeof mcpSaveInputSchema>;

export const mcpRemoveInputSchema = z.object({
  id: z.string().min(1),
});

export const mcpToggleInputSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

export const mcpCallToolInputSchema = z.object({
  serverName: z.string().min(1),
  toolName: z.string().min(1),
  args: z.any(),
});

// --- Skills ---
export const skillsSaveInputSchema = z.object({
  name: z.string().min(1, "İsim boş olamaz"),
  description: z.string(),
  prompt: z.string().min(1, "Prompt boş olamaz"),
});
export type SkillsSaveInputDTO = z.infer<typeof skillsSaveInputSchema>;

export const skillsRemoveInputSchema = z.object({
  id: z.string().min(1),
});

