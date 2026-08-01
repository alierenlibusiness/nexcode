<div align="center">

# Checkpoints

**Every task snapshots your working directory before it starts. One click puts it back.**

</div>

---

## What this branch adds

Automatic pre-task versioning, and a restore that is itself undoable.

Before any agent runs, NEXCODE captures the working directory. Later, "return to this
version" restores what was changed, brings back what was deleted, and removes what was
created, putting the directory back exactly as it was.

## Undoing the undo

The part most snapshot systems get wrong.

Before restoring anything, NEXCODE takes a **redo** snapshot of the current state. If you
restore and immediately realize the agent's version was actually better, it is still there.

```
capture (pre)  -> agent works -> capture (redo) -> restore (pre)
                                       |
                                       +-- the agent's work, still recoverable
```

Without this, "undo" is a destructive operation wearing a friendly label.

## Restore is refused while the engine is busy

```ts
async restore(id: string, engineIdle: boolean): Promise<RestoreResult> {
  if (!engineIdle) {
    return { ok: false, error: "Restore is only allowed while the engine is idle." };
  }
  // ...
}
```

Pulling files out from under a running agent produces a directory that matches neither
version and a task whose output is meaningless. The refusal is explicit and surfaced in the
UI rather than silently ignored.

## What is never stored

Snapshots skip what they cannot store safely:

| Case | Stored | On restore |
|---|---|---|
| Normal text file | full content | rewritten |
| Binary file | marked, content `NULL` | untouched |
| Oversized file | marked, content `NULL` | untouched |
| `.env`, credentials, private keys | marked, content `NULL` | untouched |

Sensitive files are recorded as "this existed" without duplicating their contents into the
database. Restore reports them as skipped instead of silently overwriting your secrets with a
stale copy.

`.git`, `node_modules` and runtime directories are never walked at all.

## Retention

`versioningRetention` (default 20) caps snapshots per working directory. Older ones are
pruned newest-first after each capture, so history stays bounded without manual cleanup.

## Report

A restore returns exactly what it did:

```ts
{
  restored: ["README.md", "src/app.ts"],
  deleted:  ["src/scratch.ts"],
  skipped:  [".env"],
  redoCheckpointId: "cp-4"
}
```

No guessing about what a "successful" restore touched.

## Files

```
packages/core/src/checkpoints/checkpoints.ts       capture, restore, prune
packages/core/src/db/checkpoint-store.ts           SQLite plus filesystem port
packages/core/src/db/checkpoint-store.test.ts      end-to-end against a real temp directory
```

The logic is pure and the storage is a port, so restore semantics are tested against real
files while remaining independent of any particular backend.

## Verify

```bash
pnpm test --filter checkpoint
```

## License

MIT. See [`LICENSE`](LICENSE).
