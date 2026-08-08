/**
 * Run a TypeScript script inside this repo with `@/*` -> `src/*` path aliases.
 *
 * Uses `jiti` (already installed as a Next.js dependency), so no new packages
 * or build step are required.
 *
 * Usage:  node scripts/run-ts.mjs <path-to-ts-file>
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/run-ts.mjs <path-to-ts-file>");
  process.exit(1);
}

const jiti = createJiti(fileURLToPath(new URL("../package.json", import.meta.url)), {
  alias: { "@": path.join(root, "src") },
});

jiti(path.resolve(target));
