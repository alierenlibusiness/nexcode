import { describe, it, expect } from "vitest";
import { createWorkspaceInputSchema, workspaceSchema } from "./contract";

describe("IPC kontrat şemaları", () => {
  it("geçerli createWorkspace girdisini kabul eder", () => {
    const parsed = createWorkspaceInputSchema.parse({ name: "X", repoPath: "/x" });
    expect(parsed.name).toBe("X");
  });

  it("boş isim/repoPath'i reddeder", () => {
    expect(() => createWorkspaceInputSchema.parse({ name: "", repoPath: "/x" })).toThrow();
    expect(() => createWorkspaceInputSchema.parse({ name: "X", repoPath: "" })).toThrow();
  });

  it("eksik alanı reddeder", () => {
    expect(() => createWorkspaceInputSchema.parse({ name: "X" })).toThrow();
  });

  it("workspace çıktısını doğrular", () => {
    const ok = workspaceSchema.safeParse({
      id: "1",
      name: "X",
      repoPath: "/x",
      createdAt: new Date().toISOString(),
    });
    expect(ok.success).toBe(true);
  });
});
