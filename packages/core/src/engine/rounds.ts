import type { ExecutionMode, NexcodeConfig } from "../config/schema";

/**
 * Yürütme politikası — bir görevin hız/kalite bütçesini belirler.
 *
 * Küçük iş gereksiz rollere bölünmez, çok bileşenli veya riskli iş tek uzmana yığılmaz.
 * `auto` görevi inceleyip diğer üç moddan birine çözümlenir; kullanıcı açıkça mod seçtiyse
 * sezgisel çalıştırılmaz.
 */
export interface RoundPolicy {
  mode: Exclude<ExecutionMode, "auto">;
  maxRounds: number;
  maxDelegationsPerRound: number;
  /**
   * İlk planda uygulama işi varsa bağımsız inceleme zorunlu mu.
   * `fast` küçük görevlerde tek executor ile yetinir.
   */
  requireReview: boolean;
  /**
   * Ayrı bir planlama delegasyonu açılsın mı. `balanced` planlamayı ilk turun zincirine
   * gömer (`plan → implement → review`); `deep` ayrı planlama turunu korur.
   */
  separatePlanning: boolean;
  /** Operatöre verilecek ekip/tur durumu context bütçesi (karakter). */
  contextCharBudget: number;
}

const BASE_POLICIES: Readonly<Record<Exclude<ExecutionMode, "auto">, Omit<RoundPolicy, "contextCharBudget">>> = {
  fast: {
    mode: "fast",
    maxRounds: 2,
    maxDelegationsPerRound: 3,
    requireReview: false,
    separatePlanning: false,
  },
  balanced: {
    // Tamamlanmış işi tekrar denetleten pahalı turları önlemek için üç turla sınırlı.
    mode: "balanced",
    maxRounds: 3,
    maxDelegationsPerRound: 6,
    requireReview: true,
    separatePlanning: false,
  },
  deep: {
    mode: "deep",
    maxRounds: 6,
    maxDelegationsPerRound: 8,
    requireReview: true,
    separatePlanning: true,
  },
};

/** Context bütçesinin moda göre oranı — derin mod tam bütçeyi kullanır. */
const CONTEXT_RATIO: Readonly<Record<Exclude<ExecutionMode, "auto">, number>> = {
  fast: 0.35,
  balanced: 0.7,
  deep: 1,
};

/**
 * `auto` modda görevi inceleyip somut bir moda çözümler.
 *
 * - `deep`  : çok bileşenli, mimari etkili, riskli ya da uzun spec içeren işler.
 * - `fast`  : tek dosyalık, küçük ve düşük riskli düzeltmeler.
 * - `balanced`: diğer her şey (varsayılan).
 */
const DEEP_SIGNALS = [
  "refactor",
  "yeniden yaz",
  "rewrite",
  "mimari",
  "architecture",
  "migrasyon",
  "migration",
  "güvenlik",
  "security",
  "performans",
  "performance",
  "deploy",
  "release",
  "breaking change",
  "veritabanı şeması",
  "database schema",
];

const FAST_SIGNALS = [
  "typo",
  "yazım",
  "rename",
  "yeniden adlandır",
  "log ekle",
  "add a log",
  "bump",
  "sürüm yükselt",
  "yorum ekle",
  "add comment",
  "format",
];

export function resolveExecutionMode(mode: ExecutionMode, prompt: string): Exclude<ExecutionMode, "auto"> {
  if (mode !== "auto") return mode;

  const text = prompt.toLowerCase();
  if (prompt.length > 1200 || DEEP_SIGNALS.some((signal) => text.includes(signal))) {
    return "deep";
  }
  if (prompt.length < 200 && FAST_SIGNALS.some((signal) => text.includes(signal))) {
    return "fast";
  }
  return "balanced";
}

/**
 * Çözümlenmiş mod ve kullanıcı yapılandırmasından tur politikasını üretir.
 * Config'teki operatör limitleri **tavan**dır: mod politikası bunları aşamaz.
 */
export function roundPolicyFor(mode: ExecutionMode, prompt: string, config: NexcodeConfig): RoundPolicy {
  const resolved = resolveExecutionMode(mode, prompt);
  const base = BASE_POLICIES[resolved];
  return {
    ...base,
    maxRounds: Math.min(base.maxRounds, config.operator.maxRounds),
    maxDelegationsPerRound: Math.min(base.maxDelegationsPerRound, config.operator.maxDelegationsPerRound),
    contextCharBudget: Math.round(config.teamContextCharBudget * CONTEXT_RATIO[resolved]),
  };
}

/** Tur sınırına ulaşıldı mı — ulaşıldıysa motor kısmi teslimata geçer. */
export function isFinalRound(round: number, policy: RoundPolicy): boolean {
  return round >= policy.maxRounds;
}
