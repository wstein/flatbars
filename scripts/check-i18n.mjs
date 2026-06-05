// SPDX-License-Identifier: Apache-2.0
//
// Gate for the "Localize" (i18n) guide. Like check-jsonata, it runs the page's
// ONE content source through the SAME engine the Lab and the cells use, so the
// page can never claim a result the engine doesn't produce. The i18n brain is the
// browser's native Intl (PluralRules/NumberFormat) — there is NO vendored
// dependency to pin (ADR-029 amendment, 2026-06-05), unlike check-jsonata.
//
// Three assertions:
//   1. every cell  {template, data, locale} ⟶ FullBars render === expect
//      (so the snippet is honest; the `t` helper is bound per cell locale)
//   2. the flagship (two helpers, plural + interpolation) ⟶ render === expect
//   3. coverage: every catalog key is demonstrated by some cell (no over-claim),
//      and every key a cell uses is defined in that cell's locale (except the
//      deliberate `missing` fallback cell) — the no-dangling / no-over-claim
//      contract, mirroring check-jsonata's function coverage.
import assert from "node:assert/strict";
import { sections, flagship, catalog, locales, makeTHelper } from "../tutorials/src/i18n.mjs";
import { createFlatBarsRenderer } from "../lab/flatbars.mjs";

let fail = 0;
const allCells = sections.flatMap((s) => s.cells.map((c) => ({ section: s.id, ...c })));

// Render a cell's template through FullBars with `t` bound to the cell's locale.
async function renderCell(cell) {
  const r = await createFlatBarsRenderer("fullbars");
  const program = r.compile(cell.template, {}, { helpers: makeTHelper(cell.locale) }).program;
  return r.render(program, cell.data);
}

console.log("i18n cells (native Intl, FullBars render):");
for (const cell of allCells) {
  try {
    const out = await renderCell(cell);
    assert.equal(out, cell.expect);
    console.log(`  ✓ ${cell.section}/${cell.id} [${cell.locale}] → ${JSON.stringify(out)}`);
  } catch (e) {
    console.error(`  ✗ ${cell.section}/${cell.id}: ${e && e.message ? e.message.split("\n")[0] : e}`);
    fail++;
  }
}

console.log("\nFlagship (plural + interpolation, one locale):");
try {
  const r = await createFlatBarsRenderer(flagship.engine);
  const program = r.compile(flagship.template, {}, { helpers: makeTHelper(flagship.locale) }).program;
  const out = r.render(program, flagship.data);
  assert.equal(out, flagship.expect);
  console.log(`  ✓ flagship [${flagship.locale}] → ${JSON.stringify(out)}`);
} catch (e) {
  console.error(`  ✗ flagship: ${e && e.message ? e.message.split("\n")[0] : e}`);
  fail++;
}

// ── Coverage contract ────────────────────────────────────────────────────────
// Keys a cell references: `t "some.key"` in the template (the first string arg).
const KEY_RE = /\bt\s+"([^"]+)"/g;
function keysOf(template) {
  return [...template.matchAll(KEY_RE)].map((m) => m[1]);
}

console.log("\nCoverage contract:");
// (a) Every key a cell uses is defined in that cell's locale — except cells
// explicitly marked `missing` (they demonstrate the fallback on purpose).
for (const cell of allCells) {
  if (cell.missing) continue;
  for (const key of keysOf(cell.template)) {
    if (catalog[cell.locale]?.[key] === undefined) {
      console.error(`  ✗ ${cell.section}/${cell.id}: key "${key}" undefined for locale ${cell.locale}`);
      fail++;
    }
  }
}
// (b) Every catalog key (union across locales) is demonstrated by some cell —
// no over-claiming a translation the page never shows.
const usedKeys = new Set(allCells.flatMap((c) => keysOf(c.template)));
const definedKeys = new Set(locales.flatMap((l) => Object.keys(catalog[l])));
const undemonstrated = [...definedKeys].filter((k) => !usedKeys.has(k)).sort();
if (undemonstrated.length) {
  console.error(`  ✗ catalog keys never demonstrated (drop or use): ${undemonstrated.join(" ")}`);
  fail++;
}
// (c) Every locale is exercised by at least one cell.
const usedLocales = new Set(allCells.map((c) => c.locale));
const idleLocales = locales.filter((l) => !usedLocales.has(l));
if (idleLocales.length) {
  console.error(`  ✗ locales never demonstrated: ${idleLocales.join(" ")}`);
  fail++;
}
if (!undemonstrated.length && !idleLocales.length) {
  console.log(`  ✓ ${definedKeys.size} keys all demonstrated; ${usedLocales.size}/${locales.length} locales exercised`);
}

console.log(fail ? `\n${fail} i18n check(s) failed` : `\nall i18n cells + flagship + coverage OK`);
process.exit(fail ? 1 : 0);
