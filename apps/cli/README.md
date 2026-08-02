# nexcode

**Run every coding CLI you already have as one operator-led AI engineering team.**

Claude Code, Codex CLI, Gemini CLI, OpenCode and Antigravity, coordinated by a single
operator agent that plans, delegates, reviews and ships. On your machine, using the
subscriptions you already pay for.

## Install

```bash
npm install -g nexcode
```

Or run it without installing:

```bash
npx nexcode doctor
```

`doctor` scans your machine for installed coding CLIs, checks whether they are ready, and
tells you exactly what is missing. Start there.

## Use it

```bash
# Queue a goal
nexcode task "add avatar upload and write its tests" --mode balanced

# Run the engine until the queue drains
nexcode run --once

# See what is happening
nexcode status
```

The operator writes a plan, delegates to specialist agents running as separate CLI
processes, has a reviewer check the result, runs your real test commands as a delivery gate,
and commits the work to its own git branch.

## Commands

| Command | What it does |
|---|---|
| `nexcode task <goal>` | Queue a task |
| `nexcode run` | Start the engine and process the queue (`--once` to exit when drained) |
| `nexcode status` | Queue and engine state |
| `nexcode approvals` | List and resolve risky plans awaiting a human |
| `nexcode doctor` | Check installed CLIs, config and readiness |
| `nexcode mcp` | Expose NEXCODE as an MCP server over stdio |

### Options

```
--mode <auto|fast|balanced|deep>   Execution depth (default: auto)
--dir <path>                       Working directory (default: current directory)
--once                             run: exit when the queue drains
--approve <id> | --reject <id>     approvals: apply a decision
--json                             Machine-readable output
```

### Environment

```
NEXCODE_HOME   Data root (default: ~/.nexcode)
```

## Turning on the good parts

Both are off by default, so behavior is identical to a plain run until you opt in. Edit the
config stored under `NEXCODE_HOME`:

```jsonc
{
  // Run your real commands as a hard delivery gate.
  "verify": {
    "commands": ["pnpm typecheck", "pnpm test"],
    "blockOnFailure": true
  },

  // Give every task its own git worktree and branch, so your working tree is never touched.
  "worktree": {
    "mode": "task",
    "branchPrefix": "nexcode/",
    "linkPaths": ["node_modules"]
  },

  // Only allowed once isolation is on.
  "maxConcurrentTasks": 3
}
```

## Use it from another agent

`nexcode mcp` speaks MCP over stdio, so Claude Code or any other MCP client can queue work
into NEXCODE and check on it from inside its own session:

```jsonc
{
  "mcpServers": {
    "nexcode": {
      "command": "npx",
      "args": ["-y", "nexcode", "mcp"]
    }
  }
}
```

Engine start and stop is gated behind an explicit setting and stays hidden until you enable
it, so an external client cannot trigger autonomous execution on its own.

## Requirements

Node.js 22 or newer, and at least one supported coding CLI installed and signed in.

The only native dependency is `better-sqlite3`, which ships prebuilt binaries for common
platforms. On an uncommon platform npm falls back to compiling it, which needs a C++
toolchain.

## Desktop app

This package is the command line interface. The full desktop application, with the Command
Center, Kanban board, live code diffs and the orchestration scene, lives in the
[main repository](https://github.com/alierenlibusiness/nexcode).

## License

MIT.
