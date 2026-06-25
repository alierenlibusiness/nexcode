import { describe, it, expect, vi } from "vitest";
import { InProcessTaskQueue } from "./queue";

describe("InProcessTaskQueue", () => {
  it("başarılı görevde onCompleted çağırır", async () => {
    const onCompleted = vi.fn();
    const queue = new InProcessTaskQueue(async () => {}, { onCompleted });
    queue.enqueue("t1");
    expect(queue.size).toBe(1);
    await queue.drain();
    expect(onCompleted).toHaveBeenCalledWith("t1");
    expect(queue.size).toBe(0);
  });

  it("3 denemeden sonra görevi blocked'a alır (PRD §6.4)", async () => {
    const processor = vi.fn(async () => {
      throw new Error("boom");
    });
    const onBlocked = vi.fn();
    const queue = new InProcessTaskQueue(processor, { onBlocked }, 3);
    queue.enqueue("t1");
    await queue.drain();

    expect(processor).toHaveBeenCalledTimes(3);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked.mock.calls[0]?.[0]).toBe("t1");
    expect(onBlocked.mock.calls[0]?.[2]).toBe(3);
  });

  it("birden fazla görevi sırayla işler", async () => {
    const seen: string[] = [];
    const queue = new InProcessTaskQueue(async (id) => {
      seen.push(id);
    });
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    await queue.drain();
    expect(seen).toEqual(["a", "b", "c"]);
  });
});
