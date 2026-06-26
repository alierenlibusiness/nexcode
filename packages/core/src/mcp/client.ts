import { spawn, type ChildProcess } from "node:child_process";
import { logger } from "../logger";

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
  inputSchema?: any;
}

export class McpClient {
  private proc: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
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
      let newlineIndex;
      while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line) {
          try {
            const msg = JSON.parse(line);
            this.handleMessage(msg);
          } catch (e) {
            logger.warn("mcp.client.parse_error", { name: this.config.name, raw: line.slice(0, 100) });
          }
        }
      }
    });

    // Run handshake
    await this.initialize();
  }

  private handleMessage(msg: any): void {
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(msg.error);
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  private send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.proc.killed) {
        return reject(new Error(`MCP server '${this.config.name}' is not running`));
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
      return res.tools || [];
    } catch (e) {
      logger.error("mcp.client.list_tools_failed", { name: this.config.name, error: String(e) });
      return [];
    }
  }

  async callTool(name: string, args: any): Promise<any> {
    try {
      const res = await this.send("tools/call", { name, arguments: args });
      return res.content || [];
    } catch (e) {
      logger.error("mcp.client.call_tool_failed", { name: this.config.name, tool: name, error: String(e) });
      throw e;
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
    for (const [id, pending] of this.pendingRequests.entries()) {
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }
}
