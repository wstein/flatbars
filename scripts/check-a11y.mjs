#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Static accessibility guards for the tutorials' interactive surfaces. The
// runnable-example islands render their own DOM (Preact) and the repo has no
// headless axe harness yet, so these pin the a11y invariants AT SOURCE so they
// can't silently regress: every editor textarea has an accessible name, the
// floating example actions stay reachable on touch, keyboard focus is visible,
// motion respects prefers-reduced-motion, and a disabled link is not rendered as
// a focusable dead control. A full axe-core smoke gate is the tracked follow-up
// (see tutorials/README.md).
//
//   node scripts/check-a11y.mjs
//
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../tutorials/${p}`, import.meta.url), "utf8");
let fail = 0;
function check(label, ok, fix) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    return;
  }
  console.error(`  ✗ ${label}\n      → ${fix}`);
  fail++;
}

console.log("Accessibility guards (source-pinned):");

// 1. Editor textareas carry an accessible name. The visible caption sits in an
//    aria-hidden highlight layer, so the transparent <textarea> on top needs its
//    own aria-label or a screen reader announces an unlabelled edit field.
for (const comp of ["src/components/OpenInLab.jsx", "src/components/TryJsonata.jsx"]) {
  const src = read(comp);
  const hasInput = /class="oil-ed-input"/.test(src);
  const labelled = /aria-label=\{label\}/.test(src);
  check(
    `${comp}: editor textarea has an accessible name`,
    hasInput && labelled,
    "give the .oil-ed-input <textarea> aria-label={label} and pass a label at each call site",
  );
}

// 2. Floating example actions stay visible on no-hover (touch) devices — they
//    reveal on hover/focus-within, which touch can't trigger before tapping in,
//    so the per-example "Open in Lab" would otherwise be undiscoverable.
{
  const css = read("src/styles/open-in-lab.css");
  check(
    "open-in-lab.css: floating actions visible on touch (no-hover)",
    /@media\s*\(hover:\s*none\)\s*\{[^}]*\.oil-actions\s*\{[^}]*opacity:\s*1/.test(css),
    "add @media (hover:none){ .oil-actions{opacity:1;pointer-events:auto} } so Open-in-Lab is reachable on touch",
  );
  // 3. The reveal/transition respects a reduced-motion preference.
  check(
    "open-in-lab.css: reduced-motion disables the action transitions",
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.oil-actions[^}]*transition:\s*none/.test(css),
    "add a @media (prefers-reduced-motion: reduce) block setting transition:none on .oil-actions",
  );
}

// 4. Keyboard focus is visible on the topbar segmented controls. The Theme
//    control now lives inside the shared <flatbars-topbar> element (shadow DOM),
//    so its focus ring is pinned there.
{
  const el = readFileSync(new URL("../shared/flatbars-topbar.mjs", import.meta.url), "utf8");
  check(
    "flatbars-topbar.mjs: theme segmented control has a visible focus ring",
    /\.seg button:focus-visible\s*\{[^}]*outline/.test(el),
    "keep `.seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` in the element styles",
  );
}

// 5. A not-yet-available "Open in Lab" link is not rendered as a focusable dead
//    control (aria-disabled does not disable an <a>); render it only when href.
{
  const src = read("src/components/OpenInLab.jsx");
  check(
    "OpenInLab.jsx: Lab link is conditionally rendered, not aria-disabled",
    /\{href\s*&&\s*\(/.test(src) && !/aria-disabled=/.test(src),
    "render the .oil-lab <a> inside `{href && ( … )}` and drop the aria-disabled= attribute",
  );
}

console.log(fail ? `\n${fail} accessibility guard(s) failed` : "\nall accessibility guards pass");
process.exit(fail ? 1 : 0);
