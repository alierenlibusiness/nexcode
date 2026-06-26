import type { ModelRef } from "../domain/agent";
import type { AgentDefinition } from "./definitions";

/**
 * QA Agent'ın 3-kademeli eskalasyon mantığı (PRD §8.5): birincil modelle başla; bir
 * deneme "yetersiz" (başarısız/flaky/karmaşık) ise artan-yetenek modele eskale et.
 * Saf mantık — gerçek model çağrısı `attempt` callback'i üzerinden enjekte edilir,
 * böylece sağlayıcıdan bağımsız test edilir.
 */
export function escalationLadder(def: AgentDefinition): readonly ModelRef[] {
  return [def.model, ...(def.escalationModels ?? [])];
}

export interface AttemptResult<T> {
  /** Sonuç tatmin edici mi (test geçti / analiz yeterli). False ise üst kademeye eskale edilir. */
  ok: boolean;
  value: T;
}

export type Attempt<T> = (modelRef: ModelRef, tier: number) => Promise<AttemptResult<T>>;

export interface EscalationOutcome<T> {
  ok: boolean;
  value: T;
  modelRef: ModelRef;
  /** 1-tabanlı kademe (1 = birincil/en ucuz). */
  tier: number;
  attempts: number;
  escalated: boolean;
}

/**
 * Merdiveni sırayla dener; ilk `ok` sonuçta durur. Tüm kademeler tükenirse son
 * (başarısız) sonucu `ok:false` ile döndürür — QA bunu açan agent'a geri gönderir.
 * Bir kademe exception fırlatırsa bir sonrakine geçilir; hepsi fırlatırsa son hata yükselir.
 */
export async function runWithEscalation<T>(
  ladder: readonly ModelRef[],
  attempt: Attempt<T>,
): Promise<EscalationOutcome<T>> {
  if (ladder.length === 0) throw new Error("Eskalasyon merdiveni boş olamaz.");

  let lastError: unknown;
  let lastResult: AttemptResult<T> | undefined;
  let lastModel: ModelRef | undefined;
  let lastTier = 0;

  for (let i = 0; i < ladder.length; i++) {
    const modelRef = ladder[i]!;
    const tier = i + 1;
    try {
      const result = await attempt(modelRef, tier);
      lastResult = result;
      lastModel = modelRef;
      lastTier = tier;
      if (result.ok) {
        return {
          ok: true,
          value: result.value,
          modelRef,
          tier,
          attempts: tier,
          escalated: tier > 1,
        };
      }
    } catch (err) {
      lastError = err;
      lastModel = modelRef;
      lastTier = tier;
    }
  }

  if (lastResult === undefined) {
    // Her kademe exception fırlattı.
    throw lastError instanceof Error
      ? lastError
      : new Error(`QA eskalasyonu tüm kademelerde başarısız: ${String(lastError)}`);
  }

  return {
    ok: false,
    value: lastResult.value,
    modelRef: lastModel!,
    tier: lastTier,
    attempts: ladder.length,
    escalated: ladder.length > 1,
  };
}
