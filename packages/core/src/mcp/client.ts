import { spawn, type ChildProcess } from "node:child_process";
import { logger } from "../logger";
import type { JsonObject, JsonValue } from "../json";

// JSON tipleri saf `../json` modülündedir; bu dosya native olduğundan renderer'a sızmamalıdır.
export type { JsonValue, JsonObject } from "../json";

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
}

/** JSON-RPC 2.0 yanıtı (MCP sunucusundan gelen). */
interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: JsonValue;
  error?: JsonValue;
}

interface PendingRequest {
  resolve: (value: JsonValue) => void;
  reject: (error: unknown) => void;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class McpClient {
  private proc: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = "";

  constructor(public readonly config: McpServerConfig) {}

  async start(): Promise<void> {
    logger.info("mcp.client.starting", { name: this.config.name, command: this.config.command });

    this.proc = spawn(this.config.command, this.config.args, {
      env: { ...process.env, ...this.config.env },
      stdio: ["pipe", "pipe", "inherit"],
    });

    this.proc.on("error", (err) => {
      logger.error("mcp.client.error", { name: this.config.name, error: String(err) });
    });

    this.proc.on("exit", (code) => {
      logger.info("mcp.client.exit", { name: this.config.name, code: code ?? 0 });
      this.proc = null;
      this.rejectAllPending("Process exited");
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line) {
          try {
            this.handleMessage(JSON.parse(line) as JsonRpcResponse);
          } catch {
            logger.warn("mcp.client.parse_error", { name: this.config.name, raw: line.slice(0, 100) });
          }
        }
      }
    });

    // Run handshake
    await this.initialize();
  }

  private handleMessage(msg: JsonRpcResponse): void {
    if (typeof msg.id !== "number") return;
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;
    this.pendingRequests.delete(msg.id);
    if (msg.error !== undefined && msg.error !== null) {
      pending.reject(msg.error);
    } else {
      pending.resolve(msg.result ?? null);
    }
  }

  private send(method: string, params: JsonObject = {}): Promise<JsonValue> {
    return new Promise<JsonValue>((resolve, reject) => {
      if (!this.proc || this.proc.killed) {
        reject(new Error(`MCP server '${this.config.name}' is not running`));
        return;
      }
      const id = ++this.messageId;
      this.pendingRequests.set(id, { resolve, reject });
      const payload = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
      this.proc.stdin?.write(JSON.stringify(payload) + "\n");
    });
  }

  private async initialize(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nexcode-client", version: "1.0.0" },
    });
    // Send initialized notification (no ID, just fire-and-forget)
    const payload = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    };
    this.proc?.stdin?.write(JSON.stringify(payload) + "\n");
    logger.info("mcp.client.initialized", { name: this.config.name });
  }

  async listTools(): Promise<McpTool[]> {
    try {
      const res = await this.send("tools/list");
      if (!isJsonObject(res) || !Array.isArray(res.tools)) return [];
      return res.tools.filter(isJsonObject).map((tool) => {
        const description = tool.description;
        const inputSchema = tool.inputSchema;
        return {
          name: String(tool.name ?? ""),
          ...(typeof description === "string" ? { description } : {}),
          ...(isJsonObject(inputSchema) ? { inputSchema } : {}),
        };
      });
    } catch (error) {
      logger.error("mcp.client.list_tools_failed", { name: this.config.name, error: String(error) });
      return [];
    }
  }

  async callTool(name: string, args: JsonObject): Promise<JsonValue> {
    try {
      const res = await this.send("tools/call", { name, arguments: args });
      if (isJsonObject(res) && res.content !== undefined) return res.content;
      return [];
    } catch (error) {
      logger.error("mcp.client.call_tool_failed", { name: this.config.name, tool: name, error: String(error) });
      throw error;
    }
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.rejectAllPending("Client stopped");
  }

  private rejectAllPending(reason: string): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }
}
