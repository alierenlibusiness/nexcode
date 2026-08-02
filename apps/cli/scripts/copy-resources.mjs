import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the shared `resources/` folder into the CLI package.
 *
 * The published tarball has to be self contained: `npx nexcode` cannot run without the
 * role prompts, the skill catalogue and the default configuration. The same path is used
 * when running from the repository, so development and release behaviour do not diverge.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..", "..", "..", "resources");
const target = path.resolve(here, "..", "resources");

if (!existsSync(source)) {
  console.error(`Source folder not found: ${source}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`resources copied: ${target}`);

// The license text is taken into the tarball from the package folder; the root LICENSE is
// not included automatically.
const license = path.resolve(here, "..", "..", "..", "LICENSE");
if (existsSync(license)) {
  cpSync(license, path.resolve(here, "..", "LICENSE"));
  console.log("LICENSE copied");
}
