// SPDX-License-Identifier: Apache-2.0
//
// check:fonts — one web-font stylesheet URL across the umbrella. The canonical
// URL (which IBM Plex weights load) lives in shared/fonts.mjs; the Astro apps
// import it (tutorials' BaseHead, the spec's Starlight `head`) so they can't
// drift, and the static Lab hard-codes the same string. This gate pins every
// surface to the one URL — the apps used to load different weight lists.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_CSS_HREF } from "../shared/fonts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const SURFACES = {
  "lab/index.html": "the static Lab (hard-coded copy)",
  // The Astro apps import FONT_CSS_HREF, but pin the reference so it can't be
  // swapped for an inline literal without the gate noticing.
  "tutorials/src/components/BaseHead.astro": "the tutorials <head>",
  "spec/astro.config.mjs": "the Starlight spec head config",
};
const REF = "FONT_CSS_HREF";

let fails = 0;
for (const [file, what] of Object.entries(SURFACES)) {
  const src = read(file);
  const ok = src.includes(FONT_CSS_HREF) || src.includes(REF);
  if (!ok) {
    fails++;
    console.error(`✗ ${file} (${what}) — does not use the canonical font URL (shared/fonts.mjs)`);
  }
  // Belt and braces: no OTHER googleapis font URL should appear (a drifted copy).
  const others = (src.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"' ]+/g) || []).filter(
    (u) => u !== FONT_CSS_HREF,
  );
  if (others.length) {
    fails++;
    console.error(`✗ ${file} — a divergent font URL is present:\n      ${others.join("\n      ")}`);
  }
}

if (fails) {
  console.error(`\ncheck:fonts: ${fails} surface(s) diverge from the single font URL.`);
  process.exit(1);
}
console.log(`✓ check:fonts — ${Object.keys(SURFACES).length} surfaces share one IBM Plex stylesheet URL`);
