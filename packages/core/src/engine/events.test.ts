import { describe, expect, it, vi } from "vitest";
import { EngineEventBus, mergeReplay, type EngineEvent } from "./events";

const clock = () => new Date("2026-07-25T12:00:00.000Z");

describe("EngineEventBus", () => {
  it("monoton artan sıra numarası üretir", () => {
    const bus = new EngineEventBus();
    const first = bus.emit("log", null, { level: "info", message: "a" }, clock);
    const second = bus.emit("log", null, { level: "info", message: "b" }, clock);
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(bus.lastSeq).toBe(2);
  });

  it("yeniden başlatmada geçmişin devamından numaralar", () => {
    const bus = new EngineEventBus(41);
    expect(bus.emit("log", null, { level: "info", message: "x" }, clock).seq).toBe(42);
  });

  it("aboneleri bilgilendirir ve abonelik iptalini destekler", () => {
    const bus = new EngineEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);

    bus.emit("log", null, { level: "warn", message: "dikkat" }, clock);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.emit("log", null, { level: "warn", message: "yine" }, clock);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("olay gövdesini tip sözleşmesine uygun kurar", () => {
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
        summary: "Endpoint ekle",
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

  it("geçmişte bulunan canlı olayları tekilleştirir", () => {
    const merged = mergeReplay([log(1), log(2), log(3)], [log(2), log(3), log(4)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it("tamponlanan olayları sıra numarasına göre uygular", () => {
    const merged = mergeReplay([log(1)], [log(5), log(3)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 3, 5]);
  });

  it("canlı olay yoksa geçmişi bozmaz", () => {
    expect(mergeReplay([log(1), log(2)], []).map((e) => e.seq)).toEqual([1, 2]);
  });

  it("yeni canlı diff'i daha eski replay verisiyle geri almaz", () => {
    // Geçmişte 1..3 var; canlı akışta 4 geldi. Sonuç 4 ile bitmelidir.
    const merged = mergeReplay([log(1), log(2), log(3)], [log(4)]);
    expect(merged[merged.length - 1]?.seq).toBe(4);
  });
});
