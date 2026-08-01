import { createContext } from "../context";

/**
 * Otonom çalışma onayı.
 *
 * Motor bu onay olmadan başlatılamaz. Masaüstü uygulamasında onay penceresiyle alınır;
 * panelsiz kullanımda kullanıcının açıkça bu komutu çalıştırması gerekir. Onay bir kez
 * verilir ve yapılandırmada zaman damgasıyla saklanır.
 */

const NOTICE = `
Otonom çalışma onayı
====================

NEXCODE motoru, kurulu kodlama CLI'larını SENİN adına ve SENİN yetkilerinle çalıştırır.
Kabul ettiğinde motor şunları yapabilir:

  - Çalışma klasöründeki dosyaları okur, oluşturur, değiştirir ve siler
  - Kurulu CLI'ları kendi oturumunla ve kotanla çağırır
  - Tanımladığın doğrulama komutlarını (test, lint, derleme) çalıştırır
  - Etkinse görev başına git worktree ve branch açar, o branch'e commit atar

Motorun KENDİLİĞİNDEN yapmadıkları:

  - Uzağa hiçbir şey göndermez (push, PR yok)
  - Riskli plan, approvalMode "ask" iken senin onayını bekler
  - Her görev öncesi checkpoint alır; geri alma tek komuttur

Kabul etmek için:  nexcode consent --accept
Geri almak için :  nexcode consent --revoke
`;

export function runConsentCommand(flags: Record<string, string | boolean>): number {
  const ctx = createContext();
  const config = ctx.configRepo.load();

  if (flags.revoke === true) {
    ctx.configRepo.save({ ...config, autonomousConsentAcceptedAt: null });
    process.stdout.write("Otonom çalışma onayı geri alındı. Motor artık başlatılamaz.\n");
    return 0;
  }

  if (flags.accept === true) {
    const acceptedAt = new Date().toISOString();
    ctx.configRepo.save({ ...config, autonomousConsentAcceptedAt: acceptedAt });
    process.stdout.write(`Otonom çalışma onaylandı (${acceptedAt}).\n\nBaşlatmak için: nexcode run\n`);
    return 0;
  }

  process.stdout.write(NOTICE);
  if (config.autonomousConsentAcceptedAt !== null) {
    process.stdout.write(`\nDurum: onaylı (${config.autonomousConsentAcceptedAt})\n`);
    return 0;
  }

  process.stdout.write("\nDurum: onaylanmadı\n");
  // Onaysız durum bir hata değil, bir gerekliliktir; script'ler bunu ayırt edebilsin diye 1.
  return 1;
}
