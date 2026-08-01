<div align="center">

# Persistence Layer

**One SQLite file holds the queue, the history and every decision the operator made.**

</div>

---

## What this branch adds

The storage layer behind the orchestration engine: task queue, round and assignment records,
a persistent event log, operator conversations, checkpoints, schedules and counters.

One file. Transactional. Portable. Close the app mid-task and everything is still there when
you reopen it.

## Why SQLite instead of JSON files

Task state is written from multiple slots at once. Snapshots and events must land together or
not at all. History has to be queryable by task, by round and by sequence.

A directory of JSON files gives you none of that, and gives you partial writes for free.

## Schema

```
tasks               queue and lifecycle: pending, approval, running, done, failed, blocked
task_events         persistent event log, keyed by the same `seq` the live stream uses
task_rounds         round and phase records with plan summaries
task_assignments    who was assigned what, the verdict, the duration
task_conversation   read-only operator chat about a finished task
checkpoints         pre-task snapshots
checkpoint_files    file contents; NULL means "known to exist, not safely storable"
schedules           recurring task definitions
engine_state        config and counters
cli_health          versioned CLI readiness cache
```

## Versioned migrations

Migrations are forward-only, idempotent, transactional and tracked with SQLite's
`user_version` pragma. Each step runs exactly once.

**No migration deletes data.** When the task status vocabulary changed from Kanban words to
engine words, old values were mapped rather than dropped:

```sql
UPDATE tasks SET status = 'pending' WHERE status = 'backlog';
UPDATE tasks SET status = 'running' WHERE status IN ('in_progress', 'review');
UPDATE tasks SET prompt = title  WHERE prompt = '';
```

An existing database keeps its history across an upgrade instead of starting empty.

## The sequence contract

This is the detail everything visual depends on.

The persistent event log and the live stream share **one** `seq` counter. On startup the
renderer subscribes to the live stream first, then replays history, and deduplicates by
`seq`. Nothing arriving during the replay is lost, and nothing is processed twice.

Reverse that order and you drop every event that arrives mid-replay. It looks fine in
testing and loses data under load.

`lastEventSeq()` lets numbering continue from history after a restart, so sequence numbers
stay globally unique for the life of the database.

## Safety rules the repository enforces

- A running task cannot be deleted.
- Only pending tasks can be edited. Changing a task's goal invalidates its stored plan hash
  and clears its round and assignment records, because they describe different work now.
- Operator chat tasks never enter the execution queue.
- Snapshot rows with `NULL` content are files that exist but could not be safely stored
  (binary, sensitive, oversized). Restore skips them instead of writing garbage.
- The daily call counter resets by date, so a budget cannot leak across days.

## Files

```
packages/core/src/db/
  schema.ts              table definitions and indexes
  connection.ts          versioned forward-only migrations
  engine-repo.ts         queue, rounds, assignments, events, conversation, counters
  config-repo.ts         config with template seeding and corruption recovery
  schedule-repo.ts       schedule CRUD
  checkpoint-store.ts    snapshot persistence plus filesystem access
```

## Verify

```bash
pnpm test --filter db
```

54 tests covering ownership queries, event deduplication, migration behavior, corrupted
config recovery and end-to-end snapshot restore against a real temporary directory.

## License

MIT. See [`LICENSE`](LICENSE).
