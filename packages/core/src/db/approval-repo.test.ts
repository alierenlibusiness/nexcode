import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { WorkspaceRepository } from "./workspace-repo";
import { TaskRepository } from "./task-repo";
import { ApprovalRepository } from "./approval-repo";

function setup() {
  const db = openDatabase(":memory:");
  const ws = new WorkspaceRepository(db).create({ name: "W", repoPath: "/w" });
  const tasks = new TaskRepository(db);
  const task = tasks.create({ title: "Deploy" });
  return { approvals: new ApprovalRepository(db), taskId: task.id, workspaceId: ws.id };
}

describe("ApprovalRepository", () => {
  it("pending onay oluşturur ve listeler", () => {
    const { approvals, taskId } = setup();
    const rec = approvals.create(taskId, "production_deploy");
    expect(rec.status).toBe("pending");
    expect(approvals.listPending().map((r) => r.id)).toContain(rec.id);
  });

  it("onayı çözer (approved) ve pending listesinden çıkarır", () => {
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
