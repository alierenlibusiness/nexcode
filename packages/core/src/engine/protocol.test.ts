import { describe, expect, it } from "vitest";
import { extractJsonObject, isDelegateDecision, parseOperatorDecision } from "./protocol";

describe("extractJsonObject", () => {
  it("düz JSON nesnesini olduğu gibi alır", () => {
    expect(extractJsonObject('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("kod çitlerini soyar", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("çevre metin içindeki ilk dengeli nesneyi bulur", () => {
    const text = 'İşte planım:\n{"status":"plan","nested":{"x":1}}\nUmarım uygundur.';
    expect(extractJsonObject(text)).toBe('{"status":"plan","nested":{"x":1}}');
  });

  it("string içindeki süslü parantezleri saymaz", () => {
    const text = '{"instruction":"şunu yaz: } ve {","id":"a"}';
    expect(extractJsonObject(text)).toBe(text);
  });

  it("kaçışlı tırnakları doğru ele alır", () => {
    const text = '{"instruction":"dedi ki \\"bitti}\\" ","id":"a"}';
    expect(extractJsonObject(text)).toBe(text);
  });

  it("nesne yoksa null döner", () => {
    expect(extractJsonObject("hiç JSON yok")).toBeNull();
  });
});

describe("parseOperatorDecision", () => {
  it("plan kararını ayrıştırır ve varsayılanları doldurur", () => {
    const result = parseOperatorDecision(
      JSON.stringify({
        status: "plan",
        assignments: [{ id: "a1", agentId: "backend", kind: "implement", instruction: "Endpoint ekle" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isDelegateDecision(result.decision)).toBe(true);
    if (!isDelegateDecision(result.decision)) return;
    expect(result.decision.assignments[0]?.dependsOn).toEqual([]);
    expect(result.decision.assignments[0]?.skills).toEqual([]);
    expect(result.decision.acceptanceCriteria).toEqual([]);
  });

  it("continue kararını da delegasyon sayar", () => {
    const result = parseOperatorDecision(
      JSON.stringify({
        status: "continue",
        assignments: [{ id: "fix", agentId: "backend", kind: "implement", instruction: "Bulguları düzelt" }],
      }),
    );
    expect(result.ok && isDelegateDecision(result.decision)).toBe(true);
  });

  it("doğrudan yanıt (complete) kararını ayrıştırır", () => {
    const result = parseOperatorDecision('{"status":"complete","final":"3 beceri etkin."}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.status).toBe("complete");
    expect(isDelegateDecision(result.decision)).toBe(false);
  });

  it("blocked kararını ayrıştırır", () => {
    const result = parseOperatorDecision('{"status":"blocked","blocked":"Repo salt okunur"}');
    expect(result.ok && result.decision.status === "blocked").toBe(true);
  });

  it("boş atama listesini reddeder", () => {
    const result = parseOperatorDecision('{"status":"plan","assignments":[]}');
    expect(result.ok).toBe(false);
  });

  it("bilinmeyen görev türünü reddeder", () => {
    const result = parseOperatorDecision(
      '{"status":"plan","assignments":[{"id":"a","agentId":"b","kind":"deploy","instruction":"x"}]}',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Şema uyuşmazlığı");
  });

  it("JSON olmayan çıktı için düzeltilebilir hata verir", () => {
    const result = parseOperatorDecision("Tabii, hemen planlıyorum!");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("JSON nesnesi bulunamadı");
  });

  it("bozuk JSON için ayrıştırma hatası verir", () => {
    const result = parseOperatorDecision('{"status":"plan", assignments: }');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("JSON ayrıştırılamadı");
  });
});
