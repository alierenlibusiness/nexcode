/**
 * Basit, in-process görev kuyruğu (PRD §5.3, §6.4).
 * Bir görev `maxAttempts` defa hata alırsa `onBlocked` ile insana eskale edilir
 * (varsayılan 3 — PRD §6.4). Harici Redis/BullMQ gerektirmez.
 */
export type TaskProcessor = (taskId: string) => Promise<void>;

export interface TaskQueueEvents {
  onCompleted?: (taskId: string) => void;
  onBlocked?: (taskId: string, error: unknown, attempts: number) => void;
}

export class InProcessTaskQueue {
  private readonly pending: string[] = [];
  private readonly attempts = new Map<string, number>();
  private draining = false;

  constructor(
    private readonly processor: TaskProcessor,
    private readonly events: TaskQueueEvents = {},
    private readonly maxAttempts = 3,
  ) {}

  enqueue(taskId: string): void {
    this.pending.push(taskId);
  }

  get size(): number {
    return this.pending.length;
  }

  /** Bekleyen tüm görevleri sırayla işler. Yeniden girişe karşı korumalıdır. */
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let taskId = this.pending.shift(); taskId !== undefined; taskId = this.pending.shift()) {
        await this.runOne(taskId);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runOne(taskId: string): Promise<void> {
    const previous = this.attempts.get(taskId) ?? 0;
    try {
      await this.processor(taskId);
      this.attempts.delete(taskId);
      this.events.onCompleted?.(taskId);
    } catch (error) {
      const next = previous + 1;
      this.attempts.set(taskId, next);
      if (next >= this.maxAttempts) {
        this.attempts.delete(taskId);
        this.events.onBlocked?.(taskId, error, next);
      } else {
        this.pending.push(taskId);
      }
    }
  }
}
