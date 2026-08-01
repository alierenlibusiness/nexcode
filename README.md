<div align="center">

# NEXCODE

**Run every coding CLI you already have as one AI engineering team.**

Claude Code, Codex CLI, Gemini CLI, OpenCode and Antigravity, coordinated by a single
operator that plans, delegates, reviews and ships. On your machine, with your own
subscriptions, in a desktop app you can actually watch.

</div>

---

## What it is

You probably have two or three AI coding CLIs installed. Each one is good. None of them
talk to each other, none of them review each other's work, and none of them can run while
you do something else.

NEXCODE turns them into a team.

You write a goal. An **operator** agent reads it, writes a plan, and hands the work to
specialist agents running as separate CLI processes. A reviewer checks the result. Your
own test and lint commands run as a hard gate. Only then does the work ship, on its own
git branch, without ever touching your working tree.

Everything is visible while it happens: which agent is working, what it is writing, line
by line, and why the operator decided what it decided.

## How it works

```
Goal
 |
 +--> Operator plans and delegates
 |         |
 |         +--> planner    (writes the approach)
 |         +--> executor   (writes the code)
 |         +--> reviewer   (finds the problems)
 |
 +--> Verification gate    (your real test / typecheck / lint commands)
 |
 +--> Delivery on an isolated git branch
```

The operator never writes code. Specialists never decide when the task is done. The
verification gate outranks both: a model saying "tests pass" is not evidence, a green
command is.

## What makes it different

**Real evidence, not model claims.** After every round, NEXCODE runs the commands you
define. A red gate closes every delivery shortcut and sends the decision back to the
operator. If the operator insists anyway, the first attempt is rejected outright. Work is
never silently shipped on a broken build, and never thrown away either.

**Your working tree stays clean.** Each task runs in its own git worktree on its own
branch. Nothing is pushed anywhere. If a task fails, its tree is kept so you can inspect it.

**Parallel by default, safely.** Multiple tasks can run at once, each in its own isolated
slot. Concurrency requires isolation: NEXCODE refuses to run tasks in parallel without it,
because that corrupts working trees.

**One click back.** Every task snapshots the working directory before it starts. "Return to
this version" restores changed and deleted files, removes what was added, and takes a redo
snapshot first, so undo is itself undoable.

**Nothing sensitive leaks into the UI.** `.env` files, credentials and private keys are
never rendered into the live diff or stored in snapshots.

**Bring your own everything.** CLI agents use the subscriptions you already pay for. API
providers are available as a second execution path, with keys in your OS keychain and
per-call cost tracking.

## The four surfaces

| Surface | What it shows |
|---|---|
| **Command Center** | Write a goal, watch the queue, the live event stream, approvals and engine controls |
| **Board** | Task lifecycle across Pending, Running, Completed and Failed |
| **Live Code** | Git-style file and hunk diffs, streaming as agents write |
| **Team Flow** | The orchestration scene: operator core, agent nodes, data packets and a full timeline |

## Getting started

Requires Node.js 22+, pnpm, and at least one supported coding CLI already installed and
signed in.

```bash
git clone https://github.com/alierenlibusiness/nexcode.git
cd nexcode
pnpm install
pnpm dev
```

NEXCODE discovers the CLIs on your machine, checks whether they are ready, and builds the
agent catalog for you. Open the Command Center, start the engine, and give it a goal.

### Turning on the good parts

Both are off by default so behavior is identical to a plain run until you opt in.

```jsonc
{
  // Run your real commands as a delivery gate.
  "verify": {
    "commands": ["pnpm typecheck", "pnpm test"],
    "blockOnFailure": true
  },

  // Give every task its own git worktree and branch.
  "worktree": {
    "mode": "task",
    "branchPrefix": "nexcode/",
    "linkPaths": ["node_modules"]
  },

  // Only allowed once isolation is on.
  "maxConcurrentTasks": 3
}
```

## Scheduled work

Recurring tasks use plain presets rather than cron syntax: every N minutes, daily at a
time, or weekly on chosen days. A scheduled task is queued when it comes due. It never
starts a stopped engine on its own.

## Use NEXCODE from another agent

NEXCODE also exposes itself over MCP, so Claude Code or any other MCP client can queue work
into it, check status and resolve approvals from inside its own flow. Engine start and stop
is gated behind an explicit setting and stays hidden until you enable it.

## Verify a build

```bash
pnpm -r build
pnpm typecheck
pnpm lint
pnpm test
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) walks through the module boundaries and
  the invariants the system guarantees.
- Each feature branch carries a README focused on that subsystem.

## License

MIT. See [`LICENSE`](LICENSE).
