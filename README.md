<div align="center">

# Concurrent Task Execution

**Queue five tasks, walk away, come back to five branches.**

</div>

---

## What this branch adds

A supervisor that keeps multiple worker slots busy instead of running the queue one task at
a time.

```jsonc
{
  "worktree": { "mode": "task" },
  "maxConcurrentTasks": 3
}
```

Wall clock time now scales with queue depth instead of queue length. Three independent tasks
finish in roughly the time of the slowest one.

## Isolation is not optional

`maxConcurrentTasks > 1` requires `worktree.mode: "task"`.

This is enforced in two places, deliberately. Config normalization clamps the value to 1 so a
hand-edited file can never produce the unsafe state, and the IPC layer rejects the save with
an explicit message so you find out why instead of wondering where your setting went.

The reason is simple: without isolation, parallel agents write into the same directory. One
agent's half-finished refactor becomes another agent's baseline. Both deliveries are garbage
and neither failure is obvious.

## Separation of concerns

The engine still runs exactly one task. It has no idea concurrency exists.

The supervisor owns the concurrency policy and nothing else:

```ts
new EngineSupervisor({
  config: () => config,
  events: bus,
  claimNext: (activeIds) => queue.claimNext(activeIds),
  runTask: (task) => host.runTask(task),   // isolation, engine, delivery, cleanup
});
```

`runTask` is a port. Everything about how a task actually executes lives behind it. That is
why the supervisor's whole contract is testable in milliseconds with no real work involved.

## Guarantees

**One task, one slot.** `claimNext(activeIds)` receives the ids currently running and excludes
them at the SQL level, so the same task can never be handed to two slots.

**A crashing slot is contained.** An exception inside one slot is caught, published as an
event, and the slot is released. The other slots and the queue loop keep running.

**Stop does not kill work.** `stop()` stops accepting new tasks and waits for in-flight ones
to finish. A halfway-terminated agent means halfway-written files, so cancellation is a
separate, explicit action rather than a side effect of pausing the queue.

**Idle costs nothing.** The loop sleeps for `pollSeconds` and is woken early when a task is
queued or a slot frees up, instead of spinning.

## Status reporting

`EngineStatus` was extended additively:

```ts
{
  currentTaskId: string | null;  // still singular: first active task
  activeTaskIds: string[];       // new
  concurrency: number;           // new
}
```

Single-task UIs read `currentTaskId` and keep working unchanged. The Board and Command Center
read `activeTaskIds` to show every running slot.

## Files

```
packages/core/src/engine/supervisor.ts        slot management and queue loop
packages/core/src/engine/supervisor.test.ts   12 deterministic concurrency tests
packages/core/src/db/engine-repo.ts           claimNext(skipIds) ownership query
```

The tests measure real overlap using controlled task completion rather than timers, so
"three tasks actually ran at once" is asserted, not assumed.

## Verify

```bash
pnpm test --filter supervisor
```

## License

MIT. See [`LICENSE`](LICENSE).
