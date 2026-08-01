import { z } from "zod";
import type { ConnectionPreference } from "../providers/connection";

/**
 * NEXCODE runtime yapılandırma sözleşmesi.
 *
 * `resources/nexcode.config.default.json` paylaşılabilir şablondur ve repoda commit'lenir;
 * kişiye özel `config.json` kullanıcı veri dizininde üretilir ve Git'e girmez.
 *
 * `normalizeConfig()` **saf ve idempotent**tir: aynı girdiye her zaman aynı çıktıyı verir,
 * girdiyi mutasyona uğratmaz ve kendi çıktısına yeniden uygulandığında sonuç değişmez.
 * Bu sözleşme değiştiğinde şu dosyalar birlikte ele alınmalıdır: `config/defaults.ts`,
 * `resources/nexcode.config.default.json`, ayarlar UI'ı ve `config/schema.test.ts`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Sabitler
// ─────────────────────────────────────────────────────────────────────────────

/** Yürütme politikası: görevin hız/kalite bütçesini belirler. */
export const EXECUTION_MODES = ["auto", "fast", "balanced", "deep"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** Operatörün bir uzmana verebileceği görev türleri. */
export const ASSIGNMENT_KINDS = ["plan", "implement", "review", "research"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

/** Orkestrasyon rolü: hangi görev türünü alabileceğini BAĞLAYICI biçimde belirler. */
export const ORCHESTRATION_ROLES = ["operator", "planner", "executor", "reviewer"] as const;
export type OrchestrationRole = (typeof ORCHESTRATION_ROLES)[number];

/**
 * Rol → izinli görev türü. Bu eşleme bağlayıcıdır: operatör yanlış eşleme üretse bile
 * motor atamayı uygun role taşır. Profildeki eski capability değerleri bu sınırı genişletemez.
 */
export const ALLOWED_KINDS: Readonly<Record<OrchestrationRole, readonly AssignmentKind[]>> = {
  operator: [],
  planner: ["plan", "research"],
  executor: ["implement"],
  reviewer: ["review"],
};

/** Bilinen CLI adapter'ları; tanınmayan komutlar `custom` olur. */
export const CLI_ADAPTERS = ["claude", "codex", "gemini", "opencode", "antigravity", "custom"] as const;
export type CliAdapter = (typeof CLI_ADAPTERS)[number];

/**
 * CLI marka renkleri: dört görsel yüzeyde (Komuta Merkezi, Pano, Canlı Kod, Ekip Akışı)
 * TEK standarttır. Çalışıyor/hata durumu renkle değil ayrı ipuçlarıyla belirtilir.
 */
export const CLI_COLOR: Readonly<Record<CliAdapter, string>> = {
  codex: "#10a37f",
  claude: "#d97757",
  gemini: "#4285f4",
  opencode: "#0ea5e9",
  antigravity: "#a855f7",
  custom: "#6b7280",
};

/**
 * Adapter başına sessizlik sınırı (saniye). Bir CLI bu süre boyunca yeni çıktı üretmezse
 * delegasyon `CLI_STALLED` olarak sınıflandırılır: süreç hiç çalışmadı demek DEĞİLDİR,
 * o ana kadarki ilerleme kaydı korunur.
 */
export const ADAPTER_SILENCE_SECONDS: Readonly<Record<CliAdapter, number>> = {
  codex: 180,
  gemini: 180,
  claude: 240,
  opencode: 300,
  antigravity: 240,
  custom: 300,
};

/**
 * Bağlantı tercihi: API anahtarı, CLI aboneliği ya da kota dolunca API'ye düşen CLI.
 * Tek kaynak `providers/connection.ts`'tir; aşağıdaki tip kontrolü ikisinin ayrışmasını engeller.
 */
const CONNECTION_PREFERENCE_VALUES = ["api_only", "cli_only", "cli_first"] as const;
type ConnectionPreferenceCheck = ConnectionPreference extends (typeof CONNECTION_PREFERENCE_VALUES)[number]
  ? (typeof CONNECTION_PREFERENCE_VALUES)[number] extends ConnectionPreference
    ? true
    : never
  : never;
const _connectionPreferencesInSync: ConnectionPreferenceCheck = true;
void _connectionPreferencesInSync;

// ─────────────────────────────────────────────────────────────────────────────
// Şema
// ─────────────────────────────────────────────────────────────────────────────

const modelRefSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});

const agentProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  /** Orkestrasyon rolü: izinli görev türünün kaynağı (ALLOWED_KINDS). */
  role: z.enum(ORCHESTRATION_ROLES),
  /** NexCode alan agent'ı (ceo/frontend/backend/security/qa/devops); keşfedilen CLI'larda yok. */
  domain: z.string().optional(),
  /** Rol prompt dosyası: `resources/roles/<lang>/` altında çözümlenir. */
  roleFile: z.string().default("executor.md"),
  connection: z.enum(CONNECTION_PREFERENCE_VALUES).default("cli_first"),
  autonomy: z.enum(["manual", "supervised", "autonomous"]).default("supervised"),
  /** API modunda kullanılacak model; boş bırakılırsa agent varsayılanı geçerlidir. */
  model: modelRefSchema.optional(),
  /**
   * Kullanıcı modeli açıkça seçtiyse `true`. Otomatik keşfin yazdığı model önerisi
   * bu bayrak olmadan global CLI ayarını EZEMEZ.
   */
  modelOverride: z.boolean().default(false),
  /** CLI modunda çalıştırılacak komut (keşfedilen agent'larda dolu). */
  cmd: z.string().optional(),
  args: z.array(z.string()).default([]),
  adapter: z.enum(CLI_ADAPTERS).optional(),
  /** Otomatik keşifle oluşturuldu mu: kullanıcı silerse gizleme listesine eklenir. */
  discovered: z.boolean().default(false),
});

const scheduleTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("interval"), everyMinutes: z.number().int().min(1) }),
  z.object({ type: z.literal("daily"), at: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({
    type: z.literal("weekly"),
    at: z.string().regex(/^\d{2}:\d{2}$/),
    days: z.array(z.number().int().min(0).max(6)).min(1),
  }),
]);

const scheduleSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  targetDir: z.string().optional(),
  operatorAgentId: z.string().optional(),
  executionMode: z.enum(EXECUTION_MODES).default("auto"),
  trigger: scheduleTriggerSchema,
  enabled: z.boolean().default(true),
  createdAt: z.string(),
  lastRunAt: z.string().nullable().default(null),
  nextRunAt: z.string().nullable().default(null),
  lastTaskId: z.string().nullable().default(null),
});

const cliModelSettingSchema = z.object({
  model: z.string().default(""),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  serviceTier: z.string().optional(),
  /**
   * Model açıkça yazılmazsa bu desenler sırayla denenir ve İLK eşleşen kullanılır;
   * `*` joker karakterdir. Sağlayıcı adları kişiden kişiye değişir.
   */
  modelPreferences: z.array(z.string()).default([]),
  /** Erişilebilir varsayılmayacak sağlayıcılar (yerel sunucu kullanacaksanız satırı silin). */
  modelExclude: z.array(z.string()).default([]),
});

export const nexcodeConfigSchema = z
  .object({
    /** Şema sürümü: ileri-only migration için. */
    version: z.number().int().min(1).default(1),

    /** Arayüz dili; `system` işletim sistemi dilini kullanır, bulunamazsa EN. */
    language: z.enum(["system", "en", "tr"]).default("system"),

    /** `auto` planı doğrudan yürütür; `ask` riskli planı insan onayına alır. */
    approvalMode: z.enum(["auto", "ask"]).default("auto"),
    /** Varsayılan çalışma klasörü; `.` uygulamanın açtığı klasördür. */
    workingDir: z.string().default("."),

    /** Günlük toplam model çağrısı tavanı (bütçe koruması). */
    dailyCallBudget: z.number().int().min(1).default(150),
    /** Kuyruk boşken motorun bekleme aralığı (saniye). */
    pollSeconds: z.number().int().min(1).default(15),

    memoryCharBudget: z.number().int().min(0).default(8000),
    teamContextCharBudget: z.number().int().min(0).default(30000),
    /**
     * Kullanıcı görev metni bu sınırı aşarsa (ör. 1000+ satırlık spec) tam metin çalışma
     * klasörünün `.nexcode/TASK-<id>.md` dosyasına yazılır; prompt'a yalnızca baş+son özeti
     * ve "tam metni dosyadan oku" işareti gömülür. Böylece katı JSON operatör protokolü
     * büyük metinde bozulmaz ve bağlam sessizce kesilmez.
     */
    taskPromptCharBudget: z.number().int().min(500).default(6000),

    /** Bir delegasyonun toplam süre tavanı (saniye). */
    agentTimeoutSeconds: z.number().int().min(30).default(900),
    /** Yeni çıktı gelmezse delegasyonun sonlandırılacağı süre (saniye). */
    cliSilenceTimeoutSeconds: z.number().int().min(30).default(300),

    /** Otonom çalışma onayı: bu değer null iken motor başlatılamaz. */
    autonomousConsentAcceptedAt: z.string().nullable().default(null),
    /** Kullanıcının sildiği otomatik adapter'lar; sonraki taramada geri oluşturulmaz. */
    discoveryIgnoredAdapters: z.array(z.string()).default([]),

    /** Canlı satır diff'i (Canlı Kod yüzeyi) açık mı ve tarama aralığı. */
    liveDiff: z.boolean().default(true),
    liveDiffIntervalMs: z.number().int().min(500).default(2500),

    /** Görev öncesi otomatik checkpoint ve saklanacak sürüm sayısı. */
    versioning: z.boolean().default(true),
    versioningRetention: z.number().int().min(1).default(20),

    /**
     * Ajan hapsi. `workspace` = agent yalnızca çalışma klasörüne yazabilir; dışarıya yazma
     * engellenir (Docker/Git GEREKMEZ). `off` = kısıtsız. `extraWritableDirs` monorepo için
     * çalışma klasörü dışında izin verilen mutlak yollardır.
     */
    sandbox: z
      .object({
        mode: z.enum(["workspace", "off"]).default("workspace"),
        extraWritableDirs: z.array(z.string()).default([]),
      })
      .default({}),

    /**
     * Görev başına git worktree izolasyonu.
     *
     * `task` modunda görev, ana çalışma ağacına hiç dokunmadan kendi worktree'sinde ve kendi
     * branch'inde koşar; teslimatta iş branch'e commit'lenir. Uzağa hiçbir şey gönderilmez.
     * `off` varsayılandır ve davranış birebir korunur.
     */
    worktree: z
      .object({
        mode: z.enum(["off", "task"]).default("off"),
        branchPrefix: z.string().default("nexcode/"),
        /** İzole ağaç açıldıktan sonra çalıştırılacak kurulum komutları (ör. bağımlılık kurma). */
        setupCommands: z.array(z.string()).default([]),
        /**
         * İzole ağaca bağlanacak, depoya girmeyen yollar (ör. `node_modules`, `.env`).
         * Mutlak yollar ve `..` kaçışları normalizasyonda atılır.
         */
        linkPaths: z.array(z.string()).default([]),
        commit: z.boolean().default(true),
        /** Başarısız görevin izole ağacı incelenebilsin diye korunur. */
        keepOnFailure: z.boolean().default(true),
        setupTimeoutSeconds: z.number().int().min(10).default(600),
      })
      .default({}),

    /**
     * Doğrulama kapısı. Her turun atamaları bittikten sonra bu komutlar çalışma klasöründe
     * fail-fast koşulur ve sonuç operatöre kanıt olarak verilir. Kırmızı kapı teslimat
     * kestirmelerini kapatır. `commands` boşken kapı hiç çalışmaz (opt-in).
     */
    verify: z
      .object({
        commands: z.array(z.string()).default([]),
        timeoutSeconds: z.number().int().min(5).default(600),
        maxOutputChars: z.number().int().min(200).default(6000),
        blockOnFailure: z.boolean().default(true),
        /** Kırmızı kapı teslimatı en fazla bu kadar kez engeller; sonrasında uyarılı teslim edilir. */
        maxAttempts: z.number().int().min(1).default(2),
      })
      .default({}),

    /**
     * Aynı anda yürütülecek görev sayısı. 1'den büyük değer `worktree.mode: "task"` gerektirir;
     * izolasyon olmadan paralel görevler birbirinin çalışma ağacını bozar.
     */
    maxConcurrentTasks: z.number().int().min(1).max(8).default(1),

    /** Dışa dönük MCP sunucusu: NEXCODE'u başka kodlama agent'larına araç olarak sunar. */
    mcpServer: z
      .object({
        /** Harici bir istemcinin motoru başlatıp durdurmasına izin ver. */
        allowEngineControl: z.boolean().default(false),
      })
      .default({}),

    /**
     * Her çalışma klasörünün `.nexcode/CONTEXT.md` proje profili görev açılışında operatöre
     * yüklenir (tüm kodu baştan taramaya gerek kalmaz); görev bitiminde operatör profili
     * REVİZE eder (changelog değil). `false` = eski global hafıza davranışı.
     */
    projectContext: z.boolean().default(true),
    projectContextCharBudget: z.number().int().min(0).default(6000),

    /** Görev bitince/başarısız olunca webhook'a `{text,…}` POST edilir (Slack uyumlu). */
    notify: z
      .object({
        webhookUrl: z.string().default(""),
        onComplete: z.boolean().default(true),
        onFailed: z.boolean().default(true),
      })
      .default({}),

    operator: z
      .object({
        /** Operatör olarak çalışacak agent profili (boş = ilk uygun `operator` rolü). */
        agentId: z.string().default(""),
        /** Operatör rolü sabittir; kullanıcı içeriğini düzenleyebilir ama dosya adı değişmez. */
        roleFile: z.literal("operator.md").default("operator.md"),
        maxRounds: z.number().int().min(1).default(6),
        maxDelegationsPerRound: z.number().int().min(1).default(8),
        maxInfrastructureRecoveryRounds: z.number().int().min(0).default(2),
        protocolRetries: z.number().int().min(0).default(2),
        /**
         * Turun tüm atamaları tamamlanmış ve en güncel inceleme PASS ise ikinci operatör
         * değerlendirme çağrısını atla. `false` eski (pahalı) değerlendirme yolunu zorlar.
         */
        passFastPath: z.boolean().default(true),
      })
      .default({}),

    /**
     * Geçici sağlayıcı hatalarında (rate limit / aşırı yük / ağ) delegasyon aynı agent ile
     * üstel bekleyerek yeniden denenir; kalıcı hatada iş aynı yetenekteki sağlıklı bir agent'a
     * devredilir. Operatöre geri dönüp yeni plan turu harcamak son çaredir.
     */
    resilience: z
      .object({
        transientRetries: z.number().int().min(0).default(2),
        retryBaseSeconds: z.number().int().min(1).default(3),
        maxFailoverAgents: z.number().int().min(0).default(1),
      })
      .default({}),

    /**
     * CLI-geneli model politikası. Öncelik: agent override > buradaki değer > CLI varsayılanı.
     * Boş model, CLI'ın kendi hesap/kurum varsayılanını kullanır.
     */
    cliSettings: z
      .object({
        claude: cliModelSettingSchema.default({}),
        codex: cliModelSettingSchema.default({}),
        gemini: cliModelSettingSchema.default({}),
        opencode: cliModelSettingSchema.default({}),
        antigravity: cliModelSettingSchema.default({}),
      })
      .default({}),

    /**
     * Yalnızca `enabled` listesindeki beceriler taranır. Operatör tüm katalog yerine göreve
     * göre kısa liste görür; uzman tam rehberi ancak gerekirse dosyadan okur. İlk kurulumda
     * liste paketle gelen tüm becerilerle doldurulur.
     */
    skills: z
      .object({
        enabled: z.array(z.string()).default([]),
        autoMatch: z.boolean().default(true),
        catalogLimit: z.number().int().min(1).default(12),
        maxSkillsPerAssignment: z.number().int().min(0).default(3),
        charBudget: z.number().int().min(0).default(2400),
        referenceCharBudget: z.number().int().min(0).default(1200),
      })
      .default({}),

    /** Agent profilleri: id → profil. 6 alan agent'ı + keşfedilen CLI'lar. */
    agents: z.record(agentProfileSchema).default({}),

    /** Zamanlanmış görevler. */
    schedules: z.array(scheduleSchema).default([]),

    /**
     * QA eskalasyon zinciri: ucuzdan pahalıya sırayla denenir. Basit görev en ucuz kademede
     * çözülür; yalnızca gerektiğinde üst kademeye çıkılır.
     */
    escalation: z
      .object({
        qa: z.array(modelRefSchema).default([]),
      })
      .default({}),

    /** CLI abonelik kotası: kayan pencere dolunca `cli_first` agent'lar API'ye düşer. */
    quota: z
      .object({
        windowHours: z.number().min(0.5).default(5),
        maxCallsPerWindow: z.number().int().min(1).default(50),
      })
      .default({}),

    /**
     * Bu metinlerden birini içeren plan, `approvalMode: ask` iken insan onayına alınır.
     * Onay kuyruğuna alınan plan hash'lenir; kaydedilen plan değişirse onay reddedilir.
     */
    riskyPatterns: z.array(z.string()).default([]),
  })
  .strip();

export type NexcodeConfig = z.infer<typeof nexcodeConfigSchema>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type ScheduleTrigger = z.infer<typeof scheduleTriggerSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type CliModelSetting = z.infer<typeof cliModelSettingSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Normalizasyon
// ─────────────────────────────────────────────────────────────────────────────

/** Bilinen CLI adları: `cmd` değerinden adapter türetmek için. */
const CMD_TO_ADAPTER: ReadonlyArray<readonly [RegExp, CliAdapter]> = [
  [/(^|[\\/])claude(-code)?(\.(cmd|bat|exe))?$/i, "claude"],
  [/(^|[\\/])codex(\.(cmd|bat|exe))?$/i, "codex"],
  [/(^|[\\/])gemini(\.(cmd|bat|exe))?$/i, "gemini"],
  [/(^|[\\/])opencode(\.(cmd|bat|exe))?$/i, "opencode"],
  [/(^|[\\/])antigravity(\.(cmd|bat|exe))?$/i, "antigravity"],
];

/**
 * Bir komut adından bilinen adapter'ı türetir. Bilinen CLI adı taşıyan `cmd`,
 * profildeki çelişkili `adapter` alanından ÜSTÜNDÜR: böylece bir bilgisayarda oluşmuş
 * bozuk profil (ör. `adapter: claude` + `cmd: codex`) başka bilgisayarda yanlış CLI çalıştırmaz.
 */
export function adapterFromCmd(cmd: string | undefined): CliAdapter | undefined {
  if (!cmd) return undefined;
  const bare = cmd.trim().replace(/^["']|["']$/g, "");
  for (const [pattern, adapter] of CMD_TO_ADAPTER) {
    if (pattern.test(bare)) return adapter;
  }
  return undefined;
}

/** Bir rolün belirli bir görev türünü alıp alamayacağı (bağlayıcı sözleşme). */
export function roleAllowsKind(role: OrchestrationRole, kind: AssignmentKind): boolean {
  return ALLOWED_KINDS[role].includes(kind);
}

/** Bir görev türünü alabilecek orkestrasyon rolü. */
export function roleForKind(kind: AssignmentKind): OrchestrationRole {
  if (kind === "review") return "reviewer";
  if (kind === "implement") return "executor";
  return "planner";
}

/** Adapter'a göre sessizlik sınırı (saniye); bilinmeyen adapter `custom` sayılır. */
export function silenceSecondsFor(adapter: CliAdapter | undefined): number {
  return ADAPTER_SILENCE_SECONDS[adapter ?? "custom"];
}

/**
 * Ham (kullanıcı düzenlemiş, eski şemadan gelmiş ya da kısmen bozuk) config'i geçerli
 * `NexcodeConfig`'e çevirir.
 *
 * SAF ve İDEMPOTENT: girdi mutasyona uğramaz, `normalize(normalize(x)) === normalize(x)`.
 *
 * Uygulanan onarımlar:
 * - Bilinen `cmd`, çelişkili `adapter` alanını ezer ve eski model override'ını temizler.
 * - Otomatik keşfedilmiş profildeki, kullanıcı seçimi olmayan `model` alanı düşürülür:
 *   global CLI ayarını sessizce ezmesin.
 * - `roleFile` her zaman rolüyle tutarlıdır; operatör rolü `operator.md`'ye sabitlenir.
 * - Agent kayıt anahtarı ile `id` alanı eşitlenir.
 */
export function normalizeConfig(raw: unknown): NexcodeConfig {
  const parsed = nexcodeConfigSchema.parse(raw ?? {});

  const agents: Record<string, AgentProfile> = {};
  for (const [key, profile] of Object.entries(parsed.agents)) {
    const derived = adapterFromCmd(profile.cmd);
    // Bilinen komut adı, çelişkili adapter alanını ezer.
    const adapterConflict = derived !== undefined && profile.adapter !== undefined && profile.adapter !== derived;
    const adapter = derived ?? profile.adapter;

    // Çelişkide eski model override'ı taşınmaz; keşfedilmiş profilde kullanıcı seçimi
    // olmayan model global CLI ayarını ezemez.
    const keepModel = profile.model !== undefined && !adapterConflict && (!profile.discovered || profile.modelOverride);

    agents[key] = {
      ...profile,
      id: key,
      ...(adapter !== undefined ? { adapter } : {}),
      ...(adapterConflict ? { args: [] } : {}),
      ...(keepModel ? {} : { model: undefined, modelOverride: false }),
      roleFile: profile.role === "operator" ? "operator.md" : defaultRoleFile(profile),
    };
  }

  const worktree = {
    ...parsed.worktree,
    branchPrefix: parsed.worktree.branchPrefix.trim() === "" ? "nexcode/" : parsed.worktree.branchPrefix,
    setupCommands: parsed.worktree.setupCommands.map((c) => c.trim()).filter((c) => c !== ""),
    // Bağlı yollar çalışma ağacının dışına taşamaz.
    linkPaths: dedupe(parsed.worktree.linkPaths.map((p) => p.trim()).filter(isContainedRelativePath)),
  };

  return {
    ...parsed,
    agents,
    worktree,
    verify: {
      ...parsed.verify,
      commands: parsed.verify.commands.map((c) => c.trim()).filter((c) => c !== ""),
    },
    // İzolasyon olmadan paralellik veri kaybına yol açar; güvenli tarafa düşürülür.
    maxConcurrentTasks: worktree.mode === "task" ? parsed.maxConcurrentTasks : 1,
    riskyPatterns: dedupe(parsed.riskyPatterns),
    discoveryIgnoredAdapters: dedupe(parsed.discoveryIgnoredAdapters),
    skills: { ...parsed.skills, enabled: dedupe(parsed.skills.enabled) },
  };
}

/** Mutlak yolları ve `..` kaçışlarını eleyen saf kontrol (node:path'e bağlanmaz). */
export function isContainedRelativePath(value: string): boolean {
  if (value === "") return false;
  // Unix kökü, Windows sürücüsü ve UNC payı.
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  return !value.split(/[\\/]/).includes("..");
}

function defaultRoleFile(profile: AgentProfile): string {
  const expected = `${profile.role}.md`;
  // Kullanıcı özel bir rol dosyası yazdıysa korunur; yalnızca başka rolün dosyası düzeltilir.
  const isStandard = ORCHESTRATION_ROLES.some((role) => profile.roleFile === `${role}.md`);
  return isStandard ? expected : profile.roleFile;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
