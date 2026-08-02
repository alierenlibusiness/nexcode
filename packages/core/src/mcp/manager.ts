import { McpClient, type McpTool, type McpServerConfig, type JsonObject, type JsonValue } from "./client";
import type { McpRepository } from "../db/mcp-repo";
import { logger } from "../logger";

export interface McpToolWithServer extends McpTool {
  serverName: string;
}

export class McpManager {
  private clients = new Map<string, McpClient>();

  constructor(private readonly repo: McpRepository) {}

  /** Starts every enabled MCP server that has been integrated. */
  async startAll(): Promise<void> {
    const servers = this.repo.list();
    for (const server of servers) {
      if (server.enabled) {
        await this.startServer(server);
      }
    }
  }

  /** Starts a specific MCP server. */
  async startServer(config: McpServerConfig): Promise<void> {
    if (this.clients.has(config.id)) {
      await this.stopServer(config.id);
    }
    const client = new McpClient(config);
    this.clients.set(config.id, client);
    try {
      await client.start();
    } catch (e) {
      logger.error("mcp.manager.start_failed", { name: config.name, error: String(e) });
      this.clients.delete(config.id);
    }
  }

  /** Stops a specific MCP server. */
  async stopServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      client.stop();
      this.clients.delete(id);
    }
  }

  /** Stops every running MCP server. */
  async stopAll(): Promise<void> {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
  }

  /** Lists the running servers and their state. */
  listActiveServers(): Array<{ id: string; name: string; running: boolean; tools: McpTool[] }> {
    // The tool list is left empty here because listTools is async; the renderer gets the
    // combined list asynchronously through `listAllTools()`.
    return this.repo.list().map((s) => {
      const client = this.clients.get(s.id);
      return {
        id: s.id,
        name: s.name,
        running: client !== undefined,
        tools: [], // listTools calls are async, handled by listAllTools
      };
    });
  }

  /** Returns the tools of every running server in one combined list. */
  async listAllTools(): Promise<McpToolWithServer[]> {
    const result: McpToolWithServer[] = [];
    for (const client of this.clients.values()) {
      try {
        const tools = await client.listTools();
        for (const t of tools) {
          result.push({
            ...t,
            serverName: client.config.name,
          });
        }
      } catch (error) {
        logger.error("mcp.manager.list_tools_failed", { name: client.config.name, error: String(error) });
      }
    }
    return result;
  }

  /** Invokes a specific tool by server name. */
  async callTool(serverName: string, toolName: string, args: JsonObject): Promise<JsonValue> {
    const client = Array.from(this.clients.values()).find((c) => c.config.name === serverName);
    if (!client) {
      throw new Error(`The MCP server '${serverName}' is not running`);
    }
    return await client.callTool(toolName, args);
  }
}
