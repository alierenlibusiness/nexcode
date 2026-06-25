import { z } from "zod";

const planItemSchema = z.object({
  title: z.string().min(1),
  role: z.enum(["ceo", "frontend", "backend", "security", "qa", "devops"]),
});

export const planSchema = z.array(planItemSchema);
export type PlannedTask = z.infer<typeof planItemSchema>;

/** CEO çıktısındaki ilk JSON dizisini bulup plan olarak doğrular. */
export function parsePlan(text: string): PlannedTask[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error("CEO çıktısında plan (JSON dizisi) bulunamadı");
  }
  const json: unknown = JSON.parse(match[0]);
  return planSchema.parse(json);
}

/** CEO'ya plan formatını dayatan talimat. */
export const PLAN_INSTRUCTION =
  "Aşağıdaki isteği küçük, atanabilir görevlere ayır. SADECE şu formatta bir JSON dizisi döndür, " +
  'başka metin ekleme: [{"title":"...","role":"backend|frontend"}]. İstek:\n\n';
