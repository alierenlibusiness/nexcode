/**
 * Proje profili (`.nexcode/CONTEXT.md`).
 *
 * Her çalışma klasörü kendi profilini taşır; görev açılışında operatöre yüklenir, böylece
 * tüm kod tabanı her görevde baştan taranmak zorunda kalmaz. Görev bitiminde operatör
 * profili **revize eder** — bu bir changelog değildir, projenin güncel fotoğrafıdır.
 */

export const PROJECT_CONTEXT_PATH = ".nexcode/CONTEXT.md";

export interface ProjectContextPort {
  read: (workingDir: string, relativePath: string) => Promise<string | null>;
  write: (workingDir: string, relativePath: string, content: string) => Promise<void>;
}

/** Profil dosyası yokken kullanılan iskelet. */
export const PROJECT_CONTEXT_TEMPLATE = [
  "# Project Profile",
  "",
  "> Maintained by NEXCODE. This is a living snapshot of the project, not a changelog.",
  "> The operator revises it after each completed task.",
  "",
  "## Stack",
  "",
  "_Not yet discovered._",
  "",
  "## Layout",
  "",
  "_Not yet discovered._",
  "",
  "## Conventions",
  "",
  "_Not yet discovered._",
  "",
  "## Verification",
  "",
  "_Not yet discovered._",
  "",
].join("\n");

/** Operatöre profil revizyonu için verilen talimat. */
export const REVISE_INSTRUCTION = [
  "Aşağıda projenin mevcut profili ve az önce tamamlanan görevin teslimatı var.",
  "Profili GÜNCEL DURUMU yansıtacak biçimde REVİZE et.",
  "",
  "Kurallar:",
  "- Bu bir changelog DEĞİLDİR: 'şu eklendi' yazma, profilin ilgili bölümünü güncelle.",
  "- Yalnızca kalıcı ve tekrar kullanılabilir bilgiyi tut (yığın, yerleşim, sözleşmeler,",
  "  doğrulama komutları). Geçici görev ayrıntılarını yazma.",
  "- Değişmeyen bölümleri olduğu gibi bırak.",
  "- Yalnızca Markdown profil metnini üret; önsöz, sonsöz veya açıklama ekleme.",
].join("\n");

export class ProjectContext {
  constructor(
    private readonly port: ProjectContextPort,
    private readonly charBudget: number,
  ) {}

  /** Profili okur; yoksa boş döner (motor bu durumda profil bölümünü hiç eklemez). */
  async load(workingDir: string): Promise<string> {
    const raw = await this.port.read(workingDir, PROJECT_CONTEXT_PATH);
    if (raw === null || raw.trim() === "") return "";
    return raw.length > this.charBudget ? `${raw.slice(0, this.charBudget)}\n[… profil kırpıldı …]` : raw;
  }

  /** Profil yoksa iskeleti oluşturur. */
  async ensure(workingDir: string): Promise<void> {
    const raw = await this.port.read(workingDir, PROJECT_CONTEXT_PATH);
    if (raw === null) await this.port.write(workingDir, PROJECT_CONTEXT_PATH, PROJECT_CONTEXT_TEMPLATE);
  }

  /** Revizyon için operatöre verilecek prompt'u kurar. */
  buildRevisePrompt(currentProfile: string, delivery: string): string {
    return [
      REVISE_INSTRUCTION,
      "",
      "═══ MEVCUT PROFİL ═══",
      "",
      currentProfile.trim() === "" ? PROJECT_CONTEXT_TEMPLATE : currentProfile,
      "",
      "═══ TAMAMLANAN GÖREVİN TESLİMATI ═══",
      "",
      delivery,
    ].join("\n");
  }

  /** Operatörün ürettiği yeni profili yazar. Boş çıktı profili silmez. */
  async save(workingDir: string, revised: string): Promise<boolean> {
    const cleaned = stripCodeFence(revised).trim();
    if (cleaned === "") return false;
    await this.port.write(workingDir, PROJECT_CONTEXT_PATH, `${cleaned}\n`);
    return true;
  }
}

/** Model çıktısı Markdown çitiyle sarılmışsa soyar. */
export function stripCodeFence(text: string): string {
  const match = /^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(text.trim());
  return match?.[1] ?? text;
}
