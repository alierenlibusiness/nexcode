import { createInterface } from "node:readline";
import { createContext } from "../context";
import { McpServer, createLineHandler, type McpServerHost, type McpTaskView } from "@nexcode/core";
import type { Task } from "@nexcode/core";

/**
 * NEXCODE'u MCP sunucusu olarak açar (stdio taşıması).
 *
 * Başka bir kodlama agent'ı (Claude Code, Codex, Gemini, OpenCode) kendi akışının içinden
 * NEXCODE'a görev kuyruklayabilir, durum sorabilir ve onayları çözebilir.
 *
 * Kritik: standart çıktı **yalnızca** protokol içindir. Hiçbir log stdout'a yazılmaz; aksi
 * halde istemcinin JSON ayrıştırması bozulur.
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
      // Motor çalışıyorsa bekleme aralığını kes; duruyorsa görev kuyrukta bekler.
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
      // Bu araç yalnızca `mcpServer.allowEngineControl` açıkken çağrılabilir; kapısı
      // protokol katmanındadır ve katalogdan da gizlenir.
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
    // Satırlar sırayla işlenir: istemci ardışık istek gönderdiğinde yanıt sırası korunur.
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
