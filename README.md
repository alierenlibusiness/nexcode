# NEXCODE

Çoklu-agent, paralel "vibe coding" iş akışları için masaüstü-öncelikli yapay zeka geliştirme ortamı.

> Ürün vizyonu ve tam spesifikasyon: [`docs/PRD.md`](docs/PRD.md). Agent talimatları: [`CLAUDE.md`](CLAUDE.md).

## Durum — Faz 0 (Temel & İskelet)

Bu depo şu an **Faz 0** iskeletini içerir: çalışan monorepo, strict TypeScript, IPC köprüsü, SQLite şeması, OS keychain soyutlaması, karanlık-tema kabuğu ve CI. Yol haritası için PRD §23.

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

## Komutlar

```bash
pnpm install          # bağımlılıkları kur (better-sqlite3 native binary dahil)
pnpm build            # tüm paketleri derle (topolojik sıra)
pnpm typecheck        # strict tsc tüm paketlerde
pnpm test             # Vitest (core birim testleri)
pnpm lint             # ESLint
```

### Masaüstü uygulamasını çalıştırma (geliştirme)

better-sqlite3'ün Electron ABI'sine göre yeniden derlenmesi gerekir:

```bash
pnpm --filter @nexcode/desktop rebuild-native   # better-sqlite3 → Electron ABI
pnpm --filter @nexcode/renderer dev             # 1. terminal: Next.js dev (:3000)
# 2. terminal:
#   NEXCODE_RENDERER_URL=http://localhost:3000 pnpm --filter @nexcode/desktop start
```

Üretim için `apps/renderer` `out/` export'u, Electron tarafından `file://` ile yüklenir.

## Standartlar

Strict TypeScript (`strict`, `noUncheckedIndexedAccess`), Conventional Commits, Vitest.
Detay: [`CLAUDE.md`](CLAUDE.md) ve [`docs/PRD.md`](docs/PRD.md) §18.
