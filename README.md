<div align="center">

# Orchestration Engine

**The part of NEXCODE that decides who does what, and when the work is actually done.**

</div>

---

## What this branch is about

An operator agent that plans, delegates to specialists, reads their output, and decides
whether to ship or run another round. No agent grades its own homework.

This is the core of NEXCODE. Everything else on other branches plugs into it.

## The loop

```
round 1  operator plans        ->  planner -> executor -> reviewer
                                        |
                                   verdict: PASS -> ship
                                   verdict: FAIL -> round 2 with targeted fixes
round 2  operator evaluates    ->  ...
...
round N  budget exhausted      ->  ship what exists, with warnings attached
```

The operator is a CLI process and writes no code. Specialists are separate CLI processes.
A round ends when every delegation settles, not when one agent claims success.

## Rules the engine enforces

**Roles bind task types.** An executor gets `implement`, a reviewer gets `review`, a planner
gets `plan`. If the operator produces a mismatched assignment, the engine routes it to the
right role instead of running it wrong. The agent catalog publishes `allowedKinds` so the
operator sees the constraint before it plans.

**Reviews are independent.** The last `VERDICT: PASS | FAIL` line of a review is the verdict.
A PASS on a fully settled round delivers immediately and skips a second operator call, which
is the single biggest cost saving in a normal task.

**Failures are classified, not retried blindly.** Rate limits and network errors are transient
and get an exponential retry on the same agent. Auth failures, quota exhaustion and missing
binaries are permanent: the agent is quarantined for the session and the work fails over to
another healthy agent with the same capability. Going back to the operator for a fresh plan
is the last resort, because it costs a whole round.

**Nothing is thrown away.** When the round budget runs out, the engine delivers whatever
exists with an explicit note about what is incomplete. Hours of agent work never vanish
because a budget hit zero.

**Dependencies are respected.** Assignments declare `dependsOn`. Independent work runs in
parallel batches; anything whose upstream failed is never started and reports why.

## Prompt protocol

The operator answers in strict JSON. Parsing failures get a bounded number of repair attempts
with a targeted correction instruction rather than a generic retry, because a model that
produced invalid JSON once will usually produce it again unless told exactly what broke.

Long task descriptions do not silently truncate. Anything past the budget is written to
`.nexcode/TASK-<id>.md` in the working directory and the prompt carries a head and tail
summary plus a pointer to the full text.

## Testability

The engine is pure. Processes, the filesystem and the database all arrive through an
`EngineDeps` interface, so the entire lifecycle runs against fake agents in milliseconds.

```ts
const engine = new Engine({
  config: () => config,
  events: bus,
  invoke: async (input) => fakeAgentResponse(input),
  loadRole: (file) => readRole(file),
  matchSkills: (goal, kind) => skills.match(goal, kind),
  // ...
});

const outcome = await engine.runTask(task);
```

That is why the role chain, the fast path, protocol repair, recovery, failover, quarantine,
approval gating and partial delivery all have real regression tests rather than mocks of
themselves.

## Files

```
packages/core/src/engine/
  engine.ts       task lifecycle, round loop, delivery decisions
  supervisor.ts   queue loop and concurrent worker slots
  rounds.ts       execution policy per mode (auto, fast, balanced, deep)
  routing.ts      agent catalog, assignment normalization, role chain
  verdict.ts      review parsing and fast-path rules
  recovery.ts     failure classification, retry, failover, quarantine
  protocol.ts     operator JSON contract and repair instructions
  prompt.ts       operator and specialist prompt construction
  events.ts       the event contract every UI surface consumes
  live-diff.ts    line and hunk diffing with safety limits
```

## Verify

```bash
pnpm test --filter engine
pnpm typecheck
```
