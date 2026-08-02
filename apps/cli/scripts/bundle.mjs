import { build } from "esbuild";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bundles the CLI into a single file.
 *
 * Why bundle: `@nexcode/core` is a scoped name and nobody outside that npm organisation
 * can publish it. Embedding the core inside the CLI leaves a **single, unscoped** package
 * to publish: `nexcode`. When a user runs `npm install -g nexcode` they do not depend on a
 * second package, on version matching, or on scope ownership.
 *
 * `better-sqlite3` is left external: it is a locally compiled native module, it cannot be
 * bundled, and it has to produce its own binary at install time.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outfile = path.join(root, "dist", "cli.js");

// The output folder is reset every time so files left over from earlier builds
// (type declarations, test output) do not leak into the tarball.
rmSync(path.join(root, "dist"), { recursive: true, force: true });

await build({
  entryPoints: [path.join(root, "src", "cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // The native module and its optional dependencies stay out of the resolution step.
  external: ["better-sqlite3", "@napi-rs/keyring", "electron"],
  // No banner is added: `src/cli.ts` already carries a shebang and esbuild preserves it.
  // Adding a second one leaves an invalid `#!` on line two and the file will not run.
  legalComments: "none",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

// The entry file has to stay directly executable so the `require.main === module` check
// still works after bundling.
chmodSync(outfile, 0o755);

const bytes = readFileSync(outfile).byteLength;
console.log(`bundle: dist/cli.js (${String(Math.round(bytes / 1024))} KB)`);

// The only runtime dependency of the published package is the native module; everything
// else is inside the bundle and is not downloaded at install time.
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.dependencies?.["@nexcode/core"] !== undefined) {
  console.warn("WARNING: package.json still carries an @nexcode/core dependency.");
}
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
