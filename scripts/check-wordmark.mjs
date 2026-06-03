// SPDX-License-Identifier: Apache-2.0
//
// One wordmark across every surface. The docs topbar and the landing render the
// canonical lockup from tutorials/src/components/Wordmark.astro; the static Lab
// is hand-written HTML and can't import an Astro component, so it COPIES the same
// markup. This gate pins that copy: both surfaces must carry
//   <b class="flat">Flat</b>Bars  …  <span class="suffix">…</span>
// (the `.flat` span is the accent "Flat", the mono-caps `.suffix` is the slot —
// DOCS / LAB). Run as `npm run check:wordmark` (wired into `npm test`).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const SURFACES = {
  "tutorials/src/components/Wordmark.astro": "the canonical wordmark component",
  "lab/index.html": "the static Lab copy",
};
const FLAT = '<b class="flat">Flat</b>Bars';
const SUFFIX = '<span class="suffix">';

let fails = 0;
for (const [file, what] of Object.entries(SURFACES)) {
  const html = read(file);
  const fi = html.indexOf(FLAT);
  if (fi < 0) {
    fails++;
    console.error(`✗ ${file} (${what}) — missing the \`${FLAT}\` lockup`);
    continue;
  }
  const si = html.indexOf(SUFFIX, fi);
  // The `.suffix` slot must follow the wordmark immediately (only whitespace or an
  // Astro `{suffix && …}` conditional may sit between).
  if (si < 0 || si - (fi + FLAT.length) > 32) {
    fails++;
    console.error(`✗ ${file} (${what}) — the \`.suffix\` slot is missing or not adjacent to the wordmark`);
  }
}

if (fails) {
  console.error(`\ncheck:wordmark: ${fails} surface(s) diverge from the canonical lockup.`);
  process.exit(1);
}
console.log(`✓ check:wordmark — ${Object.keys(SURFACES).length} surfaces share the FlatBars wordmark lockup`);
