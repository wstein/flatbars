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
// A non-zero budget is a documented ratchet for the remaining CONTENT/EDITOR
// palettes — not chrome (the chrome is fully single-sourced and pinned at 0
// below). These are per-feature, theme-fixed colour sets that need a dedicated
// shared token group + a visual review to retire safely: the YAML data-editor
// colours, the live-example analysis/lint legend, and the Lab's editor-syntax
// (--tok-*) + brand-green tokens. The Lab's IDE *surfaces* were already derived
// from the base (var(--bg…)). Shrink each budget as a palette moves to shared.
//
// BURN-DOWN — target: 0. The grandfathered total is reported on success so the
// green check never implies "fully single-sourced" (it isn't yet). Retire it by
// introducing a shared "diagnostic/editor" token group in shared/flatbars-tokens.css
// (the --c-* palette's companion): the YAML colours, the analysis/lint legend, and
// the editor-syntax (--tok-*) all become generated tokens, after a visual pass.
const BUDGET = {
  "tutorials/src/styles/docs-chrome.css": 0,
  "tutorials/src/styles/reference-content.css": 0,
  "tutorials/src/pages/index.astro": 0,
  "tutorials/src/pages/tutorials.astro": 0,
  "tutorials/src/layouts/Reference.astro": 0,
  "spec/src/styles/spec.css": 0,
  "tutorials/src/styles/lab-tokens.css": 8, // --yaml-* data-editor colours
  "tutorials/src/styles/open-in-lab.css": 41, // live-example analysis/lint legend (fixed, on dark panes)
  "lab/index.html": 22, // editor-syntax (--tok-*) + brand greens + accent tints
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
// Honest success: report the grandfathered total so the green check isn't read as
// "fully single-sourced". 0 means the whole design system is single-sourced.
const grandfathered = Object.values(BUDGET).reduce((a, b) => a + b, 0);
const dirty = Object.values(BUDGET).filter((b) => b > 0).length;
const pinned = Object.values(BUDGET).filter((b) => b === 0).length;
console.log(
  `✓ check:no-raw-colors — ${pinned} surface(s) pinned single-source (0 raw colours)` +
    (grandfathered
      ? `; ${grandfathered} raw colour(s) still grandfathered across ${dirty} file(s) ` +
        `(content/editor palettes — burn-down target 0, see the script header)`
      : "; everything single-sourced") +
    (slack ? ` — ${slack} file(s) now UNDER budget, tighten the budget` : ""),
);
