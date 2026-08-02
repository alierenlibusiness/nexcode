import { createInterface } from "node:readline";
import { createContext } from "../context";
import { McpServer, createLineHandler, type McpServerHost, type McpTaskView } from "@nexcode/core";
import type { Task } from "@nexcode/core";

/**
 * Exposes NEXCODE as an MCP server (stdio transport).
 *
 * Another coding agent (Claude Code, Codex, Gemini, OpenCode) can queue a task into
 * NEXCODE from inside its own flow, query status and resolve approvals.
 *
 * Critical: stdout is **only** for the protocol. No log is written to stdout, otherwise
 * the client's JSON parsing breaks.
 */
export async function runMcpCommand(): Promise<number> {
  const ctx = createContext();

  const host: McpServerHost = {
    config: () => ctx.configRepo.load(),

    createTask: (input) => {
      const task = ctx.tasks.create({
        prompt: input.prompt,
        workingDir: input.workingDir ?? ctx.workingDir,
        ...(input.executionMode !== undefined ? { executionMode: input.executionMode } : {}),
      });
      // If the engine is running, cut the wait interval short; if stopped, the task waits in the queue.
      ctx.engine.wake();
      return Promise.resolve(toView(task));
    },

    getTask: (taskId) => {
      const task = ctx.tasks.getById(taskId);
      return Promise.resolve(task === null ? null : toView(task));
    },

    listTasks: () => Promise.resolve(ctx.tasks.listAll().map(toView)),

    listApprovals: () =>
      Promise.resolve(
        ctx.approvals.listPending().map((record) => ({
          id: record.id,
          taskId: record.taskId,
          actionType: record.actionType,
          createdAt: record.requestedAt,
        })),
      ),

    resolveApproval: (approvalId, approved) => {
      if (ctx.approvals.getById(approvalId) === null) return Promise.resolve(false);
      ctx.approvals.resolve(approvalId, approved ? "approved" : "rejected", "mcp");
      return Promise.resolve(true);
    },

    setEngineRunning: async (running) => {
      // This tool can only be called while `mcpServer.allowEngineControl` is on; its gate
      // lives in the protocol layer and it is also hidden from the catalogue.
      if (running) {
        ctx.engine.start();
      } else {
        await ctx.engine.stop();
      }
      return true;
    },
  };

  const server = new McpServer(host);
  const write = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  const handle = createLineHandler(server, write);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  await new Promise<void>((resolve) => {
    // Lines are processed in order: when the client sends consecutive requests, response order is preserved.
    let chain: Promise<void> = Promise.resolve();
    rl.on("line", (line) => {
      chain = chain.then(() => handle(line));
    });
    rl.on("close", () => {
      void chain.then(resolve);
    });
  });

  await ctx.engine.stop();
  return 0;
}

function toView(task: Task): McpTaskView {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    executionMode: task.executionMode,
    createdAt: task.createdAt,
    delivery: task.delivery,
    remainingRisk: task.remainingRisk,
  };
}
