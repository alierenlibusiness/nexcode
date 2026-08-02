import { build } from "esbuild";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CLI'ı tek dosyaya bundle eder.
 *
 * Neden bundle: `@nexcode/core` scope'lu bir addır ve o npm organizasyonuna sahip olmayan
 * biri onu yayımlayamaz. Çekirdeği CLI'ın içine gömerek yayımlanacak **tek, scope'suz**
 * paket kalır: `nexcode`. Kullanıcı `npm install -g nexcode` yazdığında ikinci bir paketin
 * varlığına, sürüm eşleşmesine ya da scope sahipliğine bağımlı olmaz.
 *
 * `better-sqlite3` dışarıda bırakılır: yerel derlenen bir native modüldür, bundle edilemez
 * ve kurulumda kendi ikilisini üretmesi gerekir.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outfile = path.join(root, "dist", "cli.js");

// Önceki derlemelerden kalan dosyalar (tip bildirimleri, test çıktıları) tarball'a
// sızmasın diye çıktı klasörü her seferinde sıfırlanır.
rmSync(path.join(root, "dist"), { recursive: true, force: true });

await build({
  entryPoints: [path.join(root, "src", "cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // Native modül ve onun isteğe bağlı bağımlılıkları çözümleme aşamasında dışarıda kalır.
  external: ["better-sqlite3", "@napi-rs/keyring", "electron"],
  // Banner eklenmez: `src/cli.ts` zaten shebang taşıyor ve esbuild onu koruyor.
  // İkincisini eklemek ikinci satıra geçersiz bir `#!` bırakır ve dosya çalışmaz.
  legalComments: "none",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

// `require.main === module` kontrolü bundle sonrası da doğru çalışsın diye giriş dosyası
// doğrudan çalıştırılabilir olmalıdır.
chmodSync(outfile, 0o755);

const bytes = readFileSync(outfile).byteLength;
console.log(`bundle: dist/cli.js (${String(Math.round(bytes / 1024))} KB)`);

// Yayımlanan pakette çalışma zamanı bağımlılığı yalnızca native modüldür; geri kalanı
// bundle içinde olduğundan kurulum sırasında indirilmez.
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.dependencies?.["@nexcode/core"] !== undefined) {
  console.warn("UYARI: package.json hala @nexcode/core bagimliligi tasiyor.");
}
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
