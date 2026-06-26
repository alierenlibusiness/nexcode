/**
 * Eşzamanlılık: worktree + merge-time modeli (PRD §6.2). Her görev kendi git
 * worktree'sinde izole çalışır; yazma anında çakışma olmaz. Scheduler, görev atamadan
 * önce ÖRTÜŞEN DOSYA KAPSAMLARINI tespit eder ve örtüşenleri serileştirir. Gerçek
 * çakışma merge anında ortaya çıkar; otomatik birleşemezse görev `blocked` → insan kapısı.
 *
 * Bu modül saf mantıktır (git/IO yok) — scheduler kararlarını ve merge-sonucu
 * sınıflandırmasını test edilebilir kılar.
 */

export interface ScopedTask {
  id: string;
  /** Görevin dokunacağı dosya/dizin kapsamı (yol veya dizin öneki). */
  fileScope: readonly string[];
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** İki yol çakışır mı: eşit ya da biri diğerinin dizin atası (containment). */
export function pathsOverlap(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (x === y) return true;
  return x.startsWith(y + "/") || y.startsWith(x + "/");
}

/** İki görev kapsamı örtüşüyor mu (herhangi bir yol çifti çakışıyorsa). */
export function scopesOverlap(a: ScopedTask, b: ScopedTask): boolean {
  return a.fileScope.some((pa) => b.fileScope.some((pb) => pathsOverlap(pa, pb)));
}

export interface OverlapPair {
  a: string;
  b: string;
}

/** Örtüşen görev çiftlerini döndürür (scheduler bunları serileştirir). */
export function detectOverlaps(tasks: readonly ScopedTask[]): OverlapPair[] {
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      if (scopesOverlap(tasks[i]!, tasks[j]!)) {
        pairs.push({ a: tasks[i]!.id, b: tasks[j]!.id });
      }
    }
  }
  return pairs;
}

/**
 * Görevleri paralel-güvenli gruplara (batch) ayırır: aynı batch içindeki hiçbir görev
 * birbiriyle örtüşmez (hepsi paralel koşabilir). Örtüşenler sonraki batch'e itilir
 * (serileştirme). Greedy graph-coloring; deterministik (giriş sırasını korur).
 */
export function planConcurrencyBatches(tasks: readonly ScopedTask[]): string[][] {
  const remaining = [...tasks];
  const batches: string[][] = [];

  while (remaining.length > 0) {
    const batch: ScopedTask[] = [];
    const deferred: ScopedTask[] = [];
    for (const task of remaining) {
      const conflicts = batch.some((b) => scopesOverlap(b, task));
      if (conflicts) deferred.push(task);
      else batch.push(task);
    }
    batches.push(batch.map((t) => t.id));
    remaining.length = 0;
    remaining.push(...deferred);
  }
  return batches;
}

export type MergeOutcome = "merge" | "blocked";

/**
 * Merge-anı sınıflandırması (PRD §6.2): otomatik birleşebiliyorsa `merge`, aksi halde
 * `blocked` (insan onay kapısına düşer). `autoMergeable` git merge denemesinin sonucudur.
 */
export function classifyMergeResult(autoMergeable: boolean): MergeOutcome {
  return autoMergeable ? "merge" : "blocked";
}
