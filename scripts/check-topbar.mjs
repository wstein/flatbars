// SPDX-License-Identifier: Apache-2.0
//
// One topbar across the whole umbrella. The chrome is the shared, zero-dependency
// <flatbars-topbar> custom element (shared/flatbars-topbar.mjs) — the element the
// tutorials app, the Starlight spec, and the static Lab all mount, so the
// wordmark, switcher and theme control can never drift between surfaces. This gate
// (formerly check:wordmark) pins:
//   1. the element is the single source of the canonical wordmark lockup
//        <b class="flat">Flat</b>Bars   …plus the `start`/`tools` host slots
//   2. every MIGRATED chrome surface mounts the element (`<flatbars-topbar …>`)
//   3. surfaces not yet on the element still carry the canonical lockup
//   4. the landing footer's Wordmark.astro still carries the lockup
// As each surface adopts the element it moves from list (3) to list (2).
// Run as `npm run check:topbar` (wired into `npm test`).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const FLAT = '<b class="flat">Flat</b>Bars';
const MOUNT = "<flatbars-topbar";

// Surfaces that mount the shared element.
const MOUNTS = {
  "tutorials/src/components/Topbar.astro": "the tutorials topbar",
  "spec/src/components/Header.astro": "the Starlight spec header override",
  "lab/index.html": "the static Lab",
};
// Surfaces still carrying the hand-written lockup (none — all migrated).
const LOCKUPS = {};
// The static Lab can't import a module from a sibling dir, so it loads a vendored
// copy of the element (like the engine bundle). It must match shared/ verbatim;
// regenerate with `npm run gen:topbar`.
const VENDORED = "lab/vendor/flatbars-topbar.mjs";

let fails = 0;
const fail = (msg) => {
  fails++;
  console.error(`✗ ${msg}`);
};

// 1. The element is the single source of the wordmark lockup + host slots.
const elementSrc = read("shared/flatbars-topbar.mjs");
{
  if (!elementSrc.includes(FLAT)) fail(`shared/flatbars-topbar.mjs — missing the \`${FLAT}\` lockup`);
  for (const slot of ['name="start"', 'name="tools"']) {
    if (!elementSrc.includes(`<slot ${slot}`)) fail(`shared/flatbars-topbar.mjs — missing the host \`${slot}\` slot`);
  }
}

// 1b. The Lab's vendored copy is byte-identical to the source.
{
  let vendored;
  try {
    vendored = read(VENDORED);
  } catch {
    vendored = null;
    fail(`${VENDORED} — missing (run \`npm run gen:topbar\`)`);
  }
  if (vendored !== null && vendored !== elementSrc) {
    fail(`${VENDORED} — stale vs shared/flatbars-topbar.mjs (run \`npm run gen:topbar\`)`);
  }
}

// 2. Every migrated chrome surface mounts the element.
for (const [file, what] of Object.entries(MOUNTS)) {
  if (!read(file).includes(MOUNT)) fail(`${file} (${what}) — does not mount \`${MOUNT}…>\``);
}

// 3. Surfaces not yet on the element still carry the canonical lockup.
for (const [file, what] of Object.entries(LOCKUPS)) {
  if (!read(file).includes(FLAT)) fail(`${file} (${what}) — missing the \`${FLAT}\` lockup`);
}

// 4. The landing footer's wordmark component still carries the lockup.
if (!read("tutorials/src/components/Wordmark.astro").includes(FLAT)) {
  fail("tutorials/src/components/Wordmark.astro — missing the `<b class=\"flat\">Flat</b>Bars` lockup");
}

if (fails) {
  console.error(`\ncheck:topbar: ${fails} surface(s) diverge from the shared topbar contract.`);
  process.exit(1);
}
const n = Object.keys(MOUNTS).length + Object.keys(LOCKUPS).length + 1;
console.log(`✓ check:topbar — the shared <flatbars-topbar> owns the wordmark across ${n} surfaces`);
