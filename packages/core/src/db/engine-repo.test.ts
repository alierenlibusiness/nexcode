import { describe, it, expect } from "vitest";
import { openDatabase } from "./connection";
import { EngineRepository } from "./engine-repo";

function repo(): EngineRepository {
  return new EngineRepository(openDatabase(":memory:"));
}

describe("EngineRepository: görev kuyruğu", () => {
  it("prompt'un ilk satırından başlık türetir ve pending olarak açar", () => {
    const task = repo().create({ prompt: "Login akışını düzelt\n\nDetay burada", workingDir: "/w" });
    expect(task.title).toBe("Login akışını düzelt");
    expect(task.status).toBe("pending");
    expect(task.executionMode).toBe("auto");
    expect(task.kind).toBe("task");
  });

  it("claimNext önceliği, eşitlikte yaşı gözetir", () => {
    const r = repo();
    r.create({ prompt: "eski", workingDir: "/w" });
    const urgent = r.create({ prompt: "acil", workingDir: "/w", priority: 5 });
    expect(r.claimNext()?.id).toBe(urgent.id);
  });

  it("operator-chat görevleri kuyruğa alınmaz", () => {
    const r = repo();
    const parent = r.create({ prompt: "ana", workingDir: "/w" });
    r.complete(parent.id, completion());
    r.create({ prompt: "soru", workingDir: "/w", kind: "operator-chat", parentTaskId: parent.id });
    expect(r.claimNext()).toBeNull();
    expect(r.listByStatus("pending")).toHaveLength(0);
  });

  it("markRunning startedAt yazar, complete teslimat özetini kaydeder", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    r.markRunning(task.id);
    expect(r.getById(task.id)?.startedAt).toBeTypeOf("string");

    r.complete(task.id, { ...completion(), delivery: "bitti", changedFiles: 3 });
    const done = r.getById(task.id);
    expect(done?.status).toBe("done");
    expect(done?.delivery).toBe("bitti");
    expect(done?.changedFiles).toBe(3);
    expect(done?.completedAt).toBeTypeOf("string");
  });

  it("çalışan görev silinemez, bekleyen silinir", () => {
    const r = repo();
    const running = r.create({ prompt: "A", workingDir: "/w" });
    r.markRunning(running.id);
    expect(r.remove(running.id)).toBe(false);

    const pending = r.create({ prompt: "B", workingDir: "/w" });
    expect(r.remove(pending.id)).toBe(true);
    expect(r.getById(pending.id)).toBeNull();
  });

  it("yalnızca bekleyen görev düzenlenir ve hedef değişince plan geçersizleşir", () => {
    const r = repo();
    const task = r.create({ prompt: "eski hedef", workingDir: "/w" });
    r.markAwaitingApproval(task.id, "hash-1");
    expect(r.getById(task.id)?.planHash).toBe("hash-1");

    // approval durumundaki görev düzenlenemez.
    expect(r.updatePending(task.id, { prompt: "yeni" })).toBe(false);

    const editable = r.create({ prompt: "ilk", workingDir: "/w" });
    r.startRound(editable.id, 1, "plan", "özet");
    expect(r.updatePending(editable.id, { prompt: "yeni hedef" })).toBe(true);

    const updated = r.getById(editable.id);
    expect(updated?.title).toBe("yeni hedef");
    expect(updated?.planHash).toBeNull();
  });

  it("queueSnapshot failed ve blocked görevleri aynı kovada toplar", () => {
    const r = repo();
    const failed = r.create({ prompt: "F", workingDir: "/w" });
    const blocked = r.create({ prompt: "B", workingDir: "/w" });
    r.complete(failed.id, { ...completion(), status: "failed" });
    r.complete(blocked.id, { ...completion(), status: "blocked" });

    expect(r.queueSnapshot().failed).toHaveLength(2);
  });

  it("replayTarget çalışan görevi tamamlananların önüne koyar", () => {
    const r = repo();
    const older = r.create({ prompt: "eski", workingDir: "/w" });
    r.complete(older.id, completion());
    const active = r.create({ prompt: "aktif", workingDir: "/w" });
    r.markRunning(active.id);

    expect(r.replayTarget()?.id).toBe(active.id);
  });
});

describe("EngineRepository: olay geçmişi", () => {
  it("olayları seq sırasıyla saklar ve son numarayı bildirir", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    r.appendEvent({ seq: 1, taskId: task.id, type: "activity", payload: { text: "başladı" }, ts: "t1" });
    r.appendEvent({ seq: 2, taskId: task.id, type: "activity", payload: { text: "bitti" }, ts: "t2" });

    const events = r.eventsFor(task.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events[0]?.payload).toEqual({ text: "başladı" });
    expect(r.lastEventSeq()).toBe(2);
  });

  it("aynı seq yeniden yazılınca çoğaltmaz (replay tekilleştirmesi)", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    const event = { seq: 7, taskId: task.id, type: "log", payload: { line: "x" }, ts: "t" };
    r.appendEvent(event);
    r.appendEvent(event);
    expect(r.eventsFor(task.id)).toHaveLength(1);
  });

  it("boş geçmişte lastEventSeq sıfırdır", () => {
    expect(repo().lastEventSeq()).toBe(0);
  });
});

describe("EngineRepository: tur, atama, sohbet ve sayaçlar", () => {
  it("atamayı kaydeder ve aynı id yeniden yazılınca günceller", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    r.startRound(task.id, 1, "implement", "plan özeti");

    const assignment = {
      id: "a1",
      agentId: "exec",
      agentName: "Executor",
      adapter: "claude" as const,
      kind: "implement" as const,
      role: "executor" as const,
      instruction: "yaz",
      dependsOn: [],
      skills: ["api-design"],
    };
    r.recordAssignment(task.id, 1, assignment, { status: "failed", output: "", verdict: null, durationMs: 10 });
    r.recordAssignment(task.id, 1, assignment, { status: "completed", output: "tamam", verdict: "PASS", durationMs: 20 });

    const rows = r.assignmentsFor(task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", verdict: "PASS", output: "tamam", durationMs: 20 });
    expect(rows[0]?.skills).toEqual(["api-design"]);
  });

  it("operatör sohbetini kronolojik tutar", () => {
    const r = repo();
    const task = r.create({ prompt: "T", workingDir: "/w" });
    r.appendConversation(task.id, "user", "neden böyle yaptın");
    r.appendConversation(task.id, "operator", "şu yüzden");

    expect(r.conversationFor(task.id).map((c) => c.role)).toEqual(["user", "operator"]);
  });

  it("günlük çağrı sayacı gün değişince sıfırlanır", () => {
    const r = repo();
    r.setCallsToday(12, "2026-08-01");
    expect(r.callsToday("2026-08-01")).toBe(12);
    expect(r.callsToday("2026-08-02")).toBe(0);
  });
});

function completion() {
  return {
    status: "done" as const,
    delivery: "",
    verification: "",
    remainingRisk: "",
    rounds: 1,
    delegations: 1,
    calls: 2,
    usdCost: 0,
    changedFiles: 0,
  };
}
