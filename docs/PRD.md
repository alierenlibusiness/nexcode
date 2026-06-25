# NEXCODE — Ürün Spesifikasyonu (PRD)

> Çoklu-agent, paralel "vibe coding" iş akışları için tasarlanmış, masaüstü-öncelikli yapay zeka geliştirme ortamı.
>
> Bu doküman tam ürün spesifikasyonudur. Her-oturum yüklenen yalın talimatlar için kök dizindeki [`CLAUDE.md`](../CLAUDE.md) dosyasına bakın.

> **Model/sürüm uyarısı:** Bu dokümandaki tüm model adları, sürüm numaraları ve tarihler (ör. Claude Opus 4.8, GPT-5.5, Gemini 3.5 Flash, DeepSeek V4, MiniMax M3, "Antigravity CLI", geçiş tarihleri) **tasarım-anı varsayımıdır**. Uygulama anında gerçek erişilebilirlik, fiyat ve API uyumluluğu doğrulanmalıdır. Sağlayıcı bağımsızlığı (Prensip 5) sayesinde bunlar konfigürasyon değişikliğidir.

---

## 1. Proje Özeti

NEXCODE, bir geliştiricinin aynı anda birden fazla yapay zeka agent'ını **görsel bir işletim sistemi** üzerinden yönetip, gerçek bir yazılım ekibi gibi paralel çalıştırmasını sağlayan masaüstü uygulamasıdır. Tek bir sohbet penceresinde tek bir AI ile konuşmak yerine, kullanıcı bir **workspace** açar; bu workspace içinde 6 uzman agent eşzamanlı olarak görev kuyruklarını işler, kod yazar, birbirine görev devreder ve sonuçta insan onayına sunar. Her agent kendi rolüne en uygun AI sağlayıcısına bağlanır — hepsi tek bir markaya kilitlenmez.

NEXCODE bir kod editörü değildir; var olan editör/IDE iş akışının **üzerine binen bir orkestrasyon ve gözlem katmanıdır**. Git, terminal ve dosya sistemiyle doğrudan çalışır.

---

## 2. Vizyon

Bir geliştiricinin, geleneksel tek-agent kodlama araçlarına kıyasla **3-5 kat daha hızlı** gerçek yazılım teslim edebilmesini sağlamak — agent'ları paralel çalıştırarak, görünür hale getirerek, doğru AI modelini doğru göreve atayarak ve insan onayını darboğaz değil **kontrol noktası** olarak konumlandırarak.

> **Gerçekçilik notu:** "3-5 kat" hızlanma, agent'ların gerçekten paralel ilerleyebildiği (havuz/kota sınırına takılmadığı) iş yüklerinde geçerlidir. CEO + Backend gibi aynı abonelik havuzunu paylaşan roller eşzamanlı yüksek hacimde çalıştığında bir **throughput tavanı** oluşur (bkz. Bölüm 9.3 ve Bölüm 26).

---

## 3. Temel Prensipler

1. **Agent-first mimari** — Her özellik önce "bunu bir agent nasıl yapar" sorusuyla tasarlanır.
2. **Paralel yürütme** — Agent'lar varsayılan olarak eşzamanlı çalışır; sıralı çalışma istisnadır, kural değil.
3. **Yıkıcı eylemlerden önce insan onayı** — `git push --force`, dosya/branch silme, production deploy, paket kaldırma gibi geri alınamaz işlemler agent tarafından **asla otonom** yürütülmez.
4. **Workspace tabanlı projeler** — Her proje izole bir workspace'tir: kendi agent havuzu, kendi belleği, kendi git geçmişi.
5. **Sağlayıcı bağımsızlığı** — Hiçbir agent tek bir AI sağlayıcısına kilitlenmez; model değişimi konfigürasyon değişikliğidir, kod değişikliği değildir.
6. **Doğru model, doğru göreve** — En pahalı/güçlü model her zaman en iyi seçim değildir; kritik-risk roller üst-tier model alır, yüksek-hacim/düşük-risk roller maliyet-etkin model alır.
7. **Gerçek zamanlı görünürlük** — Agent durumları, loglar ve diff'ler anlık yansır; kullanıcı hiçbir zaman "yenile" yapmak zorunda kalmaz.
8. **Git-native iş akışı** — Her agent görevi bir branch/commit/PR akışına bağlanır; "agent'ın yaptığı" ile "insanın onayladığı" git geçmişinde ayırt edilebilir olmalıdır.
9. **Şeffaflık** — Her agent kararının (neden bu dosyayı değiştirdi, neden bu kütüphaneyi seçti) izlenebilir bir log/akıl yürütme kaydı olmalıdır.
10. **Geri alınabilirlik** — Bir agent'ın yaptığı her değişiklik, tek tıkla geri alınabilir olmalıdır (checkpoint sistemi).
11. **Maliyet görünürlüğü ve optimizasyonu** — Her agent görevi tahmini/gerçekleşen maliyetiyle birlikte gösterilir; sistem CLI-abonelik ile API-anahtarı arasında otomatik en uygun olanı seçebilir (bkz. Bölüm 9).
12. **Kademeli otonomi** — Kullanıcı her agent için otonomi seviyesini ayarlar (her adımda onay → sadece riskli adımlarda onay → tam otonom).

---

## 4. Desteklenen Platformlar

| Platform | Durum | Teknoloji |
|---|---|---|
| **Windows 10/11 (x64, ARM64)** | Birincil hedef platform | Electron + native installer (MSI/NSIS) |
| **macOS (Apple Silicon + Intel)** | Tam destek, eşit öncelik | Electron (universal binary) |

> **Kapsam dışı (şimdilik):** iOS/mobil companion ve Linux desteği bu sürümde yok. Mimari provider-agnostic ve modüler kurulduğu için ileride eklenmesi mümkün, ama MVP ve sonraki fazlar sadece Windows + macOS masaüstü uygulamasına odaklanıyor.

---

## 5. Teknoloji Yığını

### 5.1 Frontend (Uygulama Katmanı)
- Next.js (App Router, Electron içinde **statik export** olarak çalışır — `output: export`)
- React 19
- TypeScript (strict mode, `any` yasak)
- TailwindCSS
- Shadcn UI
- Zustand (global state) + TanStack Query (sunucu/agent durumu senkronizasyonu)
- `react-resizable-panels` (multi-agent grid layout için)
- Monaco Editor (diff viewer ve inline kod önizleme için, tam IDE değil)
- `xterm.js` (entegre terminal görünümü)

> **Next.js export notu:** `output: export` ile çalışıldığı için SSR, server actions ve route handler (`app/api/...`) **kullanılamaz**. Renderer yalnızca statik bir SPA'dir; tüm "backend" mantığı Electron main process'te (IPC üzerinden) yürür. `/api/v1` REST yüzeyi (Bölüm 15) Next.js tarafından değil, ayrı yerel Node süreci tarafından sunulur (bkz. 5.3).

### 5.2 Masaüstü Runtime
- Electron (en güncel stable kanal)
- `electron-builder` (Windows MSI/NSIS, macOS dmg — notarized + code-signed)
- Native modüller: `node-pty` (gerçek terminal süreçleri — **hem agent terminal erişimi hem CLI-tabanlı AI bağlantıları için kullanılır, bkz. Bölüm 9**), `chokidar` (dosya izleme)
- Auto-update: Electron `autoUpdater` (Windows: Squirrel.Windows uyumlu, macOS: Sparkle uyumlu)

### 5.3 Backend / Orkestrasyon Süreci
- Node.js (LTS) — Electron **main process** içinde çalışan yerel orkestrasyon motoru
- **İletişim sınırı:** Renderer ↔ main arası birincil kanal **Electron IPC**'dir. Fastify tabanlı REST + WebSocket gateway **opsiyoneldir** ve yalnızca şu durumlarda devreye girer: çoklu-pencere senkronizasyonu, harici/uzak istemci erişimi, gelecekteki bulut/ekip katmanı. Tek-pencere masaüstü akışında IPC yeterlidir (bkz. Bölüm 15).
- Zod (tüm API/IPC sınırlarında runtime şema doğrulama)
- **Görev kuyruğu:** Varsayılan olarak **in-process kuyruk** (`p-queue` veya SQLite-destekli job tablosu) — yerel-öncelikli masaüstü senaryosunda harici Redis bağımlılığı **gerektirmez**. `BullMQ` (Redis tabanlı) yalnızca **opsiyonel bulut/ekip katmanında** (Faz 4) dağıtık kuyruk gerektiğinde kullanılır.
- `node-cron` (zamanlanmış agent görevleri)

### 5.4 Veritabanı & Depolama
- SQLite (yerel-öncelikli: workspace, agent durumu, görev geçmişi — `better-sqlite3`)
- **Vektör belleği (varsayılan yerel):** `sqlite-vec` veya gömülü pgvector — agent uzun-süreli belleği ve kod tabanı semantik araması için. Yerel-öncelikli prensibiyle uyumlu olması için bu **varsayılan olarak yerel** çalışır.
- PostgreSQL + bulut pgvector: **opsiyonel** — yalnızca bulut senkronizasyonu, ekip/lisans verisi ve paylaşılan vektör belleği için (Faz 4).
- Dosya/checkpoint depolama: yerel diskte content-addressed snapshot sistemi

### 5.5 Gerçek Zamanlı İletişim
- IPC delta güncellemeleri (birincil, tek-pencere)
- WebSocket (çoklu-pencere veya harici istemci durumunda agent durumu, log akışı, diff güncellemeleri)
- Server-Sent Events / stream (AI sağlayıcılardan gelen token-stream yanıtları için, agent "thinking" panelinde canlı yazma efekti)

### 5.6 AI Sağlayıcı Katmanı (Provider-Agnostic AI Gateway)

NEXCODE hiçbir agent'ı tek bir model/sağlayıcıya bağlamaz. Tüm sağlayıcılar **ortak bir `AIProviderAdapter` arayüzü** üzerinden konuşur (bkz. Bölüm 6.3) ve her biri **API anahtarı veya CLI abonelik** modunda çalışabilir (bkz. Bölüm 9). Desteklenen sağlayıcılar:

**Frontier / Ticari Bulut Sağlayıcılar**
- **OpenAI** — GPT-5.5, GPT-5.4, GPT-5.3-Codex (kod-odaklı varyant), o-serisi muhakeme modelleri
- **Anthropic** — Claude Opus 4.8, Claude Sonnet 4.6, Claude Haiku 4.5
- **Google** — Gemini 3.1 Pro, Gemini 3.5 Flash, Gemini 3.1 Flash-Lite (Vertex AI kurumsal uç noktası dahil)
- **xAI** — Grok 4.3, Grok 4.1 Fast (uzun bağlam / mantık-yoğun görevler)
- **Mistral AI** — Mistral Large / Small serisi
- **Cohere** — Command serisi (embedding/RAG görevleri için)
- **AI21 Labs** — Jamba serisi
- **Perplexity** — gerçek-zamanlı web aramalı yanıt

**Açık Ağırlıklı / Maliyet-Etkin Sağlayıcılar**
- **DeepSeek** — V4 Pro, V4 Flash (MIT lisanslı, OpenAI/Anthropic uyumlu istek formatı, ~$0.14/$0.28 per 1M token — sektördeki en ucuz seçeneklerden biri)
- **MiniMax** — M3 (SWE-bench Verified'da %80+ skor, ~$0.30/$1.20 per 1M token — fiyat/performans dengesinde dikkat çekici)
- **Alibaba Qwen** — Qwen 3.7 Max (ayrıca kendi "coding plan" aboneliği mevcut)
- **Moonshot AI** — Kimi K2.6
- **Meta** — Llama 4 (uzun bağlam varyantları)
- **Z.AI** — GLM-5 (ayrıca ucuz bir "GLM Coding" aboneliği mevcut, ~$10/çeyrek)

**Çoklu-Sağlayıcı Gateway / Yönlendirme**
- **OpenRouter** — tek API anahtarıyla 100+ modele erişim, sağlayıcı ücretine ek komisyon yok
- **Together AI**, **Fireworks AI** — açık modellerin yüksek-throughput barındırması
- **Groq** — ultra-düşük gecikmeli çıkarım

**Kurumsal / Uyumluluk Odaklı**
- **Azure OpenAI**, **AWS Bedrock** — kurumsal güvenlik/uyumluluk gerektiren ekipler için

**Yerel / Self-Hosted**
- **Ollama**, **LM Studio**, **vLLM**, **Hugging Face Inference Endpoints**

**Özelleşmiş Araçlar**
- **Morph (Fast Apply)** — agent diff/patch'lerini dosyaya milisaniyeler içinde uygulayan ayrı, ucuz "edit-apply" modeli

> **Mimari kural:** Yeni bir sağlayıcı eklemek, yeni bir adapter dosyası yazmaktan ibarettir; agent mantığında veya UI'da değişiklik gerektirmez. Bölüm 8'deki model/bağlantı önerileri **varsayılan**dır, her workspace ayarlardan değiştirilebilir.

### 5.7 Yardımcı Altyapı
- **Kimlik doğrulama (sadece bulut/ekip katmanı):** Clerk veya kendi JWT tabanlı çözümü. **MVP tek-kullanıcı yereldir ve auth gerektirmez** — kimlik doğrulama yalnızca Faz 4 (ekip/Cloud Sync) ile devreye girer.
- Sırlar/API anahtarı yönetimi: OS keychain üzerinden şifreli saklama — **API anahtarları asla düz metin veya bulutta saklanmaz**
- Telemetri: OpenTelemetry (opt-in, anonimleştirilmiş)
- Ödeme/lisanslama (gelecek SaaS katmanı için): Stripe

---

## 6. Sistem Mimarisi

### 6.1 Yüksek Seviye Mimari

```
┌──────────────────────────────────────────────────────────┐
│         NEXCODE Desktop (Electron — Win/macOS)            │
│  ┌────────────────────────────────────────────────────┐   │
│  │       Renderer UI (Next.js statik export/React)     │   │
│  └───────────────────────┬──────────────────────────--─┘   │
│                           │ IPC (birincil kanal)           │
│  ┌────────────────────────▼───────────────────────────┐   │
│  │     Local Orchestration Engine (main process)       │   │
│  │  ┌───────────┐ ┌──────────┐ ┌─────────────────┐    │   │
│  │  │ Agent     │ │ Task     │ │ Approval         │    │   │
│  │  │ Manager   │ │ Queue    │ │ Gate             │    │   │
│  │  └─────┬─────┘ └────┬─────┘ └────────┬────────┘    │   │
│  │        │            │                │              │   │
│  │  ┌─────▼────────────▼────────────────▼────────┐    │   │
│  │  │      AI Provider Abstraction Layer           │    │   │
│  │  │  ┌──────────────────┐  ┌──────────────────┐ │    │   │
│  │  │  │ API Adapter'lar  │  │ CLI Adapter'lar   │ │    │   │
│  │  │  │ (token bazlı)    │  │ (node-pty ile     │ │    │   │
│  │  │  │                  │  │  subprocess)       │ │    │   │
│  │  │  └──────────────────┘  └──────────────────┘ │    │   │
│  │  └─────────────────────┬────────────────────────┘    │   │
│  └────────────────────────┼─────────────────────────────┘   │
│           ┌────────────────┼───────────────┐                │
│   SQLite + sqlite-vec  Git Worktree   (ops.) pgvector/PG   │
│      (yerel)                            (bulut/ekip)        │
└────────────────────────────────────────────────────────────┘
        (Opsiyonel Fastify REST/WS gateway: çoklu-pencere / uzak istemci)
```

### 6.2 Agent Orchestration Layer
- **Agent Manager**: Her agent'ın yaşam döngüsünü yönetir (spawn, pause, resume, kill).
- **Scheduler**: Hangi agent'ın hangi görevi ne zaman alacağına bağımlılık grafiği üzerinden karar verir.
- **Conflict Resolver (worktree + merge-time modeli):** Eşzamanlılık tek bir modelle yönetilir — her görev kendi **git worktree**'sinde izole çalışır (bkz. Bölüm 13), dolayısıyla yazma anında dosya çakışması oluşmaz. Scheduler, görev atamadan önce **örtüşen dosya kapsamlarını** tespit eder; yüksek örtüşme varsa görevleri serileştirir veya ayrı branch'lere böler. Gerçek çakışma **merge anında** ortaya çıkar: otomatik birleştirilemeyen çakışmalarda görev `blocked` işaretlenir ve **insan onay kapısına** düşer. (Not: "write-time optimistic locking" yerine bu model benimsenmiştir; iki yaklaşım birbiriyle çelişiyordu.)

### 6.3 Provider Abstraction Layer (AI Gateway)

```typescript
interface AIProviderAdapter {
  id: string;                          // "anthropic", "openai", "deepseek", ...
  connectionMode: "api" | "cli";
  listModels(): Promise<ModelInfo[]>;
  complete(req: CompletionRequest): AsyncIterable<CompletionChunk>;
  supportsTools(): boolean;
  supportsVision(): boolean;
  estimateCost(req: CompletionRequest): CostEstimate;
}

// CLI-tabanlı sağlayıcılar (Claude Code, Codex CLI, Antigravity CLI) için özelleşmiş adapter
interface CLIProviderAdapter extends AIProviderAdapter {
  connectionMode: "cli";
  binaryPath: string;                  // "claude" | "codex" | "antigravity"
  spawnHeadless(req: CompletionRequest): PtyProcessHandle;   // node-pty üzerinden, non-interactive/print modda
  getQuotaStatus(): SubscriptionQuotaInfo;                   // 5 saatlik kayan pencere, haftalık tavan
}
```

Bu katman ayrıca: otomatik retry/backoff, rate-limit yönetimi, sağlayıcı kesintisinde otomatik fallback ve maliyet takibini (hem token-bazlı hem abonelik-kotası bazlı) içerir.

> **CLI parser kırılganlığı (operasyonel risk):** CLI adapter'lar subprocess stdout/stderr çıktısını parse eder. Bu araçların (Claude Code, Codex CLI, Antigravity CLI) çıktı formatı sürüm güncellemeleriyle değişebilir ve parser'ı sessizce bozabilir. Azaltım: (1) desteklenen CLI sürümlerini **sabitle/doğrula**, (2) çıktı-format **sözleşme testleri** (Bölüm 19), (3) parse hatası saptandığında ilgili agent'ı otomatik **API moduna zarif geçir** ve kullanıcıyı bilgilendir.

### 6.4 Task Queue & Scheduler
- Her agent için ayrı kuyruk — varsayılan **in-process** (`p-queue` / SQLite-destekli; bkz. 5.3). Dağıtık BullMQ yalnızca opsiyonel bulut/ekip katmanında.
- Yeniden deneme politikası: agent bir görevde 3 defa hata alırsa otomatik olarak `blocked` durumuna geçer ve insana eskale edilir.

### 6.5 Memory Sistemi
Üç katmanlı bellek: kısa-süreli (oturum), workspace belleği (SQLite), uzun-süreli semantik bellek (**varsayılan yerel** `sqlite-vec`/gömülü pgvector, RAG; bulut pgvector opsiyonel — bkz. 5.4).

### 6.6 Tool / Function Calling Framework
Her agent'a rolüne özel, capability-based bir araç seti tanımlanır (Bölüm 8'de her agent için tam liste var).

### 6.7 Inter-Agent Communication Protocol (Message Bus)
```json
{
  "from": "backend-agent",
  "to": "security-agent",
  "type": "review_request",
  "payload": { "diff_id": "d-2291", "files": ["api/users.ts"] }
}
```

### 6.8 Approval / Onay Katmanı
- **Otomatik**: dosya okuma, lint, test çalıştırma.
- **Onay-isteğe-bağlı**: yeni dosya oluşturma, bağımlılık ekleme.
- **Her zaman onay gerektirir**: git push, branch/dosya silme, production deploy, `.env` değişikliği, geri alınamaz migration.

---

## 7. Agent Mimarisi (Veri Modeli)

```typescript
interface ModelRef {
  provider: string;
  modelId: string;
  connectionMode: "api" | "cli";
}

interface Agent {
  id: string;
  role: AgentRole;               // "ceo" | "frontend" | "backend" | "security" | "qa" | "devops"
  systemPrompt: string;
  model: ModelRef;
  escalationModels?: ModelRef[]; // sırayla denenecek, artan-yetenek modeller (QA Agent için bkz. 8.5)
  fallbackModel?: ModelRef;      // birincil sağlayıcı kesintisinde devreye giren alternatif
  memory: AgentMemoryRef;
  workspaceAccess: WorkspaceScope;
  toolset: ToolCapability[];
  taskQueue: TaskQueueRef;
  status: AgentStatus;
  autonomyLevel: "manual" | "supervised" | "autonomous";
  costBudget?: { maxTokensPerTask: number; maxUsdPerDay: number };
}
```

---

## 8. Yerleşik Agentlar (6 Agent — Tam Mantık, Model ve Bağlantı Eşlemesi)

NEXCODE v1, altı uzman agent ile çalışır — tam bir geliştirme döngüsünü kapatır: **planla → yaz → güvenli kıl → test et → dağıt**. Her agent göreviyle orantılı bir model ve bağlantı modu kullanır; en pahalı model her zaman en doğru seçim değildir (Bölüm 9'da detaylı maliyet mantığı var).

| # | Agent | Model | Bağlantı Modu | Otonomi |
|---|---|---|---|---|
| 1 | CEO (Orkestratör) | **Claude Opus 4.8** | CLI (Claude Code, Max plan) | supervised |
| 2 | Frontend | **GPT-5.5** (fallback: Claude Sonnet 4.6) | CLI (Codex CLI, ChatGPT Plus/Pro) | supervised → autonomous'a çekilebilir |
| 3 | Backend | **Claude Opus 4.8** | CLI (Claude Code, CEO ile paylaşılan havuz) | supervised |
| 4 | Security | **Claude Opus 4.8** | API anahtarı | autonomous tarama, bloklarda insan bildirimi |
| 5 | QA / Test | **DeepSeek V4 Flash → MiniMax M3 → Claude Sonnet 4.6** (eskalasyon) | API anahtarı (üçü için de) | autonomous |
| 6 | DevOps | **Gemini 3.5 Flash** | API anahtarı (ücretsiz katman değerlendirilebilir) | manual |

### 8.1 CEO Agent (Orkestratör)
**Sorumluluk**: Kullanıcının yüksek seviye isteğini küçük, atanabilir görevlere ayırmak; bağımlılık grafiği kurmak; görevleri doğru agent'a atamak; bir agent bloklandığında yeniden planlamak.

**Mantık / İş Akışı**: Kullanıcı bir istek girince workspace belleğini okur, bir görev planı (task graph) üretir ve kısa bir onay olarak sunar. Onaylandıktan sonra alt görevleri dağıtır. **Kendisi hiçbir zaman kod yazmaz veya dosyaya dokunmaz.**

**Araç seti**: `task_create`, `task_assign`, `task_reprioritize`, `workspace_memory_read`, `agent_status_read`.

**Neden Opus 4.8**: Çok-adımlı planlama ve doğru bağımlılık çözümlemesi en güçlü muhakemeyi gerektirir; yanlış bir plan tüm ekibi yanlış yöne sürükler.

**Neden CLI (Claude Code, Max plan)**: Sürekli çalışan, yüksek-hacimli bir rol — sabit aylık ücret, token-bazlı faturalandırmaya göre bu hacimde çok daha ucuza gelir. **Backend Agent ile aynı Claude Code aboneliğini paylaşır** (bkz. Bölüm 9.3) — tek bir Max 20x planı ikisini de besler. (Paylaşılan havuzun throughput etkisi için bkz. Bölüm 26.)

### 8.2 Frontend Agent
**Sorumluluk**: UI bileşenleri, state bağlama, stil, erişilebilirlik, Backend'in ürettiği API şemasına göre veri çekme/gösterme.

**Mantık / İş Akışı**: Görevi aldığında ilgili API sözleşmesini workspace belleğinden okur; sözleşme yoksa görev otomatik `blocked` olur ve Backend'e bağımlılık olarak işaretlenir. Tamamlanan görev otomatik QA kuyruğuna düşer.

**Araç seti**: `file_read/write` (`/app`, `/components`, `/styles`), `terminal` (zararsız komutlar), `git_diff_create`.

**Neden GPT-5.5**: Çok-modlu (görsel) yeteneği "bu tasarımı/ekran görüntüsünü uygula" türü UI işlerinde gerçek bir avantaj, ve geniş frontend ekosistem bilgisi var. Çok yüksek hacimli, ince-ayar diff üretimi gerekiyorsa alternatif olarak GPT-5.3-Codex (kod-odaklı varyant) değerlendirilebilir.

**Neden CLI (Codex CLI, ChatGPT Plus/Pro)**: Sürekli, yüksek hacimli UI üretimi — abonelik burada da kazanır.

### 8.3 Backend Agent
**Sorumluluk**: API endpoint'leri, veritabanı şeması/migration, iş mantığı, üçüncü parti entegrasyonlar.

**Mantık / İş Akışı**: Mevcut şemayı/migration geçmişini okur, geriye dönük uyumluluğu kontrol eder. **Her PR'ı otomatik olarak Security Agent'a `review_request` olarak gönderir** — onay gelmeden merge edilmez. Migration'lar her zaman insan onayı gerektirir.

**Araç seti**: `file_read/write` (`/api`, `/server`, `/prisma`), `terminal` (migration "apply" adımı onaylı), `git_diff_create`, `task_handoff`.

**Neden Opus 4.8**: Backend mantığı hata toleransı en düşük katman — en güçlü model burada doğru tercih.

**Neden CLI (Claude Code)**: En yüksek hacimli kod üretimi rolü — CLI abonelik modunda en büyük tasarruf burada gerçekleşir.

### 8.4 Security Agent
**Sorumluluk**: Bağımlılık güvenlik açığı taraması, auth/şifreleme kodu incelemesi, secret-leak taraması, Backend ve DevOps'un çıktısını otomatik review etmek.

**Mantık / İş Akışı**: **Pasif-tetiklemeli** — kendi başına özellik üretmez, `review_request` mesajlarını bekler. Kritik açık bulursa görevi otomatik `blocked` yapar. **Hiçbir zaman dosyaya yazmaz** — sadece rapor üretir.

**Araç seti**: `file_read` (salt-okunur, tüm workspace), `dependency_scan`, `secret_scan`, `task_block`, `git_diff_read`.

**Neden Opus 4.8**: Yanlış-negatif (gözden kaçan açık) maliyeti çok yüksek — en doğru tercih en güçlü model.

**Neden API anahtarı (CLI değil)**: Tetiklemeli bir rol — her PR'da bir kez çalışır, sürekli/yüksek-hacimli değildir. Ayrı bir abonelik koltuğu (Max plan) burada gereksiz; token-bazlı API faturalandırması bu kullanım profilinde daha ucuz ve daha öngörülebilir.

### 8.5 QA / Test Agent
**Sorumluluk**: Birim/entegrasyon test yazımı, test çalıştırma, regresyon kontrolü, repro adımlarıyla hata raporu.

**Mantık / İş Akışı**: **Event-driven** — bir agent görevi `completed` işaretlediğinde otomatik tetiklenir. Test başarısızsa açan agent'a insan beklemeden otomatik geri gönderir. **3 kademeli eskalasyon mantığı**:
1. **Varsayılan (Tier 1)**: DeepSeek V4 Flash — basit test üretimi/çalıştırma, ilk deneme.
2. **Tier 2** (1. deneme başarısız veya flaky test şüphesi): MiniMax M3 — orta karmaşıklıkta analiz, SWE-bench'te güçlü fiyat/performans.
3. **Tier 3** (2. deneme de başarısız veya karmaşık edge-case analizi): Claude Sonnet 4.6 — en yetenekli, en pahalı kademe, sadece gerektiğinde.

**Araç seti**: `file_read/write` (`/tests`, `/__tests__`), `terminal` (test komutları, onaysız), `git_diff_read`.

**Neden bu üçlü, neden API anahtarı**: Bu modellerin token fiyatı zaten çok düşük (DeepSeek ~$0.14/$0.28, MiniMax ~$0.30/$1.20 per 1M) — bir CLI aboneliği almanın hiçbir maliyet avantajı yok, üstelik bu modellerin zaten flat-rate abonelik CLI'ları da bulunmuyor. Eskalasyon, maliyeti minimumda tutarken karmaşık durumlarda kaliteyi korur.

### 8.6 DevOps Agent
**Sorumluluk**: CI/CD pipeline tanımı, build script'leri, ortam değişkeni yönetimi, deploy süreci, Docker/altyapı dosyaları.

**Mantık / İş Akışı**: Değişikliklerde önce "dry-run" yapar, sonucu insana sunar. **Production'a dokunan hiçbir adım otomatik yürütülmez.** Altyapı değişikliği güvenlik etkisi taşıyorsa Security Agent'a `review_request` gönderir.

**Araç seti**: `file_read/write` (`/ci`, `/.github`, `docker-compose`), `terminal` (dry-run onaysız, gerçek deploy onaylı), `task_handoff`.

**Neden Gemini 3.5 Flash**: Google'ın agentic/coding işleri için konumlandırdığı hızlı katman; config/script üretiminde yeterince güçlü, maliyeti düşük.

**Neden API anahtarı**: Tetiklemeli bir rol (her deploy/config değişikliğinde bir kez) — düşük-orta frekans. Google'ın ücretsiz katmanı (günlük istek limitiyle) bu hacmi büyük ölçüde karşılayabilir; ayrı bir abonelik gerekmez. **Not**: Google, Gemini CLI'ı Antigravity CLI'a geçiriyor (duyurulan geçiş — tarih varsayım, doğrulanmalı) — bu adapter ileride Antigravity'ye güncellenmeli, entegrasyon bunu izlemeli.

---

## 9. Maliyet Stratejisi: API Anahtarı vs CLI Subscription Bağlantısı

Bu, sürekli-çalışan "vibe coding" mimarisinde en kritik maliyet kararıdır ve NEXCODE'un her agent'ın bağlantı modunu **bağımsız olarak** seçebilmesi gerekir.

### 9.1 İki Bağlantı Modu

**API Anahtarı modu**: Sağlayıcının REST API'sine doğrudan, token bazlı ücretlendirme ile bağlanır. Üst limit yok, kullanım kadar öde. Düzensiz/seyrek tetiklenen iş yükleri için ideal.

**CLI Subscription modu**: Sağlayıcının kendi terminal aracını (Claude Code, Codex CLI, Antigravity CLI) kullanıcının mevcut aboneliği üzerinden, sabit aylık ücretle çalıştırır. NEXCODE bu CLI'ları **headless/non-interactive modda** alt süreç olarak başlatır — agent terminal erişimi için zaten var olan `node-pty` altyapısı burada da kullanılır. Sürekli, yüksek-hacimli iş yükü için maliyet-etkin.

> **Önemli:** Bu modun ToS/hukuki boyutu kritiktir — bkz. Bölüm 9.6 ve Bölüm 26.

### 9.2 Hangi CLI Hangi Sağlayıcıyı Kapsıyor

| CLI Aracı | Sağlayıcı | Abonelik Seçenekleri | Not |
|---|---|---|---|
| **Claude Code** | Anthropic | Pro ($20/ay), Max 5x ($100/ay), Max 20x ($200/ay) | Token bütçesi 5 saatlik kayan pencerede paylaşılır; aynı abonelikle çalışan agent'lar **aynı havuzu** tüketir |
| **Codex CLI** | OpenAI | ChatGPT Plus ($20/ay), Pro 5x ($100/ay), Pro 20x ($200/ay) — Free planda da temel erişim var | ChatGPT girişiyle abonelik, API anahtarıyla ayrı/token-bazlı |
| **Antigravity CLI** (eski adıyla Gemini CLI) | Google | Ücretsiz katman (günlük istek limiti) veya Google AI Studio API anahtarı | Geçiş duyuruldu — tarih varsayım, entegrasyon bunu izlemeli |
| — (abonelik CLI'sı yok) | DeepSeek, MiniMax, Qwen, Cohere, vb. | Sadece API anahtarı (BYOK) | Token fiyatı zaten çok düşük — abonelik avantajı yok |

### 9.3 Karar Çerçevesi

Kural: **(premium/üst-tier model) + (sürekli/yüksek-hacimli kullanım) = CLI subscription.** Diğer her durumda API anahtarı daha mantıklı (bkz. Bölüm 8'deki tablo ve gerekçeler).

> **Önemli mimari not**: CEO ve Backend Agent **aynı Claude Code aboneliğini** paylaşır — yani tek bir Max 20x ($200/ay) planı ikisini de besler, ama 5 saatlik token penceresi **ortaktır**. Cost dashboard bu havuzu agent bazında değil, **abonelik bazında** göstermeli; aksi halde kullanıcı "neden Backend'in kotası CEO yüzünden tükendi" diye yanlış yorumlayabilir.
>
> **Throughput tavanı:** Paylaşılan havuz, iki agent'ın eşzamanlı yüksek-hacimli çalışmasında bir üst sınır oluşturur (Prensip 2 "paralel by default" ile gerilim). Azaltım seçenekleri: (a) CEO + Backend için **ayrı abonelikler** (izole havuz, daha pahalı), (b) **zamanlama-farkında throttling** (Scheduler havuz doluluğuna göre sıraya alır), (c) kota dolunca **API moduna geçiş** (9.4). Bkz. Bölüm 26.

### 9.4 Otomatik Geçiş (Fallback) Mantığı
- CLI subscription kotası dolduğunda (5 saatlik pencere veya haftalık tavan), agent **varsayılan olarak API anahtarı moduna geçer** (sağlayıcıların kendi "extra usage" mekanizmasıyla aynı mantık).
- Kullanıcı bunun yerine "kota sıfırlanana kadar bekle" seçeneğini de işaretleyebilir (Ayarlar > Agent > Bağlantı Modu).
- Her geçiş `cost_logs` tablosuna `connection_mode` alanıyla kaydedilir — kullanıcı ay sonunda "ne kadarı abonelik içinde, ne kadarı taşma API ücretiyle" çalıştığını görebilir.

### 9.5 Kullanıcı Ayarı
Her agent için Ayarlar panelinde üç seçenek: **"Sadece CLI Subscription"**, **"Sadece API"**, **"CLI öncelikli, kota dolunca API'ye geç"** (varsayılan — Bölüm 8'deki tablo bu varsayılana göre kuruludur).

### 9.6 ToS / Hukuki Uyum (Kritik)
CLI aboneliklerini (Claude Code, Codex CLI, Antigravity CLI) headless subprocess olarak otomatikleştirip bir **ürünü beslemek**, sağlayıcıların abonelik kullanım koşullarıyla **çelişebilir**. Bu, projenin temel maliyet tezini doğrudan etkileyen bir risktir ve net bir çerçeve gerektirir:
- **(a) Kişisel kullanım / "kendi aboneliğini getir" (BYO-subscription):** NEXCODE, kullanıcının **kendi** kişisel aboneliğini kendi makinesinde çalıştırır; abonelik kotasını üçüncü taraflara satmaz/paylaştırmaz. MVP ve kişisel kullanım bu çerçevede konumlanır.
- **(b) SaaS / ekip katmanı (Faz 4):** Ücretli, çok-kullanıcılı katman abonelik kotası üzerine **kurulamaz**; ticari API koşulları / kurumsal anlaşmalar (Azure OpenAI, Bedrock, doğrudan API ticari planları) kullanılmalıdır.
- **(c) İzleme:** Sağlayıcı ToS değişiklikleri takip edilmeli; bir sağlayıcı otomatik/headless kullanımı yasaklarsa ilgili agent varsayılan olarak API moduna sabitlenmelidir.

---

## 10. Agent Durum Makinesi

```
idle → thinking → coding → testing → reviewing → completed
                                 ↘ blocked ↗
```
- `idle`: Görev kuyruğunda iş yok.
- `thinking`: Görevi planlıyor.
- `coding`: Aktif dosya yazımı.
- `testing`: Test çalıştırıyor (QA tetiklemesi).
- `reviewing`: Gözden geçiriyor (Security için varsayılan durum).
- `blocked`: İnsan girdisi bekliyor.
- `completed`: Görev bitti, onay bekliyor veya onaylandı.

---

## 11. Workspace Özellikleri

- **Multi-agent grid**: 6 agent'ı kart halinde gösteren panel sistemi.
- **Task board**: Kanban görünümü (Backlog → In Progress → Review → Done).
- **Terminal erişimi**: Her agent için izole terminal görünümü.
- **File explorer**: Hangi agent'ın hangi dosyaya dokunduğunu gösteren etiket sistemi.
- **Live logs**: Agent bazlı, filtrelenebilir log akışı.
- **Git timeline**: Agent vs insan commit ayrımı.
- **Diff viewer**: Onay/red butonlarıyla entegre.
- **Memory inspector**: Agent'ın o anki bağlamını gösteren panel.
- **Cost dashboard**: Workspace/agent/**abonelik havuzu** bazında maliyet ve kota görünümü (Bölüm 9.3).

---

## 12. Güvenlik, Onay ve Yetkilendirme

- Yıkıcı eylemler listesi (Bölüm 6.8) kod seviyesinde sabittir.
- Her agent, `workspaceAccess` kapsamı dışına dosya yazamaz.
- API anahtarları OS keychain'de şifreli saklanır.
- Security Agent, Backend ve DevOps'un her çıktısını otomatik review eder.

---

## 13. Git Entegrasyonu

- Her agent görevi kendi **git worktree**'sinde çalışır (eşzamanlılık modeli için bkz. 6.2).
- Commit mesajları **Conventional Commits** formatına zorlanır, agent trailer'da belirtilir (`Agent: backend-agent`).
- Force-push, branch silme, `main`'e direkt push her zaman insan onayı gerektirir.

---

## 14. Veri Modeli (Taslak Şema)

```
workspaces(id, name, repo_path, created_at)
agents(id, workspace_id, role, model_provider, model_id, connection_mode, status, autonomy_level)
tasks(id, agent_id, title, status, priority, created_at, completed_at)
task_dependencies(task_id, depends_on_task_id)
approvals(id, task_id, action_type, status, requested_at, resolved_at, resolved_by)
memory_entries(id, workspace_id, agent_id, content, embedding, created_at)
git_events(id, workspace_id, agent_id, commit_hash, branch, message, is_human)
cost_logs(id, agent_id, task_id, provider, model_id, connection_mode, input_tokens, output_tokens, usd_cost, subscription_pool_id)
```

---

## 15. API / IPC Tasarım Prensipleri

- **Birincil sınır IPC'dir** (renderer ↔ main). Opsiyonel REST + WebSocket hibrit yalnızca çoklu-pencere/uzak istemci/bulut senaryolarında devreye girer (bkz. 5.3).
- Tüm uç noktalar **ve IPC kanalları** Zod şemasıyla doğrulanır.
- REST yüzeyi devredeyse versiyonlama: `/api/v1/...` (ayrı yerel Node süreci sunar — Next.js export route handler veremez, bkz. 5.1).
- Agent ve workspace başına ayrı rate limit.

---

## 16. Gerçek Zamanlı Güncelleme Akışı

- Main process ile renderer arasında IPC üzerinden delta güncellemeleri akar (çoklu-pencerede ayrıca WebSocket).
- Agent durumu **<150ms** içinde UI'da güncellenir.
- Birden fazla pencere açıksa, hepsi aynı kanalı dinler.

---

## 17. UI/UX Prensipleri

- Karanlık tema varsayılan.
- Her agent kartı tek bakışta durum + son eylem + maliyet + **bağlantı modu (CLI/API ikonu)** gösterir.
- Hiçbir yıkıcı eylem tek tıkla onaylanamaz.
- Klavye-öncelikli gezinme (`Cmd/Ctrl+K`).

---

## 18. Kodlama Standartları

- Strict TypeScript (`strict: true`, `noImplicitAny`, `noUncheckedIndexedAccess`).
- Feature-based klasör yapısı.
- Tekrarlanan mantık yasak — `/packages/core`.
- Kapsamlı structured (JSON) loglama.
- Birim testleri zorunlu (Vitest); orkestrasyon mantığı için %90+ coverage hedefi.
- Her PR'da bağımlılık taraması + secret-leak taraması CI'da otomatik.
- Conventional Commits.

---

## 19. Test Stratejisi

- **Birim testler**: Orkestrasyon mantığı, provider/CLI adapter'ları, approval gate kuralları.
- **Entegrasyon testleri**: Agent → Task Queue → Provider Adapter → Mock AI yanıtı.
- **E2E testler** (Playwright, Electron modu): Workspace açma → görev → onay → commit.
- **Provider/CLI sözleşme testleri**: Her adapter, kayıtlı yanıtlara karşı test edilir — CLI adapter'lar için ayrıca subprocess çıktı formatı değişikliklerini erken yakalama testi (bkz. 6.3 parser kırılganlığı).

---

## 20. Performans ve Ölçeklenebilirlik Hedefleri

- Tek workspace'te 6 agent eşzamanlı, UI donmadan (60fps grid render).
- Agent durum güncellemesi **<150ms**.
- SQLite → (opsiyonel) PostgreSQL senkron, 10.000 görev kaydında **<2 saniye**.
- Vektör arama (yerel `sqlite-vec`/pgvector), 100K embedding'de **<300ms**.

---

## 21. Paketleme & Dağıtım

| Platform | Paket Formatı | Dağıtım Kanalı |
|---|---|---|
| Windows | MSI + NSIS installer, code-signed | Doğrudan indirme + (ileride) Microsoft Store |
| macOS | `.dmg`, notarized + code-signed | Doğrudan indirme + (ileride) Mac App Store |

- Auto-update: sessiz arka plan güncelleme.

---

## 22. Telemetri & Gözlemlenebilirlik

- OpenTelemetry tabanlı, opt-in, anonimleştirilmiş kullanım metrikleri.
- Hiçbir kod içeriği veya prompt metni telemetriye dahil edilmez.
- Hata raporlama kullanıcı onayıyla.

---

## 23. Yol Haritası (Fazlar — Teslimatlar ve Çıkış Kriterleri)

Her faz, **somut teslimatları** ve bir sonrakine geçiş için **çıkış kriterleri** ile tanımlanır. Fazlar kümülatiftir.

### Faz 0 — Temel & İskelet
**Amaç:** Çalışan boş kabuk.
- **Teslimatlar:** Electron + Next.js (statik export) + strict TS monorepo (`/packages/core` dahil); IPC köprüsü; SQLite şeması (Bölüm 14); OS keychain anahtar saklama; temel karanlık-tema kabuğu; CI (lint + test + secret/dependency tarama).
- **Çıkış kriteri:** Uygulama Windows'ta açılıyor; bir workspace oluşturulup SQLite'a yazılıyor; CI yeşil.

### Faz 1 — Çekirdek (MVP)
**Amaç:** Üç agent ile uçtan uca tek bir görev döngüsü.
- **Teslimatlar:** Tek workspace; **CEO + Frontend + Backend** agent'ları; Anthropic **API** entegrasyonu (tek sağlayıcı); manuel onay akışı (Approval Gate, Bölüm 6.8); in-process görev kuyruğu (5.3); temel git worktree + commit; diff viewer (onay/red); Windows masaüstü paketi.
- **Çıkış kriteri:** Kullanıcı bir istek girip CEO'nun ürettiği planı onaylayabiliyor; Backend bir dosya üretip diff'i insan onayıyla commit'leyebiliyor; **hiçbir yıkıcı eylem onaysız gerçekleşmiyor** (Bölüm 24 sıfır-tolerans).

### Faz 2 — Tam Ekip, Çoklu Sağlayıcı & CLI Entegrasyonu
**Amaç:** Altı agent ve provider-agnostic gateway.
- **Teslimatlar:** 6 agent'ın tamamı (Security, QA 3-kademeli eskalasyon, DevOps); AI Gateway çoklu sağlayıcı (`AIProviderAdapter`); **CLI adapter'ları** (Claude Code, Codex CLI, Antigravity CLI) + **API/CLI otomatik geçiş** (9.4) + ToS güvenli varsayılanları (9.6); task board (Kanban); inter-agent message bus (6.7); merge-time conflict resolver (6.2); macOS paketleme (notarized).
- **Çıkış kriteri:** Bir Backend PR'ı otomatik Security review'a düşüyor; QA event-driven tetikleniyor; CLI kotası dolunca agent API'ye geçiyor ve `cost_logs`'a kaydediliyor; provider sözleşme testleri yeşil.

### Faz 3 — Görsel Zenginlik & Bellek
**Amaç:** Gözlemlenebilirlik ve uzun-süreli bellek.
- **Teslimatlar:** Multi-agent grid (60fps); memory inspector; **yerel** vektör tabanlı uzun-süreli bellek (`sqlite-vec`/gömülü pgvector, RAG); abonelik-havuzu bazlı **cost dashboard** (9.3); live logs; git timeline; checkpoint geri-alma (Prensip 10).
- **Çıkış kriteri:** Cost dashboard CLI-abonelik tasarrufunu somut gösteriyor (Bölüm 24); 100K embedding'de vektör arama <300ms; bir agent değişikliği tek tıkla geri alınabiliyor.

### Faz 4 — Genişleme (Bulut/Ekip)
**Amaç:** Çok-kullanıcılı katman.
- **Teslimatlar:** Agent Marketplace; Cloud Sync (opsiyonel PostgreSQL + bulut pgvector); Team Collaboration (auth burada devreye girer — Clerk/JWT, 5.7); Autonomous Project Mode; opsiyonel dağıtık kuyruk (BullMQ/Redis). **Ticari API koşullarına dayalı** maliyet modeli (9.6-b).
- **Çıkış kriteri:** İki kullanıcı aynı workspace'i senkron görebiliyor; ücretli katman abonelik kotasına değil ticari API'ye dayanıyor.

---

## 24. Başarı Kriterleri

NEXCODE başarılı sayılır eğer:
- Tek bir geliştirici, 6 agent'lık bir ekibi etkili şekilde yönetebiliyor ve gerçek bir projeyi geleneksel tek-agent araçlarından **gözle görülür biçimde daha hızlı** tamamlayabiliyorsa.
- Hiçbir yıkıcı eylem insan onayı olmadan gerçekleşmiyorsa (sıfır tolerans).
- Yeni bir AI sağlayıcısı saatler içinde entegre edilebiliyorsa.
- CLI subscription modunda çalışan agent'larda (CEO, Backend, Frontend) aylık maliyetin, aynı hacmi saf API faturalandırmasıyla çalıştırmaya kıyasla **belirgin şekilde daha düşük** olduğu cost dashboard'da somut olarak gösterilebiliyorsa.
- QA Agent'ın 3 kademeli eskalasyon mantığı, basit görevlerin %80+'ını en ucuz kademede (DeepSeek) çözebiliyorsa.

---

## 25. Açık Kararlar (Ali'nin Netleştirmesi Gerekenler)

- CEO + Backend için tek bir Claude Code Max 20x aboneliği mi alınacak (paylaşılan kota + throughput tavanı riskiyle), yoksa ikisi için ayrı abonelik mi (daha pahalı ama izole)? (Bkz. 9.3, 26.)
- DevOps Agent'ın "dry-run" sonucu insana sunulurken hangi format kullanılacak (özet mi, tam log mu)?
- Antigravity CLI'a geçiş netleştiğinde DevOps Agent'ın bağlantısı buna mı taşınacak, yoksa doğrudan Google AI Studio API anahtarında mı kalınacak?
- Ekip/Cloud Sync katmanı için fiyatlandırma modeli (kullanıcı bazlı mı, workspace bazlı mı, token-pass-through mu?).
- **CLI subscription otomasyonunun ToS uyumu** (9.6): kişisel BYO-subscription çerçevesi yeterli mi, yoksa Anthropic/OpenAI/Google ile hangi noktada resmi izin/ticari anlaşma gerekiyor?

---

## 26. Riskler ve Azaltımlar (Risk Register)

| # | Risk | Etki | Azaltım |
|---|---|---|---|
| R1 | **CLI abonelik otomasyonu ToS ihlali** (özellikle ücretli SaaS) — temel maliyet tezini tehdit eder | Yüksek | Kişisel BYO-subscription çerçevesi (9.6-a); SaaS katmanı ticari API'ye dayanır (9.6-b); sağlayıcı politikası izlenir (9.6-c) |
| R2 | **Paylaşılan Claude havuzu throughput tavanı** — "3-5x paralel" iddiasını zayıflatır | Orta | Ayrı abonelik seçeneği / zamanlama-farkında throttling / API'ye taşma (9.3, 9.4) |
| R3 | **CLI parser kırılganlığı** — sağlayıcı CLI güncellemesi adapter'ı sessizce bozar | Orta | Sürüm sabitleme + sözleşme testleri + parse hatasında API moduna zarif geçiş (6.3) |
| R4 | **Model isimlerinin spekülatif olması** — uygulama anında mevcut olmayabilir | Düşük-Orta | Provider-agnostic adapter; konfigürasyonla değiştirilebilir; uygulama anı doğrulaması (üstteki uyarı) |
| R5 | **Native build/dağıtım karmaşıklığı** (node-pty, better-sqlite3, code-sign, notarize) | Orta | Faz 0'da CI matris build; erken paketleme dumanı testleri |
| R6 | **"Editör değil" sınırının aşınması** (Monaco/xterm scope creep) | Düşük | Kapsam kuralı: yalnızca diff/önizleme + gözlem; tam editör özelliği eklenmez |

---
