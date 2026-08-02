import { describe, expect, it } from "vitest";
import {
  McpServer,
  createLineHandler,
  toolCatalog,
  MCP_PROTOCOL_VERSION,
  type McpApprovalView,
  type McpServerHost,
  type McpTaskView,
} from "./server";
import { normalizeConfig, type NexcodeConfig } from "../config/schema";
import { FALLBACK_CONFIG } from "../config/defaults";

/**
 * The outbound MCP server is a thin shell over the running application. The contract under
 * test: the tool catalog, parameter validation, and engine control being off.
 */

function config(allowEngineControl = false): NexcodeConfig {
  return normalizeConfig({ ...FALLBACK_CONFIG, mcpServer: { allowEngineControl } });
}

function task(over: Partial<McpTaskView> = {}): McpTaskView {
  return {
    id: "t1",
    title: "Fix login",
    status: "pending",
    executionMode: "auto",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

interface HostOptions {
  allowEngineControl?: boolean;
  tasks?: McpTaskView[];
  approvals?: McpApprovalView[];
  approvalExists?: boolean;
}

function harness(options: HostOptions = {}) {
  const created: Array<{ prompt: string; workingDir?: string; executionMode?: string }> = [];
  const engineCalls: boolean[] = [];
  const resolved: Array<{ id: string; approved: boolean }> = [];

  const host: McpServerHost = {
    config: () => config(options.allowEngineControl ?? false),
    createTask: (input) => {
      created.push(input);
      return Promise.resolve(task({ id: "new", title: input.prompt }));
    },
    getTask: (id) => Promise.resolve(options.tasks?.find((t) => t.id === id) ?? null),
    listTasks: () => Promise.resolve(options.tasks ?? []),
    listApprovals: () => Promise.resolve(options.approvals ?? []),
    resolveApproval: (id, approved) => {
      resolved.push({ id, approved });
      return Promise.resolve(options.approvalExists ?? true);
    },
    setEngineRunning: (running) => {
      engineCalls.push(running);
      return Promise.resolve(true);
    },
  };

  return { server: new McpServer(host), created, engineCalls, resolved };
}

/** Shorthand for a tool call; returns the result as plain text. */
async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; error?: { code: number; message: string } }> {
  const response = await server.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args } as never,
  });

  if (response?.error !== undefined) return { text: "", error: response.error };
  const result = response?.result as { content?: Array<{ text?: string }> } | undefined;
  return { text: result?.content?.[0]?.text ?? "" };
}

describe("MCP handshake", () => {
  it("initialize reports the protocol version and the tool capability", async () => {
    const { server } = harness();
    const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" });

    expect(response?.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "nexcode" },
    });
  });

  it("writes no response to notifications", async () => {
    const { server } = harness();
    expect(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("returns an error for an unknown method", async () => {
    const { server } = harness();
    const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "nobody/knows/this" });
    expect(response?.error?.code).toBe(-32601);
  });

  it("ping returns an empty result", async () => {
    const { server } = harness();
    expect((await server.handle({ jsonrpc: "2.0", id: 9, method: "ping" }))?.result).toEqual({});
  });
});

describe("Tool catalog", () => {
  it("keeps engine control out of the catalog by default", () => {
    const names = toolCatalog(config(false)).map((t) => t.name);
    expect(names).toContain("nexcode_create_task");
    expect(names).toContain("nexcode_list_approvals");
    expect(names).not.toContain("nexcode_engine_control");
  });

  it("shows engine control in the catalog once it is permitted", () => {
    expect(toolCatalog(config(true)).map((t) => t.name)).toContain("nexcode_engine_control");
  });

  it("tools/list reflects the catalog from the configuration", async () => {
    const { server } = harness({ allowEngineControl: true });
    const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (response?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toContain("nexcode_engine_control");
  });
});

describe("nexcode_create_task", () => {
  it("queues the task and returns the id", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_create_task", { prompt: "Fix the tests" });

    expect(h.created).toEqual([{ prompt: "Fix the tests" }]);
    expect(result.text).toContain("Task queued");
    expect(result.text).toContain("id: new");
  });

  it("passes the working directory and the mode through", async () => {
    const h = harness();
    await callTool(h.server, "nexcode_create_task", {
      prompt: "  Padded  ",
      workingDir: "C:/project",
      executionMode: "deep",
    });

    expect(h.created[0]).toEqual({ prompt: "Padded", workingDir: "C:/project", executionMode: "deep" });
  });

  it("rejects an empty prompt", async () => {
    const h = harness();
    expect((await callTool(h.server, "nexcode_create_task", { prompt: "   " })).error?.code).toBe(-32602);
    expect(h.created).toHaveLength(0);
  });

  it("rejects an invalid execution mode", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_create_task", { prompt: "x", executionMode: "turbo" });
    expect(result.error?.code).toBe(-32602);
    expect(result.error?.message).toContain("turbo");
  });
});

describe("query tools", () => {
  it("returns the task status with the delivery and remaining risk", async () => {
    const h = harness({
      tasks: [task({ id: "t1", status: "done", delivery: "endpoint added", remainingRisk: "no load test" })],
    });
    const result = await callTool(h.server, "nexcode_task_status", { taskId: "t1" });

    expect(result.text).toContain("status: done");
    expect(result.text).toContain("endpoint added");
    expect(result.text).toContain("no load test");
  });

  it("returns an explanation rather than an error for a task that does not exist", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_task_status", { taskId: "missing" });
    expect(result.error).toBeUndefined();
    expect(result.text).toContain("not found");
  });

  it("rejects a missing taskId", async () => {
    const h = harness();
    expect((await callTool(h.server, "nexcode_task_status")).error?.code).toBe(-32602);
  });

  it("reports an empty queue and a populated queue differently", async () => {
    expect((await callTool(harness().server, "nexcode_list_tasks")).text).toBe("The queue is empty.");

    const h = harness({ tasks: [task({ id: "a", status: "running", title: "Work" })] });
    expect((await callTool(h.server, "nexcode_list_tasks")).text).toBe("- a [running] Work");
  });

  it("lists what is awaiting approval", async () => {
    const h = harness({
      approvals: [{ id: "ap1", taskId: "t1", actionType: "risky_plan", createdAt: "2026-08-01T00:00:00.000Z" }],
    });
    expect((await callTool(h.server, "nexcode_list_approvals")).text).toContain("ap1 [risky_plan]");
    expect((await callTool(harness().server, "nexcode_list_approvals")).text).toContain("No plans are awaiting approval");
  });
});

describe("nexcode_resolve_approval", () => {
  it("accepts an approval", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_resolve_approval", { approvalId: "ap1", approved: true });

    expect(h.resolved).toEqual([{ id: "ap1", approved: true }]);
    expect(result.text).toContain("accepted");
  });

  it("reports an approval that cannot be found", async () => {
    const h = harness({ approvalExists: false });
    const result = await callTool(h.server, "nexcode_resolve_approval", { approvalId: "missing", approved: false });
    expect(result.text).toContain("not found");
  });

  it("rejects a non-boolean approved value", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_resolve_approval", { approvalId: "ap1", approved: "yes" });
    expect(result.error?.code).toBe(-32602);
  });
});

describe("Engine control gate", () => {
  it("rejects a direct call while it is disabled", async () => {
    const h = harness({ allowEngineControl: false });
    const result = await callTool(h.server, "nexcode_engine_control", { running: true });

    expect(result.error?.code).toBe(-32601);
    expect(result.error?.message).toContain("disabled");
    expect(h.engineCalls).toHaveLength(0);
  });

  it("starts and stops the engine while it is enabled", async () => {
    const h = harness({ allowEngineControl: true });
    expect((await callTool(h.server, "nexcode_engine_control", { running: true })).text).toContain("started");
    expect((await callTool(h.server, "nexcode_engine_control", { running: false })).text).toContain("stopped");
    expect(h.engineCalls).toEqual([true, false]);
  });

  it("rejects an invalid parameter even while it is enabled", async () => {
    const h = harness({ allowEngineControl: true });
    expect((await callTool(h.server, "nexcode_engine_control", {})).error?.code).toBe(-32602);
    expect(h.engineCalls).toHaveLength(0);
  });
});

describe("Line transport", () => {
  it("does not drop the connection on malformed JSON; it writes a parse error", async () => {
    const written: string[] = [];
    const handle = createLineHandler(harness().server, (line) => written.push(line));

    await handle("{ broken");
    expect(JSON.parse(written[0] ?? "{}")).toMatchObject({ error: { code: -32700 } });

    // The stream continues.
    await handle(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }));
    expect(JSON.parse(written[1] ?? "{}")).toMatchObject({ id: 2, result: {} });
  });

  it("ignores a blank line and writes no response to a notification", async () => {
    const written: string[] = [];
    const handle = createLineHandler(harness().server, (line) => written.push(line));

    await handle("   ");
    await handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(written).toHaveLength(0);
  });

  it("returns an error for an unknown tool name", async () => {
    const result = await callTool(harness().server, "nexcode_format_hard_drive");
    expect(result.error?.code).toBe(-32601);
  });
});
