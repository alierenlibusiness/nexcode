# NEXCODE: Çoklu Agent & CLI Entegrasyon Kılavuzu

Bu kılavuz, NEXCODE IDE üzerinde yer alan çoklu ajan (multi-agent) orkestrasyon mekanizmasını nasıl kullanacağınızı ve terminal tabanlı CLI araçlarını (`claude-code`, `codex`, `antigravity`) sisteme nasıl bağlayacağınızı adım adım açıklamaktadır.

---

## 1. Çoklu Agent (Multi-Agent) Yapısı Nedir?

NEXCODE, karmaşık yazılım geliştirme süreçlerini alt görevlere bölerek her görevi o alanda uzmanlaşmış farklı yapay zeka ajanlarına atayan **Rol Tabanlı bir Çoklu Agent İşbirliği** sistemidir.

### Ajan Rolleri ve Sorumlulukları
1. **CEO (Orkestratör/Planlayıcı)**: Yazdığınız ana isteği analiz eder, adımlara böler ve bir görev grafiği (Kanban Backlog) oluşturur. Kod yazmaz, sadece işi yönetir.
2. **Frontend Ajanı (FE)**: Kullanıcı arayüzü (UI) bileşenlerini tasarlar, durum (state) yönetimini yapar, CSS/Tailwind stillerini düzenler.
3. **Backend Ajanı (BE)**: Sunucu taraflı API rotalarını yazar, veritabanı şemalarını ve migration dosyalarını hazırlar, iş mantığını entegre eder.
4. **Security Ajanı (SEC)**: Yazılan kodları güvenlik açıklarına, sızdırılmış gizli anahtarlara (secrets) ve riskli bağımlılıklara karşı denetler. Otonom olarak çalışır.
5. **QA Ajanı (Test)**: Geliştirilen özellikler için otomatik birim (unit) ve entegrasyon testleri hazırlar. Hataları tespit etmek için çok kademeli eskalasyon uygular.
6. **DevOps Ajanı (OPS)**: CI/CD yapılandırmasını kurar, derleme (build) süreçlerini kontrol eder ve dağıtım (deployment) aşamalarını dry-run denetimleriyle yürütür.

---

## 2. CLI Modu ve API Modu Farkı Nedir?

Ajanların yapay zeka modelleriyle konuşabilmesi için iki farklı bağlantı yöntemi bulunur:

| Yöntem | Nasıl Çalışır? | Avantajı | Kurulum Gereksinimi |
| :--- | :--- | :--- | :--- |
| **API Modu** | Doğrudan API Key kullanarak istek atar. | Ekstra kurulum gerektirmez, hızlı yanıt verir. | **Bağlantı Ayarları** sekmesinden API Key girilmelidir. |
| **CLI Modu** | Bilgisayarınızda kurulu olan resmi CLI araçlarını çalıştırır. | Abonelik sınırlarınız dahilinde token ücreti ödemeden çalışır. | Terminalden ilgili CLI aracının kurulması ve giriş yapılması gerekir. |

---

## 3. CLI Araçları Sisteme Nasıl Bağlanır?

Her sağlayıcının CLI aracı bilgisayarınızda kurulmalı ve yetkilendirilmelidir. NEXCODE, bu CLI araçlarını arka planda otomatik olarak tespit edip çalıştırır.

### A. Anthropic CLI (Claude Code - `claude`)
Anthropic'in resmi terminal asistanıdır. Ajanlar sekmesinden "CLI" modunu seçtiğinizde kullanılır.
1. **Kurulum**: Terminali açıp aşağıdaki npm komutunu çalıştırın:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. **Giriş Yapma**: Kurulum tamamlandıktan sonra terminale şu komutu yazın ve tarayıcı üzerinden giriş yapın:
   ```bash
   claude login
   ```
3. **Doğrulama**: NEXCODE programını başlatın. Üst barda yer alan `CLI Tools` sayacında veya *Bağlantı Ayarları* sekmesindeki **Anthropic (Claude)** kartında "CLI AKTİF" rozetinin yandığından emin olun.

### B. OpenAI CLI (Codex - `codex`)
OpenAI modellerini terminal üzerinden çalıştırmak için kullanılır.
1. **Kurulum**:
   ```bash
   npm install -g @openai/codex-cli
   ```
2. **Giriş Yapma**:
   ```bash
   codex login
   ```

### C. Google CLI (Antigravity - `antigravity`)
Gemini modellerini terminal üzerinden çalıştırmak için kullanılır.
1. **Kurulum**:
   ```bash
   npm install -g @google/antigravity-cli
   ```
2. **Giriş Yapma**:
   ```bash
   antigravity auth login
   ```

---

## 4. Çoklu Ajan İş Akışı Nasıl Kullanılır? (Adım Adım)

1. **Projeyi Açın**: Dosya Gezgini üstündeki **"Klasör Aç..."** butonuna tıklayarak üzerinde çalışmak istediğiniz kod deposunu seçin.
2. **Hedef Modeli Seçin**: **Ajanlar (Agents)** sekmesine gidin. Her ajan için hangi modeli (örn. *Claude Sonnet 4.6*, *GPT-5.5*, *Gemini 3.5 Flash*) ve hangi bağlantı modunu (*API* veya *CLI*) kullanacağınızı seçin.
3. **API Anahtarlarını Girin**: Eğer API modunu kullanacaksanız, **Bağlantı Ayarları** sekmesinden ilgili sağlayıcılar için API anahtarlarını kaydedin.
4. **İstek Gönderin**: **Sohbet** sekmesine geçin ve yapmak istediğiniz işi yazın.
   * *Örnek*: `"Kullanıcıların e-posta ile kayıt olabileceği bir üyelik yapısı ekle."`
   * *Görsel Destek*: Editördeki bir ekran görüntüsünü veya arayüz çizimini doğrudan sohbet alanına sürükleyip bırakarak (Drag & Drop) gönderebilirsiniz.
5. **CEO Planını İnceleyin**: CEO isteğinizi inceler ve yapılması gereken işleri Kanban görev havuzuna (**Hazır Görevler**) ekler.
6. **Görevleri Dağıtın (Dispatch)**: Hazır Görevler listesindeki görevlerin yanındaki **"▶"** butonuna tıklayarak ilgili ajanı (Frontend veya Backend) işe başlatın. Ajan kod değişikliklerini hazırlayacaktır.
7. **Onaylama ve Canlıya Alma**: Ajanların yaptığı kritik değişiklikler (dosya yazma/silme, kod güncellemeleri) chat ekranında **"Onay Bekleyen Eylemler"** listesine düşer. Değişiklikleri inceleyip **"Onayla"** butonuna bastığınızda işlemler otomatik olarak dosya sisteminize yansıtılır.
