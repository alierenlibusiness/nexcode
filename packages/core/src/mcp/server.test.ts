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
 * Dışa dönük MCP sunucusu, çalışan uygulamanın ince bir kabuğudur. Sınanan sözleşme:
 * araç kataloğu, parametre doğrulaması ve motor kontrolünün kapalı olması.
 */

function config(allowEngineControl = false): NexcodeConfig {
  return normalizeConfig({ ...FALLBACK_CONFIG, mcpServer: { allowEngineControl } });
}

function task(over: Partial<McpTaskView> = {}): McpTaskView {
  return {
    id: "t1",
    title: "Login düzelt",
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
      return Promise.resolve(task({ id: "yeni", title: input.prompt }));
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

/** Araç çağrısı için kısayol; sonucu düz metin olarak döndürür. */
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

describe("MCP el sıkışması", () => {
  it("initialize protokol sürümünü ve araç yeteneğini bildirir", async () => {
    const { server } = harness();
    const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize" });

    expect(response?.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "nexcode" },
    });
  });

  it("bildirimlere yanıt yazmaz", async () => {
    const { server } = harness();
    expect(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("bilinmeyen method için hata döner", async () => {
    const { server } = harness();
    const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "kimsenin/bilmedigi" });
    expect(response?.error?.code).toBe(-32601);
  });

  it("ping boş sonuç döner", async () => {
    const { server } = harness();
    expect((await server.handle({ jsonrpc: "2.0", id: 9, method: "ping" }))?.result).toEqual({});
  });
});

describe("Araç kataloğu", () => {
  it("motor kontrolü varsayılan olarak katalogda yoktur", () => {
    const names = toolCatalog(config(false)).map((t) => t.name);
    expect(names).toContain("nexcode_create_task");
    expect(names).toContain("nexcode_list_approvals");
    expect(names).not.toContain("nexcode_engine_control");
  });

  it("izin verilince motor kontrolü katalogda görünür", () => {
    expect(toolCatalog(config(true)).map((t) => t.name)).toContain("nexcode_engine_control");
  });

  it("tools/list yapılandırmadaki kataloğu yansıtır", async () => {
    const { server } = harness({ allowEngineControl: true });
    const response = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = (response?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toContain("nexcode_engine_control");
  });
});

describe("nexcode_create_task", () => {
  it("görevi kuyruğa alır ve id döner", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_create_task", { prompt: "Testleri düzelt" });

    expect(h.created).toEqual([{ prompt: "Testleri düzelt" }]);
    expect(result.text).toContain("Görev kuyruğa alındı");
    expect(result.text).toContain("id: yeni");
  });

  it("çalışma klasörü ve modu geçirir", async () => {
    const h = harness();
    await callTool(h.server, "nexcode_create_task", {
      prompt: "  Boşluklu  ",
      workingDir: "C:/proje",
      executionMode: "deep",
    });

    expect(h.created[0]).toEqual({ prompt: "Boşluklu", workingDir: "C:/proje", executionMode: "deep" });
  });

  it("boş prompt reddedilir", async () => {
    const h = harness();
    expect((await callTool(h.server, "nexcode_create_task", { prompt: "   " })).error?.code).toBe(-32602);
    expect(h.created).toHaveLength(0);
  });

  it("geçersiz yürütme modu reddedilir", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_create_task", { prompt: "x", executionMode: "turbo" });
    expect(result.error?.code).toBe(-32602);
    expect(result.error?.message).toContain("turbo");
  });
});

describe("sorgulama araçları", () => {
  it("görev durumunu teslimat ve kalan riskle döner", async () => {
    const h = harness({
      tasks: [task({ id: "t1", status: "done", delivery: "endpoint eklendi", remainingRisk: "yük testi yok" })],
    });
    const result = await callTool(h.server, "nexcode_task_status", { taskId: "t1" });

    expect(result.text).toContain("durum: done");
    expect(result.text).toContain("endpoint eklendi");
    expect(result.text).toContain("yük testi yok");
  });

  it("olmayan görevde hata değil açıklama döner", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_task_status", { taskId: "yok" });
    expect(result.error).toBeUndefined();
    expect(result.text).toContain("bulunamadı");
  });

  it("taskId eksikse reddedilir", async () => {
    const h = harness();
    expect((await callTool(h.server, "nexcode_task_status")).error?.code).toBe(-32602);
  });

  it("boş kuyruğu ve dolu kuyruğu ayrı bildirir", async () => {
    expect((await callTool(harness().server, "nexcode_list_tasks")).text).toBe("Kuyruk boş.");

    const h = harness({ tasks: [task({ id: "a", status: "running", title: "İş" })] });
    expect((await callTool(h.server, "nexcode_list_tasks")).text).toBe("- a [running] İş");
  });

  it("onay bekleyenleri listeler", async () => {
    const h = harness({
      approvals: [{ id: "ap1", taskId: "t1", actionType: "risky_plan", createdAt: "2026-08-01T00:00:00.000Z" }],
    });
    expect((await callTool(h.server, "nexcode_list_approvals")).text).toContain("ap1 [risky_plan]");
    expect((await callTool(harness().server, "nexcode_list_approvals")).text).toContain("Onay bekleyen plan yok");
  });
});

describe("nexcode_resolve_approval", () => {
  it("onayı kabul eder", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_resolve_approval", { approvalId: "ap1", approved: true });

    expect(h.resolved).toEqual([{ id: "ap1", approved: true }]);
    expect(result.text).toContain("kabul edildi");
  });

  it("bulunamayan onayı bildirir", async () => {
    const h = harness({ approvalExists: false });
    const result = await callTool(h.server, "nexcode_resolve_approval", { approvalId: "yok", approved: false });
    expect(result.text).toContain("bulunamadı");
  });

  it("approved boolean değilse reddedilir", async () => {
    const h = harness();
    const result = await callTool(h.server, "nexcode_resolve_approval", { approvalId: "ap1", approved: "evet" });
    expect(result.error?.code).toBe(-32602);
  });
});

describe("Motor kontrolü kapısı", () => {
  it("kapalıyken doğrudan çağrı da reddedilir", async () => {
    const h = harness({ allowEngineControl: false });
    const result = await callTool(h.server, "nexcode_engine_control", { running: true });

    expect(result.error?.code).toBe(-32601);
    expect(result.error?.message).toContain("kapalı");
    expect(h.engineCalls).toHaveLength(0);
  });

  it("açıkken motoru başlatır ve durdurur", async () => {
    const h = harness({ allowEngineControl: true });
    expect((await callTool(h.server, "nexcode_engine_control", { running: true })).text).toContain("başlatıldı");
    expect((await callTool(h.server, "nexcode_engine_control", { running: false })).text).toContain("durduruldu");
    expect(h.engineCalls).toEqual([true, false]);
  });

  it("açıkken bile geçersiz parametre reddedilir", async () => {
    const h = harness({ allowEngineControl: true });
    expect((await callTool(h.server, "nexcode_engine_control", {})).error?.code).toBe(-32602);
    expect(h.engineCalls).toHaveLength(0);
  });
});

describe("Satır taşıması", () => {
  it("bozuk JSON bağlantıyı düşürmez, parse hatası yazar", async () => {
    const written: string[] = [];
    const handle = createLineHandler(harness().server, (line) => written.push(line));

    await handle("{ bozuk");
    expect(JSON.parse(written[0] ?? "{}")).toMatchObject({ error: { code: -32700 } });

    // Akış devam eder.
    await handle(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }));
    expect(JSON.parse(written[1] ?? "{}")).toMatchObject({ id: 2, result: {} });
  });

  it("boş satırı yok sayar ve bildirime yanıt yazmaz", async () => {
    const written: string[] = [];
    const handle = createLineHandler(harness().server, (line) => written.push(line));

    await handle("   ");
    await handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(written).toHaveLength(0);
  });

  it("bilinmeyen araç adını hata olarak döner", async () => {
    const result = await callTool(harness().server, "nexcode_format_hard_drive");
    expect(result.error?.code).toBe(-32601);
  });
});
