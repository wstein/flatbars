// SPDX-License-Identifier: Apache-2.0
//
// One theme contract across the whole umbrella. The anti-flash seed (it sets
// html[data-theme] from the single `flatbars-theme` key before first paint) must
// be byte-identical wherever it is inlined, so a reader's light/dark choice
// persists across the tutorials app, the Starlight spec and the static Lab. This
// gate pins that every inline copy matches the canonical seed documented in
// shared/theme-seed.js. Modelled on check:topbar; run via `npm run check:theme-seed`.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

// Collapse all whitespace runs so cosmetic indentation differences (an Astro
// `is:inline` block vs a literal <script>) don't trip the comparison.
const norm = (s) => s.replace(/\s+/g, " ").trim();

// The canonical IIFE, normalised. This is the body documented in theme-seed.js
// and inlined in each <head>.
const CANON = norm(`(function () {
  try {
    var k = "flatbars-theme";
    var t = localStorage.getItem(k);
    if (t !== "light" && t !== "dark") {
      t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();`);

// Surfaces that inline the seed. (The Lab and spec join as they migrate.)
const SURFACES = {
  "shared/theme-seed.js": "the canonical seed (documented inline form)",
  "tutorials/src/components/BaseHead.astro": "the tutorials <head>",
};

// In theme-seed.js the canonical form lives in a doc comment, so strip the
// leading `//` line markers before comparing; the inlined copies are real code.
const decomment = (s) => s.replace(/^[ \t]*\/\/ ?/gm, "");

let fails = 0;
for (const [file, what] of Object.entries(SURFACES)) {
  const body = file.endsWith("theme-seed.js") ? decomment(read(file)) : read(file);
  if (!norm(body).includes(CANON)) {
    fails++;
    console.error(`✗ ${file} (${what}) — anti-flash seed diverges from the canonical form`);
  }
}

if (fails) {
  console.error(`\ncheck:theme-seed: ${fails} copy(ies) of the anti-flash seed have drifted.`);
  process.exit(1);
}
console.log(`✓ check:theme-seed — ${Object.keys(SURFACES).length} surfaces share the single-key anti-flash seed`);
