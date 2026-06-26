# NEXCODE

Çoklu-agent, paralel "vibe coding" iş akışları için masaüstü-öncelikli yapay zeka geliştirme ortamı.

> Ürün vizyonu ve tam spesifikasyon: [`docs/PRD.md`](docs/PRD.md). Agent talimatları: [`CLAUDE.md`](CLAUDE.md).

## Durum — Faz 2 (Tam Ekip · Çoklu Sağlayıcı · IDE Kabuğu)

Faz 1 orkestrasyonunun üzerine **Faz 2** kuruldu:

- **6 agent'ın tamamı:** CEO · Frontend · Backend · Security · QA · DevOps (PRD §8 model/bağlantı eşlemesi).
- **Provider-agnostic AI Gateway:** Anthropic, OpenAI (GPT/Codex), Google (Gemini),
  DeepSeek, MiniMax — ve **veri-güdümlü registry** sayesinde yeni sağlayıcı (Kimi, GLM…)
  eklemek sadece bir kayıt eklemek (OpenAI-uyumlu API'ler tek adapter'ı paylaşır).
- **Her agent için AI seçimi:** kullanıcı UI'dan agent başına model seçer; SQLite'da saklanır.
- **API / CLI çift mod + otomatik geçiş:** `api_only` · `cli_only` · `cli_first`.
  CLI adapter'ları: Claude Code · Codex CLI · Antigravity CLI. Kota dolunca (5 saatlik
  kayan pencere, `QuotaTracker`) API'ye düşer; her çağrı `cost_logs`'a `connection_mode` ile yazılır.
- **QA 3-kademeli eskalasyon:** DeepSeek V4 Flash → MiniMax M3 → Sonnet 4.6.
- **Inter-agent message bus (§6.7):** Backend → Security `review_request`, tamamlanan
  kod görevi → QA `test_request` (event-driven).
- **Merge-time conflict resolver (§6.2):** dosya kapsamı örtüşme tespiti + paralel-batch planlama.
- **IDE kabuğu (VS Code benzeri 3 panel):** solda **Open Folder** ile dosya ağacı, ortada
  salt-okunur kod görüntüleyici + **terminal**, sağda **vibe-coding sohbeti** (CEO orkestrasyon) ve
  agent/model paneli.
- **Approval Gate** (sıfır-tolerans) ve **in-process kuyruk** (Faz 1) korunur.

Kalan: görev başına git worktree + commit otomasyonu, imzalı Windows/macOS installer
(electron-builder config + entitlements hazır, sertifika/Apple hesabı gerektirir). Yol haritası: PRD §23.

## Monorepo Yapısı

```
packages/core      Paylaşılan çekirdek: domain tipleri, SQLite şeması/repo,
                   secret-store (keychain), IPC kontrat (Zod), logger
apps/desktop       Electron main + preload + IPC handler
apps/renderer      Next.js (statik export) — karanlık tema UI kabuğu
```

`@nexcode/core` alt yolları:

- `@nexcode/core` — saf (native-bağımsız) API; renderer + main güvenle kullanır
  (registry, adapter'lar, orchestrator, message bus, quota, escalation, conflict-resolver)
- `@nexcode/core/db` — better-sqlite3 (yalnızca main process)
- `@nexcode/core/keyring` — OS keychain (yalnızca main process)
- `@nexcode/core/providers` — CLI adapter'ları + AdapterFactory (node:child_process; yalnızca main)

## Gereksinimler

- Node.js ≥ 22
- pnpm ≥ 9

> Bu bir **pnpm** monorepo'sudur — `npm` değil `pnpm` kullanın.

## Komutlar

```bash
pnpm install          # bağımlılıkları kur (better-sqlite3 native binary dahil)
pnpm dev              # TEK KOMUT: ABI hazırlığı + renderer dev + Electron'u aç
pnpm build            # tüm paketleri derle (topolojik sıra)
pnpm typecheck        # strict tsc tüm paketlerde
pnpm test             # Vitest (core birim testleri)
pnpm lint             # ESLint
```

### Masaüstü uygulamasını çalıştırma

```bash
pnpm dev
```

`pnpm dev` şunları otomatik yapar (bkz. [`scripts/dev.mjs`](scripts/dev.mjs)):
better-sqlite3'ü Electron ABI'sine hazırlar → Next.js dev server'ı başlatır (:3000) →
hazır olunca Electron penceresini açar. Üretimde `apps/renderer/out` export'u `file://` ile yüklenir.

> **Native ABI notu:** `better-sqlite3` native binary'si Node ile Electron'da farklı ABI
> kullanır. `pnpm dev` binary'yi **Electron ABI'sine** geçirir; sonrasında `pnpm test` (Node)
> çalışmaz. Testlere dönmek için: **`pnpm rebuild:node`**. (Tek komutlar:
> `pnpm rebuild:electron` / `pnpm rebuild:node`.)

## Standartlar

Strict TypeScript (`strict`, `noUncheckedIndexedAccess`), Conventional Commits, Vitest.
Detay: [`CLAUDE.md`](CLAUDE.md) ve [`docs/PRD.md`](docs/PRD.md) §18.
