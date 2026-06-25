# NEXCODE

Çoklu-agent, paralel "vibe coding" iş akışları için masaüstü-öncelikli yapay zeka geliştirme ortamı.

> Ürün vizyonu ve tam spesifikasyon: [`docs/PRD.md`](docs/PRD.md). Agent talimatları: [`CLAUDE.md`](CLAUDE.md).

## Durum — Faz 1 (Çekirdek / MVP)

Faz 0 iskeletinin üzerine **Faz 1 orkestrasyonu** kuruldu:

- **CEO → plan → onay → dispatch** döngüsü (`Orchestrator`): kullanıcı isteği CEO ile
  görev planına çevrilir, görevler task board'a düşer, onay sonrası atanan agent'a verilir.
- **Bağlantı modu seçimi (API / CLI):** her agent için `api_only` · `cli_only` ·
  `cli_first` (kota dolunca API'ye fallback). UI'dan toggle ile seçilir, SQLite'da saklanır.
  - **API modu:** Anthropic Messages API (anahtar OS keychain'de).
  - **CLI modu:** sistemde kurulu `claude` CLI headless (`-p --output-format json`).
- **Approval Gate:** yıkıcı eylemler her otonomi seviyesinde insan onayı gerektirir (sıfır-tolerans).
- **In-process görev kuyruğu:** 3 denemede `blocked`'a eskalasyon (Redis'siz).
- **UI:** API/CLI toggle'lı agent grid, istek kutusu, Kanban task board, onay paneli.

Kalan: görev başına git worktree + commit, imzalı Windows installer (electron-builder
config hazır, sertifika gerektirir). Yol haritası: PRD §23.

## Monorepo Yapısı

```
packages/core      Paylaşılan çekirdek: domain tipleri, SQLite şeması/repo,
                   secret-store (keychain), IPC kontrat (Zod), logger
apps/desktop       Electron main + preload + IPC handler
apps/renderer      Next.js (statik export) — karanlık tema UI kabuğu
```

`@nexcode/core` alt yolları:

- `@nexcode/core` — saf (native-bağımsız) API; renderer + main güvenle kullanır
- `@nexcode/core/db` — better-sqlite3 (yalnızca main process)
- `@nexcode/core/keyring` — OS keychain (yalnızca main process)

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
