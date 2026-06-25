# NEXCODE — CLAUDE.md

> Çoklu-agent, paralel "vibe coding" iş akışları için masaüstü-öncelikli yapay zeka geliştirme ortamı.
>
> **Tam ürün spesifikasyonu:** [`docs/PRD.md`](docs/PRD.md) — mimari, agent mantığı, maliyet stratejisi, yol haritası ve risk kaydı oradadır. Gerektiğinde oku; bu dosya her oturumda yüklenir, o yüzden yalın tutulur.

---

## Proje Nedir

NEXCODE, bir geliştiricinin 6 uzman AI agent'ını tek bir **workspace** üzerinden, gerçek bir yazılım ekibi gibi **paralel** yönetmesini sağlayan Electron masaüstü uygulamasıdır. Bir kod editörü **değildir**; mevcut editör/IDE iş akışının üzerine binen bir **orkestrasyon ve gözlem katmanıdır** — git, terminal ve dosya sistemiyle doğrudan çalışır. Bu sınır korunur: yalnızca diff/önizleme + gözlem; tam editör özellikleri eklenmez.

---

## Çekirdek Prensipler

1. **Agent-first** — her özellik "bunu bir agent nasıl yapar" ile tasarlanır.
2. **Paralel varsayılan** — agent'lar eşzamanlı çalışır; sıralı çalışma istisnadır.
3. **Yıkıcı eylemden önce insan onayı** — geri alınamaz işlemler asla otonom yürütülmez.
4. **Workspace izolasyonu** — her proje kendi agent havuzu/belleği/git geçmişiyle izoledir.
5. **Sağlayıcı bağımsızlığı** — model değişimi konfigürasyondur, kod değişikliği değil.
6. **Doğru model, doğru göreve** — en pahalı model her zaman doğru değil; risk/hacim profiline göre seç.
7. **Gerçek zamanlı görünürlük** — durum/log/diff anlık yansır (<150ms).
8. **Git-native** — her görev branch/commit/PR'a bağlı; agent vs insan ayırt edilebilir.
9. **Şeffaflık** — her agent kararı izlenebilir log/akıl yürütme kaydına sahip.
10. **Geri alınabilirlik** — her agent değişikliği tek tıkla geri alınabilir (checkpoint).
11. **Maliyet görünürlüğü** — her görev maliyetiyle gösterilir; CLI-abonelik/API otomatik seçilebilir.
12. **Kademeli otonomi** — agent başına: manual → supervised → autonomous.

---

## Teknoloji Yığını (Hızlı Referans)

| Katman | Seçim |
|---|---|
| Frontend | Next.js (statik export — SSR/route handler **yok**), React 19, TypeScript (strict, `any` yasak), TailwindCSS, Shadcn UI, Zustand + TanStack Query, Monaco (diff), xterm.js |
| Masaüstü | Electron (stable), electron-builder (MSI/NSIS, dmg — signed/notarized), `node-pty`, `chokidar` |
| Orkestrasyon | Node.js (main process); renderer↔main = **IPC** (birincil); Fastify REST/WS yalnızca opsiyonel çoklu-pencere/uzak |
| Görev kuyruğu | **In-process** (`p-queue`/SQLite-destekli) varsayılan; BullMQ/Redis yalnızca opsiyonel bulut katmanı |
| Veri | SQLite (`better-sqlite3`); vektör **yerel** (`sqlite-vec`/gömülü pgvector); bulut PG/pgvector opsiyonel |
| Doğrulama | Zod (tüm API/IPC sınırlarında) |
| Test | Vitest (birim, orkestrasyon %90+), Playwright (E2E/Electron), provider sözleşme testleri |

> Model adları/sürümleri/tarihleri **varsayımdır**, uygulama anında doğrulanır (bkz. PRD).

---

## 6 Agent (Özet)

| # | Agent | Model | Bağlantı | Otonomi |
|---|---|---|---|---|
| 1 | CEO (Orkestratör) | Claude Opus 4.8 | CLI (Claude Code) | supervised — kod yazmaz, sadece planlar/atar |
| 2 | Frontend | GPT-5.5 (fb: Sonnet 4.6) | CLI (Codex CLI) | supervised→autonomous |
| 3 | Backend | Claude Opus 4.8 | CLI (Claude Code, CEO ile **paylaşılan havuz**) | supervised |
| 4 | Security | Claude Opus 4.8 | API | autonomous tarama; dosyaya **yazmaz**, sadece raporlar |
| 5 | QA / Test | DeepSeek V4 Flash → MiniMax M3 → Sonnet 4.6 (eskalasyon) | API | autonomous, event-driven |
| 6 | DevOps | Gemini 3.5 Flash | API | manual; production'a otonom dokunmaz |

Tam rol mantığı, araç setleri ve model gerekçeleri: [PRD Bölüm 8](docs/PRD.md).

---

## Kodlama Standartları

- Strict TypeScript: `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`. `any` yasak.
- Feature-based klasör yapısı; tekrarlanan mantık `/packages/core`'a.
- Conventional Commits; agent trailer (`Agent: backend-agent`).
- Birim testleri zorunlu (Vitest); orkestrasyon mantığı %90+ coverage.
- Structured (JSON) loglama.
- Her PR'da CI: bağımlılık taraması + secret-leak taraması.

---

## Yıkıcı Eylem Onay Kuralları (güvenlik-kritik — daima geçerli)

- **Otomatik (onaysız):** dosya okuma, lint, test çalıştırma, dry-run.
- **Onay-isteğe-bağlı:** yeni dosya oluşturma, bağımlılık ekleme.
- **Her zaman insan onayı:** `git push`/force-push, branch/dosya silme, `main`'e direkt push, production deploy, `.env` değişikliği, geri alınamaz migration, paket kaldırma.
- Her agent yalnızca `workspaceAccess` kapsamında dosya yazar. API anahtarları OS keychain'de şifreli saklanır — asla düz metin/bulut.

---

## ToS / Hukuki Not (kritik)

CLI aboneliklerini (Claude Code/Codex/Antigravity) headless subprocess olarak otomatikleştirmek sağlayıcı ToS'larıyla çelişebilir. **Kişisel kullanım = kullanıcının kendi aboneliği** (BYO). Ücretli SaaS/ekip katmanı abonelik kotasına **değil**, ticari API koşullarına dayanmalıdır. Detay: [PRD Bölüm 9.6 ve 26](docs/PRD.md).
