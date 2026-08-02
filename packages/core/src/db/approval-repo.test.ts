import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { WorkspaceRepository } from "./workspace-repo";
import { EngineRepository } from "./engine-repo";
import { ApprovalRepository } from "./approval-repo";

function setup() {
  const db = openDatabase(":memory:");
  const ws = new WorkspaceRepository(db).create({ name: "W", repoPath: "/w" });
  const tasks = new EngineRepository(db);
  const task = tasks.create({ prompt: "Deploy", workingDir: "/w" });
  return { approvals: new ApprovalRepository(db), taskId: task.id, workspaceId: ws.id };
}

describe("ApprovalRepository", () => {
  it("creates a pending approval and lists it", () => {
    const { approvals, taskId } = setup();
    const rec = approvals.create(taskId, "production_deploy");
    expect(rec.status).toBe("pending");
    expect(approvals.listPending().map((r) => r.id)).toContain(rec.id);
  });

  it("resolves an approval and removes it from the pending list", () => {
    const { approvals, taskId } = setup();
    const rec = approvals.create(taskId, "git_push");
    approvals.resolve(rec.id, "approved", "ali");
    const after = approvals.getById(rec.id);
    expect(after?.status).toBe("approved");
    expect(after?.resolvedBy).toBe("ali");
    expect(after?.resolvedAt).toBeTypeOf("string");
    expect(approvals.listPending()).toHaveLength(0);
  });
});
