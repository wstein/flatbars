#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// CI gate for the tutorial "Open in Lab" examples (consensus item 5). For every
// lesson it (1) builds the Open-in-Lab deep-link (so the encoder/contract can't
// break) and (2) renders the example through the *real* engine bundle the Lab
// uses, asserting it produces output. A broken example or link fails the build —
// never the user. Single source: the lessons come from tutorials/src/examples.mjs,
// the same file the pages render, so a preview and its gate can never diverge.
//
//   node scripts/check-tutorial-links.mjs
//
import { readFileSync } from "node:fs";
import { lessons } from "../tutorials/src/examples.mjs";
import { examples as mustacheExamples } from "../tutorials/src/mustache.mjs";
import { examples as rawbarsExamples } from "../tutorials/src/rawbars.mjs";
import { createFlatBarsRenderer } from "../lab/flatbars.mjs";
import { createMinBarsRenderer } from "../lab/minbars.mjs";
import { labHref } from "../lab/open-in-lab.mjs";

const DIALECT = { rawbars: "core", fullbars: "surface", maxbars: "maxbars" };

let fail = 0;
for (const [key, ex] of Object.entries(lessons)) {
  try {
    await labHref(ex.engine, ex, { labUrl: "/lab/index.html" });
  } catch (e) {
    console.error(`  ✗ ${key}: Open-in-Lab link failed to build — ${e.message}`);
    fail++;
    continue;
  }
  const renderer =
    ex.engine === "minbars" ? await createMinBarsRenderer() : await createFlatBarsRenderer(DIALECT[ex.engine]);
  try {
    const out = renderer.render(renderer.compile(ex.template, ex.partials || {}).program, ex.data ?? {});
    if (typeof out !== "string" || out.length === 0) throw new Error("rendered empty output");
    console.log(`  ✓ ${key} (${ex.engine}) → ${JSON.stringify(out.slice(0, 50))}${out.length > 50 ? "…" : ""}`);
  } catch (e) {
    console.error(`  ✗ ${key} (${ex.engine}): ${e && e.message ? e.message : e}`);
    fail++;
  }
}
console.log(
  fail
    ? `\n${fail} tutorial example(s) broken`
    : `\nall ${Object.keys(lessons).length} tutorial examples render + link`,
);

// The Mustache reference's examples (tutorials/src/mustache.mjs) — every one
// runs under MinBars and feeds an Open-in-Lab island, so the same gate applies:
// build the deep-link AND render through the real engine, asserting non-empty.
console.log("\nMustache reference examples (minbars):");
// Orphan guard: every example must be wired into the reference page, so an
// unused example can't accumulate as dead code.
const pageSrc = readFileSync(new URL("../tutorials/src/pages/mustache.astro", import.meta.url), "utf8");
const minbars = await createMinBarsRenderer();
for (const [key, ex] of Object.entries(mustacheExamples)) {
  if (!pageSrc.includes(`ex.${key}.`)) {
    console.error(`  ✗ ${key}: defined in mustache.mjs but never referenced by mustache.astro (orphan)`);
    fail++;
  }
  try {
    await labHref("minbars", ex, { labUrl: "/lab/index.html" });
  } catch (e) {
    console.error(`  ✗ ${key}: Open-in-Lab link failed to build — ${e.message}`);
    fail++;
    continue;
  }
  try {
    const out = minbars.render(minbars.compile(ex.template, ex.partials || {}).program, ex.data ?? {});
    if (typeof out !== "string" || out.length === 0) throw new Error("rendered empty output");
    console.log(`  ✓ ${key} → ${JSON.stringify(out.slice(0, 50))}${out.length > 50 ? "…" : ""}`);
  } catch (e) {
    console.error(`  ✗ ${key}: ${e && e.message ? e.message : e}`);
    fail++;
  }
}
console.log(
  fail ? `\n${fail} example(s) broken overall` : `\nall mustache reference examples render + link`,
);
// RawBars reference examples (tutorials/src/rawbars.mjs) — each runs under its
// own engine (the diptych's `sugar` is FullBars); a `compiles` example must also
// emit JS via compileToJs. Orphan guard against examples never shown on the page.
console.log("\nRawBars reference examples:");
const rawPageSrc = readFileSync(new URL("../tutorials/src/pages/rawbars.astro", import.meta.url), "utf8");
for (const [key, rex] of Object.entries(rawbarsExamples)) {
  const eng = rex.engine || "rawbars";
  if (!rawPageSrc.includes(`ex.${key}.`)) {
    console.error(`  ✗ ${key}: defined in rawbars.mjs but never referenced by rawbars.astro (orphan)`);
    fail++;
  }
  try {
    await labHref(eng, rex, { labUrl: "/lab/index.html" });
  } catch (e) {
    console.error(`  ✗ ${key}: Open-in-Lab link failed to build — ${e.message}`);
    fail++;
    continue;
  }
  const r = await createFlatBarsRenderer(DIALECT[eng]);
  try {
    const out = r.render(r.compile(rex.template, rex.partials || {}).program, rex.data ?? {});
    if (typeof out !== "string" || out.length === 0) throw new Error("rendered empty output");
    let note = "";
    if (rex.compiles) {
      const c = r.compileToJs(rex.template);
      if (!c || !c.ok) throw new Error("compileToJs failed: " + ((c && c.error) || "unknown"));
      note = ` [compiles ✓ ${c.value.length}b]`;
    }
    console.log(`  ✓ ${key} (${eng}) → ${JSON.stringify(out.slice(0, 50))}${out.length > 50 ? "…" : ""}${note}`);
  } catch (e) {
    console.error(`  ✗ ${key} (${eng}): ${e && e.message ? e.message : e}`);
    fail++;
  }
}

console.log(fail ? `\n${fail} example(s) broken overall` : `\nall tutorial + reference examples render + link`);
process.exit(fail ? 1 : 0);
