import { McpClient, type McpTool, type McpServerConfig, type JsonObject, type JsonValue } from "./client";
import type { McpRepository } from "../db/mcp-repo";
import { logger } from "../logger";

export interface McpToolWithServer extends McpTool {
  serverName: string;
}

export class McpManager {
  private clients = new Map<string, McpClient>();

  constructor(private readonly repo: McpRepository) {}

  /** Entegre edilmiş tüm aktif MCP sunucularını başlatır. */
  async startAll(): Promise<void> {
    const servers = this.repo.list();
    for (const server of servers) {
      if (server.enabled) {
        await this.startServer(server);
      }
    }
  }

  /** Belirli bir MCP sunucusunu başlatır. */
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

  /** Belirli bir MCP sunucusunu durdurur. */
  async stopServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      client.stop();
      this.clients.delete(id);
    }
  }

  /** Tüm aktif MCP sunucularını durdurur. */
  async stopAll(): Promise<void> {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
  }

  /** Çalışan sunucuları ve durumlarını listeler. */
  listActiveServers(): Array<{ id: string; name: string; running: boolean; tools: McpTool[] }> {
    // listTools asenkron olduğu için araç listesi burada boş bırakılır; renderer
    // birleşik listeyi `listAllTools()` üzerinden asenkron alır.
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

  /** Tüm çalışan sunuculardaki araçları birleştirilmiş listede döner. */
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

  /** Belirli bir aracı sunucu adına göre tetikler. */
  async callTool(serverName: string, toolName: string, args: JsonObject): Promise<JsonValue> {
    const client = Array.from(this.clients.values()).find((c) => c.config.name === serverName);
    if (!client) {
      throw new Error(`MCP sunucusu '${serverName}' aktif değil`);
    }
    return await client.callTool(toolName, args);
  }
}
