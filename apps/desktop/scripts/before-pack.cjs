// electron-builder beforePack hook.
//
// Sorun: @napi-rs/keyring'in native binary'si ayrı bir platform paketindedir
// (@napi-rs/keyring-<platform>) ve pnpm + electron-builder bu optional platform paketini
// asar'a almıyor. @napi-rs/keyring/index.js ise önce KENDİ dizinindeki yerel
// `keyring.<platform>.node` dosyasına bakar (platform paketine düşmeden önce).
//
// Bu hook, kurulu platform .node'unu @napi-rs/keyring paket dizinine kopyalar; böylece
// (zaten asar'a giren) ana paketle birlikte bundle'lanır ve packaged app'te keychain çalışır.
const fs = require("node:fs");
const path = require("node:path");

/** Bir dizin ağacında verilen önekle başlayan .node dosyalarını bulur (sığ, hızlı). */
function findNodeBinaries(dir, prefix, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findNodeBinaries(full, prefix, out);
    else if (entry.name.startsWith(prefix) && entry.name.endsWith(".node")) out.push(full);
  }
}

module.exports = async function beforePack(context) {
  const projectDir = context.packager.projectDir; // apps/desktop
  let keyringDir;
  try {
    keyringDir = path.dirname(
      require.resolve("@napi-rs/keyring/package.json", { paths: [projectDir] }),
    );
  } catch {
    console.warn("[before-pack] @napi-rs/keyring bulunamadı, atlanıyor.");
    return;
  }

  const pnpmDir = path.join(projectDir, "..", "..", "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) {
    console.warn("[before-pack] node_modules/.pnpm yok, atlanıyor.");
    return;
  }

  const binaries = [];
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (entry.startsWith("@napi-rs+keyring-")) {
      findNodeBinaries(path.join(pnpmDir, entry), "keyring.", binaries);
    }
  }

  let copied = 0;
  for (const bin of binaries) {
    const dest = path.join(keyringDir, path.basename(bin));
    fs.copyFileSync(bin, dest);
    console.log(`[before-pack] kopyalandı: ${path.basename(bin)} → @napi-rs/keyring/`);
    copied++;
  }
  if (copied === 0) console.warn("[before-pack] keyring platform .node bulunamadı.");
};
