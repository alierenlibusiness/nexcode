<div align="center">

# Scheduled Tasks

**Recurring work without cron syntax, and without an engine that starts itself.**

</div>

---

## What this branch adds

Repeating tasks defined with plain presets instead of a five-field expression nobody
remembers.

```
Every 30 minutes
Daily at 09:00
Weekly on Mon, Wed, Fri at 18:30
```

Useful for the work you keep meaning to automate: a nightly dependency audit, a daily test
run on main, a weekly pass over TODO comments.

## Triggers

```ts
type ScheduleTrigger =
  | { type: "interval"; everyMinutes: number }
  | { type: "daily";    at: "HH:MM" }
  | { type: "weekly";   at: "HH:MM"; days: number[] }
```

Times are picked from dropdowns, not typed. `at` is validated against `HH:MM`, `days` must
contain at least one weekday, and `everyMinutes` must be positive. An invalid schedule is
rejected at the IPC boundary rather than failing silently at 3 AM.

## The rule that matters

**A schedule never starts a stopped engine.**

When a task comes due it is added to the queue and nothing else happens. `wake()` only nudges
an already-running loop so it picks the task up immediately instead of waiting out its poll
interval.

If you stopped the engine, you stopped the engine. A timer cannot override that decision.
This is the difference between a scheduler and something that runs code on your machine while
you are asleep and did not ask for it.

## Pure math, contained side effects

`computeNextRun` and `dueSchedules` are pure functions with no clock access of their own:

```ts
computeNextRun(schedule, from: Date): Date   // always strictly after `from`
dueSchedules(schedules, now: Date): Schedule[]
```

The "strictly after" guarantee is what prevents a schedule from firing repeatedly inside the
same tick. Every side effect (creating the task, saving the record, waking the engine) lives
in the desktop tick, which makes the interesting logic testable without faking time.

## The tick

A timer runs every 30 seconds, with the first pass about 5 seconds after startup:

```ts
const due = dueSchedules(schedules.list(), now);
for (const schedule of due) {
  const task = tasks.create({ prompt, workingDir, executionMode, scheduleId });
  schedules.save({ ...schedule, lastRunAt, lastTaskId: task.id, nextRunAt: computeNextRun(...) });
}
engine.wake();
```

A reentrancy lock stops a slow tick from overlapping the next one. Timers are `unref`'d so a
pending tick never keeps the process alive.

## Persistence

Schedule CRUD writes immediately through its own endpoints rather than going through the
large config save path. Adding a schedule cannot clobber unsaved settings you are editing in
another panel.

Tasks created by a schedule carry `scheduleId`, so the Board can badge them and you can tell
automated work from work you asked for.

## Files

```
packages/core/src/schedule/schedule.ts    pure next-run and due calculation
packages/core/src/db/schedule-repo.ts     CRUD with immediate persistence
apps/desktop/src/scheduler.ts             the tick and its side effects
```

## Verify

```bash
pnpm test --filter schedule
```

## License

MIT. See [`LICENSE`](LICENSE).
