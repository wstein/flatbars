// SPDX-License-Identifier: Apache-2.0
//
// check:no-raw-colors — enforce the single source of truth for theming. The
// design-system colour VALUES live in exactly two canonical files
// (`shared/flatbars-chrome.css`, `shared/flatbars-tokens.css`) and reach the apps
// only through generated `@chrome`/`@palette` fences or `customCss` copies. Every
// other surface must read those tokens — never hard-code a colour — so the four
// front ends can't drift.
//
// This gate scans the design-system files for raw colour literals (hex) OUTSIDE
// the canonical sources and the generated fences. Pure black/white (constants,
// not theme colours) are allowed. Anything else counts against a per-file BUDGET:
// a RATCHET — the clean files are pinned at 0 and can never regress; the files
// still carrying legacy colours have a frozen budget that may only shrink as the
// colours are tokenised (lower the number when you do). A file UNDER budget is a
// reminder to tighten it.
//
//   node scripts/check-no-raw-colors.mjs

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

// Generated regions (filled from the shared sources by gen:tokens) are exempt.
const stripFences = (s) =>
  s.replace(/\/\* @(chrome|palette) (light|dark)[\s\S]*?@\1 end \*\//g, "");
// Pure black/white are constants (text-on-accent, first-paint bg), not theme colours.
const isBlackWhite = (h) => /^#(fff|000|ffffff|000000)$/i.test(h);

// Per-file raw-colour budget. 0 = pinned single-source (must stay tokenised).
// A non-zero budget is a documented ratchet for legacy colours still to be
// tokenised (Lab IDE surfaces + editor theme, the live-example card CSS, the YAML
// data colours); shrink it as they move to the shared base.
const BUDGET = {
  "tutorials/src/styles/docs-chrome.css": 0,
  "tutorials/src/styles/reference-content.css": 0,
  "tutorials/src/pages/index.astro": 0,
  "tutorials/src/pages/tutorials.astro": 0,
  "tutorials/src/layouts/Reference.astro": 0,
  "spec/src/styles/spec.css": 0,
  "tutorials/src/styles/lab-tokens.css": 8, // the --yaml-* data colours
  "tutorials/src/styles/open-in-lab.css": 41, // live-example card chrome
  "lab/index.html": 29, // IDE surfaces + CodeMirror editor theme
};

let fails = 0;
let slack = 0;
for (const [file, budget] of Object.entries(BUDGET)) {
  const hex = (stripFences(read(file)).match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(
    (h) => !isBlackWhite(h),
  );
  const n = hex.length;
  if (n > budget) {
    fails++;
    console.error(
      `✗ ${file} — ${n} raw colour(s), budget ${budget}. Read them from the shared` +
        ` tokens (shared/flatbars-chrome.css) instead of hard-coding:\n      ${[...new Set(hex)].join(" ")}`,
    );
  } else if (n < budget) {
    slack++;
    console.log(`  ↓ ${file} — ${n} < budget ${budget}; lower the budget in check-no-raw-colors.mjs`);
  }
}

if (fails) {
  console.error(`\ncheck:no-raw-colors: ${fails} file(s) hard-code colours outside the shared source.`);
  process.exit(1);
}
console.log(
  `✓ check:no-raw-colors — ${Object.keys(BUDGET).length} surfaces within budget` +
    (slack ? ` (${slack} now under budget — tighten)` : "; clean files pinned at 0"),
);
