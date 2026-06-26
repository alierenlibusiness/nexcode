import { describe, it, expect, vi } from "vitest";
import { MessageBus, type AgentMessage } from "./message-bus";

describe("MessageBus (PRD §6.7)", () => {
  it("alıcı role'e göre teslim eder ve id/createdAt ekler", async () => {
    const bus = new MessageBus();
    const received: AgentMessage[] = [];
    bus.on("security", (m) => void received.push(m));

    const sent = await bus.publish({
      from: "backend",
      to: "security",
      type: "review_request",
      payload: { diffId: "d-1", files: ["api/users.ts"], taskId: "t-1" },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.from).toBe("backend");
    expect(sent.id).toBeTruthy();
    expect(sent.createdAt).toBeTruthy();
  });

  it("eşleşmeyen alıcıya teslim etmez", async () => {
    const bus = new MessageBus();
    const qa = vi.fn();
    bus.on("qa", qa);
    await bus.publish({ from: "backend", to: "security", type: "review_request", payload: {} });
    expect(qa).not.toHaveBeenCalled();
  });

  it("tipe göre abonelik (role'den bağımsız)", async () => {
    const bus = new MessageBus();
    const onTest = vi.fn();
    bus.onType("test_request", onTest);
    await bus.publish({ from: "frontend", to: "qa", type: "test_request", payload: { taskId: "t" } });
    await bus.publish({ from: "backend", to: "security", type: "review_request", payload: {} });
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe sonrası teslim durur ve geçmiş tutulur", async () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    const off = bus.on("qa", handler);
    await bus.publish({ from: "frontend", to: "qa", type: "test_request", payload: {} });
    off();
    await bus.publish({ from: "frontend", to: "qa", type: "test_request", payload: {} });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.history()).toHaveLength(2);
  });
});
