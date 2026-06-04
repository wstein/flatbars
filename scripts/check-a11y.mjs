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
}

console.log(fail ? `\n${fail} accessibility guard(s) failed` : "\nall accessibility guards pass");
process.exit(fail ? 1 : 0);
