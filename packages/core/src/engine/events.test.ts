import { describe, expect, it, vi } from "vitest";
import { EngineEventBus, mergeReplay, type EngineEvent } from "./events";

const clock = () => new Date("2026-07-25T12:00:00.000Z");

describe("EngineEventBus", () => {
  it("produces a monotonically increasing sequence number", () => {
    const bus = new EngineEventBus();
    const first = bus.emit("log", null, { level: "info", message: "a" }, clock);
    const second = bus.emit("log", null, { level: "info", message: "b" }, clock);
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(bus.lastSeq).toBe(2);
  });

  it("continues numbering from the history after a restart", () => {
    const bus = new EngineEventBus(41);
    expect(bus.emit("log", null, { level: "info", message: "x" }, clock).seq).toBe(42);
  });

  it("notifies subscribers and supports unsubscribing", () => {
    const bus = new EngineEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);

    bus.emit("log", null, { level: "warn", message: "careful" }, clock);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.emit("log", null, { level: "warn", message: "again" }, clock);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("builds the event body according to the type contract", () => {
    const bus = new EngineEventBus();
    const event = bus.emit(
      "message",
      "task-1",
      {
        assignmentId: "a1",
        kind: "delegation",
        from: "ceo",
        to: "backend",
        assignmentKind: "implement",
        role: "executor",
        summary: "Add the endpoint",
        round: 1,
      },
      clock,
    );
    expect(event.type).toBe("message");
    expect(event.taskId).toBe("task-1");
    expect(event.ts).toBe("2026-07-25T12:00:00.000Z");
  });
});

describe("mergeReplay", () => {
  function log(seq: number): EngineEvent {
    return { type: "log", seq, ts: "", taskId: null, payload: { level: "info", message: `#${String(seq)}` } };
  }

  it("de-duplicates live events that are already in the history", () => {
    const merged = mergeReplay([log(1), log(2), log(3)], [log(2), log(3), log(4)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it("applies buffered events in sequence order", () => {
    const merged = mergeReplay([log(1)], [log(5), log(3)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 3, 5]);
  });

  it("does not disturb the history when there is no live event", () => {
    expect(mergeReplay([log(1), log(2)], []).map((e) => e.seq)).toEqual([1, 2]);
  });

  it("does not roll back a newer live diff with older replay data", () => {
    // The history has 1..3; 4 arrived on the live stream. The result must end with 4.
    const merged = mergeReplay([log(1), log(2), log(3)], [log(4)]);
    expect(merged[merged.length - 1]?.seq).toBe(4);
  });
});
