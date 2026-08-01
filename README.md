<div align="center">

# MCP Server

**Delegate to your whole team from inside another agent's session.**

</div>

---

## What this branch adds

NEXCODE orchestrates coding CLIs. This branch makes NEXCODE itself a tool that other coding
agents can call.

You are deep in a Claude Code session. You hit something large and parallel: rewrite the test
suite, audit every endpoint, migrate a hundred call sites. Instead of dropping out to another
window, you hand it to NEXCODE and keep going.

```
You <-> Claude Code
              |
              +-- nexcode_create_task("migrate all v1 endpoints to v2")
              +-- nexcode_task_status(id)
              |
              v
        NEXCODE operator -> planner, executor, reviewer -> verification -> branch
```

## Tools

| Tool | Purpose |
|---|---|
| `nexcode_create_task` | Queue a goal with an optional working directory and execution mode |
| `nexcode_task_status` | Status, delivery summary and remaining risk for one task |
| `nexcode_list_tasks` | Everything queued and finished |
| `nexcode_list_approvals` | Risky plans waiting on a human |
| `nexcode_resolve_approval` | Approve or reject one |
| `nexcode_engine_control` | Start or stop the engine (**off by default**) |

## The engine control gate

Starting an autonomous engine is not something an external client should be able to do
because a prompt said so.

```jsonc
{ "mcpServer": { "allowEngineControl": false } }
```

While this is false, the tool is not in the catalog **and** a direct call to it is rejected
with a method-not-found error. Hiding a capability from a listing is not access control; both
halves are enforced.

Everything else is safe by construction. Creating a task adds it to a queue. If the engine is
stopped, it stays queued until you start it.

## Wiring it up

```jsonc
{
  "mcpServers": {
    "nexcode": {
      "command": "node",
      "args": ["path/to/nexcode/mcp-server.js"]
    }
  }
}
```

Works with any MCP client: Claude Code, Codex, Gemini, OpenCode.

## Design

The server is a pure protocol layer. Transport and application behavior arrive through a
`McpServerHost` port:

```ts
interface McpServerHost {
  config: () => NexcodeConfig;
  createTask: (input) => Promise<McpTaskView>;
  getTask: (taskId) => Promise<McpTaskView | null>;
  listTasks: () => Promise<McpTaskView[]>;
  listApprovals: () => Promise<McpApprovalView[]>;
  resolveApproval: (id, approved) => Promise<boolean>;
  setEngineRunning: (running) => Promise<boolean>;
}
```

The entire JSON-RPC contract is tested without spawning a process: handshake, tool catalog,
parameter validation, the engine control gate, and malformed input.

## Robustness

Bad input does not drop the connection. A malformed line gets a JSON-RPC parse error and the
stream continues. Notifications get no response, as the spec requires. Unknown methods and
unknown tools return proper error codes rather than crashing.

A missing task returns a readable explanation instead of an error, because "not found" is an
answer, not a failure.

## Files

```
packages/core/src/mcp/server.ts        protocol layer and tool catalog
packages/core/src/mcp/server.test.ts   25 tests over the full contract
packages/core/src/mcp/node.ts          native subpath (inbound client and manager)
```

## Verify

```bash
pnpm test --filter mcp
```

## License

MIT. See [`LICENSE`](LICENSE).
