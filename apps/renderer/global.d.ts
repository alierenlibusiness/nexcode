import type { Workspace } from "@nexcode/core";

declare global {
  interface Window {
    /** Electron preload tarafından enjekte edilen güvenli IPC köprüsü. */
    nexcode?: {
      createWorkspace(input: { name: string; repoPath: string }): Promise<Workspace>;
      listWorkspaces(): Promise<Workspace[]>;
    };
  }
}

export {};
