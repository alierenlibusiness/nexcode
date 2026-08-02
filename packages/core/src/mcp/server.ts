import type { JsonObject, JsonValue } from "../json";
import type { NexcodeConfig, ExecutionMode } from "../config/schema";
import { EXECUTION_MODES } from "../config/schema";

/**
 * The outbound MCP server.
 *
 * Exposes NEXCODE to another coding agent (Claude Code, Codex, Gemini, OpenCode) as a tool:
 * that agent can queue a task into NEXCODE from inside its own flow, query status and list
 * what is awaiting approval.
 *
 * This module is a pure protocol layer: the transport (stdio) and the application operations
 * arrive through the `McpServerHost` port, so the whole contract is testable without
 * spawning a process.
 *
 * Safety invariant: the engine start/stop tool only appears in the catalog and can only be
 * called while `mcpServer.allowEngineControl` is on. An external client cannot trigger
 * autonomous execution unless the user explicitly grants permission.
 */

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_NAME = "nexcode";

export interface McpTaskView {
  id: string;
  title: string;
  status: string;
  executionMode: string;
  createdAt: string;
  delivery?: string;
  remainingRisk?: string;
}

export interface McpApprovalView {
  id: string;
  taskId: string;
  actionType: string;
  createdAt: string;
}

/** The single point where the server connects to the running application. */
export interface McpServerHost {
  config: () => NexcodeConfig;
  createTask: (input: { prompt: string; workingDir?: string; executionMode?: ExecutionMode }) => Promise<McpTaskView>;
  getTask: (taskId: string) => Promise<McpTaskView | null>;
  listTasks: () => Promise<McpTaskView[]>;
  listApprovals: () => Promise<McpApprovalView[]>;
  resolveApproval: (approvalId: string, approved: boolean) => Promise<boolean>;
  /** Called only while `allowEngineControl` is on. */
  setEngineRunning: (running: boolean) => Promise<boolean>;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: JsonValue;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: JsonValue;
  error?: { code: number; message: string };
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

const ERROR = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

const ENGINE_CONTROL_TOOL = "nexcode_engine_control";

/** The tool catalog. Engine control is absent from the list while `allowEngineControl` is off. */
export function toolCatalog(cfg: NexcodeConfig): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [
    {
      name: "nexcode_create_task",
      description:
        "Adds a new task to the NEXCODE queue. The task is executed by the operator-led team of specialist agents.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The goal of the task. State clearly what needs to be done." },
          workingDir: { type: "string", description: "Working directory. The configured default is used when omitted." },
          executionMode: {
            type: "string",
            enum: [...EXECUTION_MODES],
            description: "Execution depth. auto is the default.",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "nexcode_task_status",
      description: "Returns the current status, delivery summary and remaining risk of a task.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string", description: "Task id." } },
        required: ["taskId"],
      },
    },
    {
      name: "nexcode_list_tasks",
      description: "Lists queued and completed tasks.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "nexcode_list_approvals",
      description: "Lists risky plans awaiting human approval.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "nexcode_resolve_approval",
      description: "Accepts or rejects a pending approval.",
      inputSchema: {
        type: "object",
        properties: {
          approvalId: { type: "string", description: "Id of the approval record." },
          approved: { type: "boolean", description: "true accepts, false rejects." },
        },
        required: ["approvalId", "approved"],
      },
    },
  ];

  if (cfg.mcpServer.allowEngineControl) {
    tools.push({
      name: ENGINE_CONTROL_TOOL,
      description: "Starts or stops the NEXCODE engine. Stopping does not interrupt an in-flight task.",
      inputSchema: {
        type: "object",
        properties: { running: { type: "boolean", description: "true starts, false stops." } },
        required: ["running"],
      },
    });
  }

  return tools;
}

export class McpServer {
  constructor(private readonly host: McpServerHost) {}

  /**
   * Serves a single JSON-RPC request.
   *
   * Returns `null` for notifications (no `id`) and writes no response; the JSON-RPC contract
   * forbids responding to notifications.
   */
  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;
    const method = request.method ?? "";
    const isNotification = request.id === undefined || request.id === null;

    if (method === "") {
      return isNotification ? null : this.error(id, ERROR.invalidRequest, "the method field is required");
    }
    // `notifications/*` is informational only; no response is produced.
    if (method.startsWith("notifications/")) return null;

    try {
      switch (method) {
        case "initialize":
          return this.ok(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: MCP_SERVER_NAME, version: "1.0.0" },
          });

        case "ping":
          return this.ok(id, {});

        case "tools/list":
          return this.ok(id, { tools: toolCatalog(this.host.config()) as unknown as JsonValue });

        case "tools/call":
          return await this.callTool(id, request.params);

        default:
          return isNotification ? null : this.error(id, ERROR.methodNotFound, `Unknown method: ${method}`);
      }
    } catch (error) {
      return this.error(id, ERROR.internal, String(error));
    }
  }

  private async callTool(id: number | string | null, params: JsonValue | undefined): Promise<JsonRpcResponse> {
    if (!isObject(params)) return this.error(id, ERROR.invalidParams, "params must be an object");

    const name = params.name;
    if (typeof name !== "string") return this.error(id, ERROR.invalidParams, "the tool name is required");

    const args = isObject(params.arguments) ? params.arguments : {};
    const cfg = this.host.config();

    // Disabled engine control is absent from the catalog; a direct call is rejected too.
    if (name === ENGINE_CONTROL_TOOL && !cfg.mcpServer.allowEngineControl) {
      return this.error(id, ERROR.methodNotFound, "Engine control is disabled in this installation.");
    }

    switch (name) {
      case "nexcode_create_task": {
        const prompt = args.prompt;
        if (typeof prompt !== "string" || prompt.trim() === "") {
          return this.error(id, ERROR.invalidParams, "prompt cannot be empty");
        }
        const mode = args.executionMode;
        if (mode !== undefined && !isExecutionMode(mode)) {
          return this.error(id, ERROR.invalidParams, `executionMode is invalid: ${String(mode)}`);
        }

        const task = await this.host.createTask({
          prompt: prompt.trim(),
          ...(typeof args.workingDir === "string" ? { workingDir: args.workingDir } : {}),
          ...(mode !== undefined ? { executionMode: mode } : {}),
        });
        return this.text(id, `Task queued.\nid: ${task.id}\ntitle: ${task.title}\nstatus: ${task.status}`);
      }

      case "nexcode_task_status": {
        const taskId = args.taskId;
        if (typeof taskId !== "string") return this.error(id, ERROR.invalidParams, "taskId is required");

        const task = await this.host.getTask(taskId);
        if (task === null) return this.text(id, `Task not found: ${taskId}`);
        return this.text(id, describeTask(task));
      }

      case "nexcode_list_tasks": {
        const tasks = await this.host.listTasks();
        if (tasks.length === 0) return this.text(id, "The queue is empty.");
        return this.text(id, tasks.map((t) => `- ${t.id} [${t.status}] ${t.title}`).join("\n"));
      }

      case "nexcode_list_approvals": {
        const approvals = await this.host.listApprovals();
        if (approvals.length === 0) return this.text(id, "No plans are awaiting approval.");
        return this.text(id, approvals.map((a) => `- ${a.id} [${a.actionType}] task: ${a.taskId}`).join("\n"));
      }

      case "nexcode_resolve_approval": {
        const approvalId = args.approvalId;
        const approved = args.approved;
        if (typeof approvalId !== "string") return this.error(id, ERROR.invalidParams, "approvalId is required");
        if (typeof approved !== "boolean") return this.error(id, ERROR.invalidParams, "approved must be a boolean");

        const done = await this.host.resolveApproval(approvalId, approved);
        return this.text(
          id,
          done ? `Approval ${approved ? "accepted" : "rejected"}: ${approvalId}` : `Approval not found: ${approvalId}`,
        );
      }

      case ENGINE_CONTROL_TOOL: {
        const running = args.running;
        if (typeof running !== "boolean") return this.error(id, ERROR.invalidParams, "running must be a boolean");

        const applied = await this.host.setEngineRunning(running);
        return this.text(id, applied ? `Engine ${running ? "started" : "stopped"}.` : "The engine state did not change.");
      }

      default:
        return this.error(id, ERROR.methodNotFound, `Unknown tool: ${name}`);
    }
  }

  private ok(id: number | string | null, result: JsonValue): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }

  /** MCP tool results are returned as a `content` array. */
  private text(id: number | string | null, body: string): JsonRpcResponse {
    return this.ok(id, { content: [{ type: "text", text: body }] });
  }

  private error(id: number | string | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}

/**
 * Line based JSON-RPC transport.
 *
 * Every request is a single line of JSON. A malformed line does not drop the connection: a
 * JSON-RPC error response is written and the stream continues.
 */
export function createLineHandler(
  server: McpServer,
  write: (line: string) => void,
): (line: string) => Promise<void> {
  return async (line: string) => {
    const trimmed = line.trim();
    if (trimmed === "") return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON" } }));
      return;
    }

    const response = await server.handle(request);
    if (response !== null) write(JSON.stringify(response));
  };
}

function describeTask(task: McpTaskView): string {
  const lines = [
    `id: ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `mode: ${task.executionMode}`,
    `created: ${task.createdAt}`,
  ];
  if (task.delivery !== undefined && task.delivery.trim() !== "") lines.push("", "delivery:", task.delivery.trim());
  if (task.remainingRisk !== undefined && task.remainingRisk.trim() !== "") {
    lines.push("", "remaining risk:", task.remainingRisk.trim());
  }
  return lines.join("\n");
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExecutionMode(value: JsonValue): value is ExecutionMode {
  return typeof value === "string" && (EXECUTION_MODES as readonly string[]).includes(value);
}
