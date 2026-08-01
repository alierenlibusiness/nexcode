import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Paylaşılan `resources/` klasörünü CLI paketinin içine kopyalar.
 *
 * Yayımlanan tarball kendi kendine yeterli olmalıdır: rol promptları, beceri kataloğu ve
 * varsayılan yapılandırma olmadan `npx nexcode` çalışamaz. Depo içinde çalışırken de aynı
 * yol kullanıldığı için geliştirme ve yayın davranışı ayrışmaz.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..", "..", "..", "resources");
const target = path.resolve(here, "..", "resources");

if (!existsSync(source)) {
  console.error(`Kaynak klasör bulunamadı: ${source}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`resources kopyalandi: ${target}`);

// Lisans metni tarball'a paket klasöründen alınır; kök LICENSE otomatik dahil edilmez.
const license = path.resolve(here, "..", "..", "..", "LICENSE");
if (existsSync(license)) {
  cpSync(license, path.resolve(here, "..", "LICENSE"));
  console.log("LICENSE kopyalandi");
}
