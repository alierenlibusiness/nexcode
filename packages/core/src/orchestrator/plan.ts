import { z } from "zod";

const planItemSchema = z.object({
  title: z.string().min(1),
  role: z.enum(["ceo", "frontend", "backend", "security", "qa", "devops"]),
});

export const planSchema = z.array(planItemSchema);
export type PlannedTask = z.infer<typeof planItemSchema>;

/**
 * CEO çıktısındaki JSON dizisini bulup plan olarak doğrular.
 * Eğer geçerli bir JSON dizisi bulunamazsa null döner (sohbet/soru-cevap modu).
 */
export function parsePlan(text: string): PlannedTask[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return null;
  }
  try {
    const json: unknown = JSON.parse(match[0]);
    return planSchema.parse(json);
  } catch {
    return null;
  }
}

/** CEO'ya plan/sohbet ikiliğini anlatan yönlendirici talimat. */
export const PLAN_INSTRUCTION =
  "Sen bir AI orkestratörü ve geliştirici asistanısın.\n" +
  "Kullanıcının girdisini analiz et:\n" +
  "1. Eğer girdi bir kodlama, dosya değiştirme veya proje geliştirme isteğiyse, yapılacak işleri küçük ve bağımsız görevlere ayır. " +
  "SADECE şu JSON formatında bir dizi döndür: [{\"title\":\"Görev adı\",\"role\":\"backend|frontend|security|qa|devops\"}]. Yanına başka hiçbir açıklama metni ekleme.\n" +
  "2. Eğer girdi genel bir soru, sohbet, açıklama talebi veya teknik bir danışma ise, doğrudan bir geliştirici gibi açıklayıcı ve yardımsever bir metin yanıtı döndür. JSON dizisi döndürme.\n\n" +
  "Kullanıcı İsteği:\n";
