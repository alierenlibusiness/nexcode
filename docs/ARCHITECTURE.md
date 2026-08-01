# NEXCODE Mimarisi

> Bu belge sistemin sözleşmelerini ve değişmezlerini tanımlar. Kod ile çeliştiği anda kod
> doğrudur ve belge güncellenmelidir.

**Son doğrulama:** 2026-08-02 (`pnpm -r build`, `typecheck`, `lint`, `test`, canlı uçtan uca görev koşumu)

## Amaç

NEXCODE, kullanıcının kendi makinesinde kurulu kodlama CLI'larını (Claude Code, Codex CLI,
Gemini CLI, OpenCode, Antigravity) tek bir operatör yönetiminde uzman ekip olarak çalıştıran
bir masaüstü orkestrasyon uygulamasıdır.

## Ürün akışı

```
Görev  ->  Operatör planı  ->  Uzman agent'lar  ->  İnceleme  ->  Doğrulama kapısı  ->  Teslimat
              |                      |                                                    |
              +-- riskli plan onayı  +-- canlı olay akışı + satır diff'i                  +-- branch
```

Operatör bir CLI'dır ve kod yazmaz: planlar, delege eder, sonucu değerlendirir ve yeni tur
açar. Uzman agent'lar (planner, executor, reviewer) ayrı süreçlerdir.

## Teknoloji

| Katman | Seçim |
|---|---|
| Masaüstü | Electron, electron-builder |
| Arayüz | Next.js statik export, React 19, TailwindCSS |
| Çekirdek | TypeScript strict (`any` yasak), saf modüller + enjekte port'lar |
| Veri | SQLite (`better-sqlite3`), sürümlü ileri-only migration |
| Doğrulama | Zod (tüm IPC sınırlarında) |
| Test | Vitest |

## Paket sınırları

`@nexcode/core` dört giriş noktası sunar. Bu ayrım kozmetik değildir: renderer bir Next.js
paketidir ve `node:*` modüllerini bundle edemez.

| Alt yol | İçerik | Kim kullanabilir |
|---|---|---|
| `@nexcode/core` | Saf çekirdek: motor, worktree, doğrulama kapısı, config, tipler | main + renderer |
| `@nexcode/core/db` | `better-sqlite3` bağımlı depolar | yalnızca sunucu tarafı |
| `@nexcode/core/providers` | `node:child_process` bağımlı CLI runner ve adapter'lar | yalnızca sunucu tarafı |
| `@nexcode/core/mcp` | MCP istemcisi ve yöneticisi (süreç açar) | yalnızca sunucu tarafı |
| `@nexcode/core/host` | Motor konağı: süreç port'ları, görev yaşam döngüsü, zamanlayıcı | yalnızca sunucu tarafı |

"Sunucu tarafı" iki tüketici demektir: Electron main process ve `nexcode` CLI. Host katmanı
Electron'a bağlı değildir; bu sayede masaüstü uygulaması ve `npx nexcode` **aynı** motoru,
aynı veritabanını ve aynı davranışı paylaşır.

**Değişmez:** saf çekirdeğe `node:*` import'u eklenirse renderer derlemesi kırılır. Native bir
modül eklerken uygun alt yola koy.

## Çekirdek modüller

```
packages/core/src/
  engine/       motor döngüsü, süpervizör, tur politikası, routing, verdict, recovery,
                protokol, prompt üretimi, canlı diff
  worktree/     görev başına git izolasyonu
  verify/       çalıştırılan doğrulama komutları (teslimat kapısı)
  checkpoints/  görev öncesi sürümleme, geri alma ve redo
  schedule/     tekrar eden görevlerin saf hesabı
  skills/       yerel beceri kataloğu ve eşleştirme
  sandbox/      agent hapsi (çalışma klasörü dışına yazma engeli)
  mcp/          saf protokol (server) + native istemci (client, manager)
  providers/    CLI adapter'ları ve API sağlayıcıları (hibrit yürütme)
  db/           SQLite şeması, migration'lar ve depolar
  config/       Zod şeması, normalizasyon, paylaşılabilir varsayılanlar
  host/         süreç port'ları, görev yaşam döngüsü konağı, zamanlayıcı tik'i

apps/
  cli/          `npx nexcode` komut satırı (task, run, status, approvals, doctor, mcp)
  desktop/      Electron main process, IPC ve preload köprüsü
  renderer/     dört arayüz yüzeyi
```

## Değişmezler

### Motor

- Otonom çalışma onayı (`autonomousConsentAcceptedAt`) alınmadan motor başlatılamaz.
- Operatör yalnızca katalogdaki etkin ve sağlıklı agent'lara iş verir.
- Rol, görev türünü bağlayıcı biçimde sınırlar: executor `implement`, reviewer `review`,
  planner `plan` alır. Operatör yanlış eşleme üretirse motor düzeltir.
- Turun tüm atamaları tamamlanmış ve en güncel inceleme PASS ise ikinci operatör
  değerlendirme çağrısı atlanır (`operator.passFastPath`).
- Tur bütçesi bitince iş çöpe atılmaz; mevcut haliyle uyarıyla teslim edilir.

### Doğrulama kapısı

- `verify.commands` boşken kapı hiç çalışmaz ve önceki davranış birebir korunur.
- Kapı, turun tüm atamalarından SONRA ve tamamlama kararlarından ÖNCE tek noktadan koşar.
- Kırmızı kapı FAST erken tamamlamayı, PASS hızlı yolunu ve inceleme valisini kapatır.
- Operatörün kırmızıya rağmen verdiği "tamamlandı" kararı **bir kez** reddedilir; ikinci
  kez gelirse teslimat uyarıyla yapılır. Saatlerce süren iş bir test hatası yüzünden silinmez.

### Worktree izolasyonu

- Varsayılan `off`; açıkken görev kendi ağacında ve kendi branch'inde koşar.
- **Kritik:** proje profili (`.nexcode/CONTEXT.md`) izole ağaçta değil özgün depoda tutulur.
  `EngineTask.workingDir` izole ağaç, `EngineTask.projectDir` özgün depodur. Profil ağaca
  yazılırsa görev bitiminde ağaçla birlikte kaybolur.
- Uzağa hiçbir şey gönderilmez: push ve PR bu katmanın işi değildir.
- Git yoksa, dizin depo değilse ya da HEAD boşsa uyarı yayınlanıp ana ağaca güvenle düşülür.

### Eşzamanlılık

- `maxConcurrentTasks > 1` yalnızca `worktree.mode: "task"` ile geçerlidir. İzolasyon olmadan
  paralel görevler birbirinin çalışma ağacını bozar; normalizasyon değeri 1'e düşürür ve IPC
  katmanı açık hata döner.
- Aynı görev iki slota düşmez: `claimNext(activeIds)` koşan görevleri atlar.
- `stop()` uçuştaki görevi yarıda kesmez; yarım kalan iş yarım kalan dosya değişikliğidir.

### Olay akışı

- Kalıcı geçmiş ile canlı akış **aynı** `seq` sayacını paylaşır.
- Arayüz önce canlı akışa abone olur, sonra geçmişi çeker ve `seq` ile tekilleştirir. Bu sıra
  ters çevrilirse replay sırasında gelen olaylar kaybolur.

### CLI çağrıları

- Agent süreçleri etkileşimsiz koşar. İzin istemi geldiği anda süreç sessizce bekler ve
  sessizlik zaman aşımıyla düşer; bu yüzden otonom bayraklar adapter spec'inde zorunludur.
- Verilen yetki **çalışma klasörüyle sınırlıdır**: Claude Code `--permission-mode acceptEdits`,
  Codex `--sandbox workspace-write`. `bypassPermissions` ve `danger-full-access` bilerek
  kullanılmaz; izolasyon, onay kapısı ve checkpoint bizim katmanımızın işidir, CLI'ın tüm
  korumalarını kapatmanın değil. Bir test bu sözleşmeyi kilitler.
- CLI çıktısı adapter'a göre normalize edilir. Claude Code `--output-format json` ile asıl
  yanıtı `result` alanına sarar; zarf ayıklanmazsa motor onu operatör kararı sanır ve her
  görev şema uyuşmazlığıyla düşer. Zarf ayrıca gerçek maliyeti taşır.
- Komutu olmayan profil çalıştırılamaz ve katalogdan düşürülür. Hangi profilin
  çalıştırılabildiğini yalnızca konak bilir (`EngineDeps.agentHealth`); saf çekirdek CLI
  varsayımı yapmaz.

### Loglama

Loglar **standart hataya** yazılır. Standart çıktı programın kendi çıktısına ayrılmıştır:
MCP stdio sunucusu stdout'u JSON-RPC için kullanır ve oraya düşen tek bir log satırı
istemcinin ayrıştırmasını bozar.

### Güvenlik

- API anahtarları OS keychain'de saklanır; düz metin dosyaya asla yazılmaz.
- `.env`, kimlik bilgileri ve özel anahtarlar canlı diff olaylarına ve checkpoint içeriğine
  alınmaz. İçeriği güvenle saklanamayan dosya `null` ile işaretlenir ve geri yüklemede
  dokunulmaz.
- Checkpoint geri yükleme yalnızca motor boştayken yapılır.
- Geri almadan önce mevcut durum için `redo` checkpoint'i oluşturulur.
- Dosya köprüsü (IPC `fs:*`) kullanıcının açtığı kökün dışına çıkamaz. Karşılaştırma
  `path.relative` üzerinden yapılır; salt string önek kontrolü `/repo-secrets` yolunu
  `/repo` içinde sayardı.
- Dışa dönük MCP sunucusunda motor kontrolü varsayılan kapalıdır; kapalıyken araç katalogda
  görünmez ve doğrudan çağrı da reddedilir.

### Yazım kuralı

Projenin hiçbir yerinde em dash (U+2014) kullanılmaz. Yerine iki nokta, noktalı virgül veya
parantez kullanılır. CI bu kuralı her push'ta doğrular; kural metni karakterin kendisini
içeremez, aksi halde belge kendi kuralını ihlal eder.

## Kodlama standartları

- Strict TypeScript: `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`. `any` yasak.
- Saf çekirdek + enjekte port deseni: süreç, dosya sistemi ve veritabanı erişimi arayüzlerden
  gelir, böylece tüm akış sahte agent'larla test edilebilir.
- Conventional Commits.
- Orkestrasyon mantığı için birim testi zorunludur.
- Structured (JSON) loglama.

## Yıkıcı eylem onayı

- **Otomatik:** dosya okuma, lint, test çalıştırma, dry-run.
- **Her zaman insan onayı:** `git push` ve force-push, branch veya dosya silme, `main`'e
  doğrudan push, production deploy, `.env` değişikliği, geri alınamaz migration, paket kaldırma.
- Riskli plan `approvalMode: "ask"` iken hash'lenerek onay kuyruğuna alınır; kaydedilen plan
  değişirse onay geçersizleşir.

## Doğrulama

```bash
pnpm install
pnpm -r build      # core önce, sonra uygulamalar
pnpm typecheck     # sıfır hata
pnpm lint
pnpm test          # 575 test
pnpm dev           # Electron uygulamasını aç
```

## ToS notu

CLI aboneliklerini headless subprocess olarak otomatikleştirmek sağlayıcı kullanım koşullarıyla
çelişebilir. Kişisel kullanım kullanıcının kendi aboneliğine dayanır (BYO). Ticari bir katman
abonelik kotasına değil, ticari API koşullarına dayanmalıdır.
