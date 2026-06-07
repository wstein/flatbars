// SPDX-License-Identifier: Apache-2.0
//
// check:favicon — one favicon across the whole umbrella. The artwork lives in
// exactly one place, `shared/flatbars-favicon.svg`, and every surface derives from
// it so the browser-tab mark can't drift between Home, Tutorials, Spec, and Lab:
//
//   • tutorials + spec — copied to public/favicon.svg by each app's `favicon`
//     prebuild hook (gitignored build output, regenerated every dev/build, so it
//     cannot drift — nothing to gate).
//   • lab — a static site with no build step, so it carries a COMMITTED vendored
//     copy, lab/favicon.svg, exactly like the engine bundle and the topbar element.
//     That copy is the only one that can rot, so this gate pins it byte-identical
//     to the source. Regenerate with `npm run gen:favicon`.
//
//   node scripts/check-favicon.mjs

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const SOURCE = "shared/flatbars-favicon.svg";
// Committed copies that must match the source verbatim (regen: gen:favicon).
const VENDORED = { "lab/favicon.svg": "the static Lab" };

let fails = 0;
const src = read(SOURCE);
for (const [copy, what] of Object.entries(VENDORED)) {
  let got = null;
  try {
    got = read(copy);
  } catch {
    fails++;
    console.error(`✗ ${copy} (${what}) — missing (run \`npm run gen:favicon\`)`);
    continue;
  }
  if (got !== src) {
    fails++;
    console.error(`✗ ${copy} (${what}) — stale vs ${SOURCE} (run \`npm run gen:favicon\`)`);
  }
}

if (fails) {
  console.error(`\ncheck:favicon: ${fails} favicon copy/copies diverge from ${SOURCE}.`);
  process.exit(1);
}
console.log(`✓ check:favicon — ${Object.keys(VENDORED).length + 2} surfaces share the one ${SOURCE} (tutorials/spec regenerate it at build)`);
