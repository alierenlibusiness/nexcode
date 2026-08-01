import type { JsonObject, JsonValue } from "../json";
import type { NexcodeConfig, ExecutionMode } from "../config/schema";
import { EXECUTION_MODES } from "../config/schema";

/**
 * Dışa dönük MCP sunucusu.
 *
 * NEXCODE'u başka bir kodlama agent'ına (Claude Code, Codex, Gemini, OpenCode) araç olarak
 * sunar: o agent kendi akışının içinden NEXCODE'a görev kuyruklayabilir, durum sorabilir ve
 * onay bekleyenleri listeleyebilir.
 *
 * Bu modül saf protokol katmanıdır: taşıma (stdio) ve uygulama işlemleri `McpServerHost`
 * port'undan gelir, böylece tüm sözleşme süreç açmadan test edilebilir.
 *
 * Güvenlik değişmezi: motoru başlatıp durdurma aracı yalnızca `mcpServer.allowEngineControl`
 * açıkken katalogda görünür ve yalnızca o zaman çağrılabilir. Harici bir istemci, kullanıcı
 * açıkça izin vermedikçe otonom yürütmeyi tetikleyemez.
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

/** Sunucunun çalışan uygulamaya bağlandığı tek nokta. */
export interface McpServerHost {
  config: () => NexcodeConfig;
  createTask: (input: { prompt: string; workingDir?: string; executionMode?: ExecutionMode }) => Promise<McpTaskView>;
  getTask: (taskId: string) => Promise<McpTaskView | null>;
  listTasks: () => Promise<McpTaskView[]>;
  listApprovals: () => Promise<McpApprovalView[]>;
  resolveApproval: (approvalId: string, approved: boolean) => Promise<boolean>;
  /** Yalnızca `allowEngineControl` açıkken çağrılır. */
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

/** Araç kataloğu. `allowEngineControl` kapalıyken motor kontrolü listede yer almaz. */
export function toolCatalog(cfg: NexcodeConfig): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [
    {
      name: "nexcode_create_task",
      description:
        "NEXCODE kuyruğuna yeni bir görev ekler. Görev, operatör yönetimindeki uzman agent ekibi tarafından yürütülür.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Görevin hedefi. Ne yapılması gerektiğini açıkça yaz." },
          workingDir: { type: "string", description: "Çalışma klasörü. Verilmezse yapılandırmadaki varsayılan kullanılır." },
          executionMode: {
            type: "string",
            enum: [...EXECUTION_MODES],
            description: "Yürütme derinliği. auto varsayılandır.",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "nexcode_task_status",
      description: "Bir görevin güncel durumunu, teslimat özetini ve kalan riskini döndürür.",
      inputSchema: {
        type: "object",
        properties: { taskId: { type: "string", description: "Görev id'si." } },
        required: ["taskId"],
      },
    },
    {
      name: "nexcode_list_tasks",
      description: "Kuyruktaki ve tamamlanmış görevleri listeler.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "nexcode_list_approvals",
      description: "İnsan onayı bekleyen riskli planları listeler.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "nexcode_resolve_approval",
      description: "Bekleyen bir onayı kabul eder ya da reddeder.",
      inputSchema: {
        type: "object",
        properties: {
          approvalId: { type: "string", description: "Onay kaydının id'si." },
          approved: { type: "boolean", description: "true kabul, false ret." },
        },
        required: ["approvalId", "approved"],
      },
    },
  ];

  if (cfg.mcpServer.allowEngineControl) {
    tools.push({
      name: ENGINE_CONTROL_TOOL,
      description: "NEXCODE motorunu başlatır ya da durdurur. Durdurma uçuştaki görevi yarıda kesmez.",
      inputSchema: {
        type: "object",
        properties: { running: { type: "boolean", description: "true başlatır, false durdurur." } },
        required: ["running"],
      },
    });
  }

  return tools;
}

export class McpServer {
  constructor(private readonly host: McpServerHost) {}

  /**
   * Tek bir JSON-RPC isteğini karşılar.
   *
   * Bildirimler (`id` yok) için `null` döner ve hiçbir yanıt yazılmaz; JSON-RPC sözleşmesi
   * bildirimlere yanıt verilmesini yasaklar.
   */
  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;
    const method = request.method ?? "";
    const isNotification = request.id === undefined || request.id === null;

    if (method === "") {
      return isNotification ? null : this.error(id, ERROR.invalidRequest, "method alanı zorunludur");
    }
    // `notifications/*` yalnızca bilgilendirmedir; yanıt üretilmez.
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
          return isNotification ? null : this.error(id, ERROR.methodNotFound, `Bilinmeyen method: ${method}`);
      }
    } catch (error) {
      return this.error(id, ERROR.internal, String(error));
    }
  }

  private async callTool(id: number | string | null, params: JsonValue | undefined): Promise<JsonRpcResponse> {
    if (!isObject(params)) return this.error(id, ERROR.invalidParams, "params bir nesne olmalıdır");

    const name = params.name;
    if (typeof name !== "string") return this.error(id, ERROR.invalidParams, "tool adı zorunludur");

    const args = isObject(params.arguments) ? params.arguments : {};
    const cfg = this.host.config();

    // Kapalı motor kontrolü katalogda görünmez; doğrudan çağrı da reddedilir.
    if (name === ENGINE_CONTROL_TOOL && !cfg.mcpServer.allowEngineControl) {
      return this.error(id, ERROR.methodNotFound, "Motor kontrolü bu kurulumda kapalı.");
    }

    switch (name) {
      case "nexcode_create_task": {
        const prompt = args.prompt;
        if (typeof prompt !== "string" || prompt.trim() === "") {
          return this.error(id, ERROR.invalidParams, "prompt boş olamaz");
        }
        const mode = args.executionMode;
        if (mode !== undefined && !isExecutionMode(mode)) {
          return this.error(id, ERROR.invalidParams, `executionMode geçersiz: ${String(mode)}`);
        }

        const task = await this.host.createTask({
          prompt: prompt.trim(),
          ...(typeof args.workingDir === "string" ? { workingDir: args.workingDir } : {}),
          ...(mode !== undefined ? { executionMode: mode } : {}),
        });
        return this.text(id, `Görev kuyruğa alındı.\nid: ${task.id}\nbaşlık: ${task.title}\ndurum: ${task.status}`);
      }

      case "nexcode_task_status": {
        const taskId = args.taskId;
        if (typeof taskId !== "string") return this.error(id, ERROR.invalidParams, "taskId zorunludur");

        const task = await this.host.getTask(taskId);
        if (task === null) return this.text(id, `Görev bulunamadı: ${taskId}`);
        return this.text(id, describeTask(task));
      }

      case "nexcode_list_tasks": {
        const tasks = await this.host.listTasks();
        if (tasks.length === 0) return this.text(id, "Kuyruk boş.");
        return this.text(id, tasks.map((t) => `- ${t.id} [${t.status}] ${t.title}`).join("\n"));
      }

      case "nexcode_list_approvals": {
        const approvals = await this.host.listApprovals();
        if (approvals.length === 0) return this.text(id, "Onay bekleyen plan yok.");
        return this.text(id, approvals.map((a) => `- ${a.id} [${a.actionType}] görev: ${a.taskId}`).join("\n"));
      }

      case "nexcode_resolve_approval": {
        const approvalId = args.approvalId;
        const approved = args.approved;
        if (typeof approvalId !== "string") return this.error(id, ERROR.invalidParams, "approvalId zorunludur");
        if (typeof approved !== "boolean") return this.error(id, ERROR.invalidParams, "approved boolean olmalıdır");

        const done = await this.host.resolveApproval(approvalId, approved);
        return this.text(
          id,
          done ? `Onay ${approved ? "kabul edildi" : "reddedildi"}: ${approvalId}` : `Onay bulunamadı: ${approvalId}`,
        );
      }

      case ENGINE_CONTROL_TOOL: {
        const running = args.running;
        if (typeof running !== "boolean") return this.error(id, ERROR.invalidParams, "running boolean olmalıdır");

        const applied = await this.host.setEngineRunning(running);
        return this.text(id, applied ? `Motor ${running ? "başlatıldı" : "durduruldu"}.` : "Motor durumu değişmedi.");
      }

      default:
        return this.error(id, ERROR.methodNotFound, `Bilinmeyen araç: ${name}`);
    }
  }

  private ok(id: number | string | null, result: JsonValue): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }

  /** MCP araç sonuçları `content` dizisi olarak döner. */
  private text(id: number | string | null, body: string): JsonRpcResponse {
    return this.ok(id, { content: [{ type: "text", text: body }] });
  }

  private error(id: number | string | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}

/**
 * Satır tabanlı JSON-RPC taşıması.
 *
 * Her istek tek satırlık JSON'dur. Bozuk satır bağlantıyı düşürmez: JSON-RPC hata yanıtı
 * yazılır ve akış devam eder.
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
      write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Geçersiz JSON" } }));
      return;
    }

    const response = await server.handle(request);
    if (response !== null) write(JSON.stringify(response));
  };
}

function describeTask(task: McpTaskView): string {
  const lines = [
    `id: ${task.id}`,
    `başlık: ${task.title}`,
    `durum: ${task.status}`,
    `mod: ${task.executionMode}`,
    `oluşturulma: ${task.createdAt}`,
  ];
  if (task.delivery !== undefined && task.delivery.trim() !== "") lines.push("", "teslimat:", task.delivery.trim());
  if (task.remainingRisk !== undefined && task.remainingRisk.trim() !== "") {
    lines.push("", "kalan risk:", task.remainingRisk.trim());
  }
  return lines.join("\n");
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExecutionMode(value: JsonValue): value is ExecutionMode {
  return typeof value === "string" && (EXECUTION_MODES as readonly string[]).includes(value);
}
