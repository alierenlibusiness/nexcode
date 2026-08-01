import type { CliAdapter, OrchestrationRole } from "../../config/schema";
import { ADAPTER_SILENCE_SECONDS } from "../../config/schema";

/**
 * Bilinen CLI adapter'larının çalıştırma sözleşmesi.
 *
 * Değişmezler:
 * - Tüm çağrılar **non-interactive ve otonom** olmalıdır; desteklenmeyen ya da eski
 *   bayraklar profillere sızmamalıdır.
 * - Sağlık kontrolü ile normal çalışma **aynı** prompt materyalizasyonunu kullanır;
 *   aksi halde sağlıklı bir CLI yanlışlıkla `failed` sayılır.
 */

export type PromptMode = "stdin" | "arg" | "file";

export interface CliAdapterSpec {
  id: CliAdapter;
  label: string;
  /** Aranacak komut adları (uzantısız). */
  binaries: readonly string[];
  versionArgs: readonly string[];
  /** Non-interactive otonom çalışma için varsayılan argümanlar. */
  defaultArgs: readonly string[];
  /** Prompt'un sürece nasıl verildiği. */
  promptMode: PromptMode;
  /** `{PROMPT}` / `{PROMPT_FILE}` yer tutucusu taşıyan ek argümanlar. */
  promptArgs: readonly string[];
  /** Seçilen modeli CLI argümanına çevirir; boş model argüman üretmez. */
  modelArgs: (model: string) => string[];
  /** Keşifte bu CLI için önerilen orkestrasyon rolü. */
  defaultRole: OrchestrationRole;
  silenceSeconds: number;
  /** Otonom çalışma için gereken ortam değişkenleri. */
  env?: Readonly<Record<string, string>>;
}

const noModelArgs = (): string[] => [];

export const CLI_ADAPTER_SPECS: Readonly<Record<Exclude<CliAdapter, "custom">, CliAdapterSpec>> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    binaries: ["claude", "claude-code"],
    versionArgs: ["--version"],
    // `acceptEdits`: dosya düzenlemeleri sorulmadan uygulanır, tehlikeli kabuk komutları
    // yine onay ister. `bypassPermissions` bilerek kullanılmaz; izolasyon ve onay kapısı
    // bizim katmanımızın işi, CLI'ın tüm korumalarını kapatmanın değil.
    defaultArgs: ["-p", "--output-format", "json", "--permission-mode", "acceptEdits"],
    promptMode: "stdin",
    promptArgs: [],
    // Profilde açık `--model`/`-m` varsa yinelenmez; bu kontrol effectiveArgs'tadır.
    modelArgs: (model) => (model === "" ? [] : ["--model", model]),
    defaultRole: "executor",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.claude,
  },
  codex: {
    id: "codex",
    label: "Codex CLI",
    binaries: ["codex"],
    versionArgs: ["--version"],
    // `workspace-write`: model komutları çalışma klasörüne yazabilir, dışına çıkamaz.
    // `danger-full-access` bilerek kullanılmaz.
    defaultArgs: ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write"],
    promptMode: "arg",
    promptArgs: ["{PROMPT}"],
    modelArgs: (model) => (model === "" ? [] : ["--model", model]),
    defaultRole: "executor",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.codex,
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    binaries: ["gemini"],
    versionArgs: ["--version"],
    defaultArgs: ["--yolo"],
    promptMode: "arg",
    promptArgs: ["-p", "{PROMPT}"],
    // Gemini CLI kendi varsayılan modelini kullanır; katalog desteği yoktur.
    modelArgs: noModelArgs,
    defaultRole: "reviewer",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.gemini,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    binaries: ["opencode"],
    versionArgs: ["--version"],
    defaultArgs: ["run"],
    promptMode: "file",
    promptArgs: ["{PROMPT_FILE}"],
    modelArgs: (model) => (model === "" ? [] : ["--model", model]),
    defaultRole: "executor",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.opencode,
    env: { OPENCODE_PERMISSION_MODE: "auto" },
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity CLI",
    binaries: ["antigravity"],
    versionArgs: ["--version"],
    defaultArgs: ["--non-interactive"],
    promptMode: "stdin",
    promptArgs: [],
    modelArgs: (model) => (model === "" ? [] : ["--model", model]),
    defaultRole: "planner",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.antigravity,
  },
};

export function specFor(adapter: CliAdapter | undefined): CliAdapterSpec | undefined {
  if (adapter === undefined || adapter === "custom") return undefined;
  return CLI_ADAPTER_SPECS[adapter];
}

/** Profilde model argümanı zaten açıkça verilmiş mi (yinelenmeyi önler). */
export function hasExplicitModelArg(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--model" || arg === "-m" || arg.startsWith("--model="));
}

export interface EffectiveInvocation {
  args: string[];
  promptMode: PromptMode;
  silenceSeconds: number;
  env: Readonly<Record<string, string>>;
}

/**
 * Bir agent profilinden çalıştırılacak argümanları üretir.
 *
 * Model önceliği: **agent override > CLI-geneli ayar > CLI varsayılanı**.
 * Profilde açık model argümanı varsa hiçbir şey eklenmez.
 */
export function effectiveInvocation(input: {
  adapter: CliAdapter | undefined;
  profileArgs: readonly string[];
  /** Agent override modeli (varsa). */
  agentModel: string;
  /** `cliSettings[adapter].model`. */
  globalModel: string;
}): EffectiveInvocation {
  const spec = specFor(input.adapter);
  if (spec === undefined) {
    return {
      args: [...input.profileArgs],
      promptMode: "stdin",
      silenceSeconds: ADAPTER_SILENCE_SECONDS.custom,
      env: {},
    };
  }

  const base = input.profileArgs.length > 0 ? [...input.profileArgs] : [...spec.defaultArgs];
  const model = input.agentModel !== "" ? input.agentModel : input.globalModel;
  const modelArgs = hasExplicitModelArg(base) ? [] : spec.modelArgs(model);

  return {
    args: [...base, ...modelArgs, ...spec.promptArgs],
    promptMode: spec.promptMode,
    silenceSeconds: spec.silenceSeconds,
    env: spec.env ?? {},
  };
}

/**
 * Prompt yer tutucularını gerçek değerlerle doldurur.
 * `{PROMPT_FILE}` kullanan adapter'lar için geçici dosya yolu verilir.
 */
export function materializePrompt(
  args: readonly string[],
  prompt: string,
  promptFilePath: string | null,
): string[] {
  return args.map((arg) =>
    arg.replace("{PROMPT}", prompt).replace("{PROMPT_FILE}", promptFilePath ?? ""),
  );
}
