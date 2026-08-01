# Katkı Rehberi

## Kurulum

```bash
pnpm install
pnpm -r build      # core önce derlenmeli, uygulamalar ona bağlı
pnpm dev
```

## Her PR'dan önce

```bash
pnpm typecheck     # sıfır hata
pnpm lint
pnpm test
```

CI ayrıca em dash taraması, bağımlılık denetimi ve secret-leak taraması çalıştırır.

## Kodlama standartları

- **Strict TypeScript.** `strict`, `noImplicitAny`, `noUncheckedIndexedAccess` açıktır.
  `any` yasaktır; JSON sınırlarında `JsonValue` kullanın.
- **Saf çekirdek, enjekte port.** `packages/core` içindeki mantık süreç, dosya sistemi ve
  veritabanına doğrudan dokunmaz. Bunlar arayüzlerden gelir, böylece her akış sahte
  agent'larla test edilebilir. Yeni bir yetenek eklerken önce port'u tanımlayın.
- **Paket sınırlarına uyun.** `node:*` bağımlılığı olan bir modül saf `@nexcode/core`
  index'ine eklenemez; renderer derlemesini kırar. Uygun alt yolu kullanın:
  `@nexcode/core/db`, `/providers` ya da `/mcp`.
- **Em dash kullanmayın.** Yerine iki nokta, noktalı virgül veya parantez.
- **Yorumlar niçin'i anlatsın.** Ne yaptığını kod zaten söylüyor; yorum, o satırın neden
  böyle olduğunu ve hangi tuzaktan kaçındığını anlatmalı.

## Test

- Orkestrasyon mantığı için birim testi zorunludur.
- Motor davranışı sahte agent süreçleriyle uçtan uca sınanır; örnek için
  `packages/core/src/engine/engine.test.ts` ve `engine-verify.test.ts` dosyalarına bakın.
- Bir davranış sözleşmeyse (ör. "kırmızı kapı hızlı yolu kapatır") onu doğrulayan bir test
  olmalıdır. Sözleşme değişirse test de değişmelidir.

## Commit

Conventional Commits kullanılır:

```
feat(engine): add verification gate
fix(db): correct Dirent typing in checkpoint walker
docs: rewrite architecture invariants
```

## Değişmezleri değiştirmek

`docs/ARCHITECTURE.md` sistemin sözleşmelerini listeler. Bunlardan birini değiştiriyorsanız
aynı PR'da belgeyi de güncelleyin ve nedenini commit gövdesinde açıklayın. Belge ile kod
çeliştiğinde kod doğrudur; bu yüzden ikisini birlikte taşımak önemlidir.
