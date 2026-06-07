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
import { examples as fullbarsExamples } from "../tutorials/src/fullbars.mjs";
import { examples as maxbarsExamples } from "../tutorials/src/maxbars.mjs";
import { createRenderer } from "../lab/renderer.mjs";
import { renderWith, renderMaxWith, safe } from "../lab/vendor/flatbars-engine.mjs";
import { buildHelpers } from "../lab/helpers.mjs";
import { labHref } from "../lab/open-in-lab.mjs";

const DIALECT = { rawbars: "core", fullbars: "surface", maxbars: "maxbars" };

let fail = 0;
const warnings = [];

// Shared-<head> guard: the landing and the reference layout must both route
// their <head> through src/components/BaseHead.astro, never hand-roll a font
// link of their own — that is exactly how the two heads drifted before (the
// landing was missing a Mono weight). BaseHead is the only place the Google
// Fonts link may appear, so any other page referencing it has re-forked the head.
console.log("Shared <head> (BaseHead) guard:");
for (const page of ["src/pages/index.astro", "src/layouts/Reference.astro"]) {
  const src = readFileSync(new URL(`../tutorials/${page}`, import.meta.url), "utf8");
  if (!/\bBaseHead\b/.test(src)) {
    console.error(`  ✗ ${page}: does not use BaseHead — the <head> must come from the shared partial`);
    fail++;
  } else if (src.includes("fonts.googleapis.com")) {
    console.error(`  ✗ ${page}: hand-rolls a font <link> — fonts belong only in BaseHead.astro (head drift risk)`);
    fail++;
  } else {
    console.log(`  ✓ ${page} routes its <head> through BaseHead`);
  }
}

// Spec-link guard: every link into the Starlight spec must go through
// PUBLIC_SPEC_BASE (like the reference pages), so it resolves at the deployed
// path /flatbars/spec/. A hardcoded `/spec/` is both 404 in dev and wrong in
// production — that was the landing footer's "Docs" bug.
console.log("\nSpec-link guard:");
for (const page of ["src/pages/index.astro"]) {
  const src = readFileSync(new URL(`../tutorials/${page}`, import.meta.url), "utf8");
  if (/href=["'`]\/spec\//.test(src) || /href=\{`\/spec\//.test(src)) {
    console.error(`  ✗ ${page}: hardcodes a /spec/ link — route it through PUBLIC_SPEC_BASE (SPEC_BASE)`);
    fail++;
  } else if (!/PUBLIC_SPEC_BASE/.test(src)) {
    console.error(`  ✗ ${page}: the footer "Docs" link must resolve via PUBLIC_SPEC_BASE (SPEC_BASE)`);
    fail++;
  } else {
    console.log(`  ✓ ${page} links the spec via PUBLIC_SPEC_BASE`);
  }
}

// Heuristic (non-fatal): a list example that renders its items on one line with
// no separator reads as "broken" to newcomers — the standalone-trim footgun the
// partial examples hit. Flag a block-iterating example whose data holds a 2+
// element array and whose output has neither a newline nor an HTML tag (HTML
// one-liners read as structure), unless it is deliberately inline.
function hasMultiArray(v) {
  if (Array.isArray(v)) return v.length >= 2 || v.some(hasMultiArray);
  if (v && typeof v === "object") return Object.values(v).some(hasMultiArray);
  return false;
}
function collapseWarn(label, ex, out) {
  if (ex.inline || !/\{\{#/.test(ex.template) || !hasMultiArray(ex.data)) return;
  if (out.includes("\n") || out.includes("<")) return;
  warnings.push(
    `  ⚠ ${label}: iterates a list but renders on one line with no separator — ` +
      "newcomers may read it as broken. Put the line break in the row, or set `inline: true` if intended.",
  );
}

for (const [key, ex] of Object.entries(lessons)) {
  try {
    await labHref(ex.engine, ex, { labUrl: "/lab/index.html" });
  } catch (e) {
    console.error(`  ✗ ${key}: Open-in-Lab link failed to build — ${e.message}`);
    fail++;
    continue;
  }
  const renderer =
    ex.engine === "minbars" ? await createRenderer("minbars") : await createRenderer(DIALECT[ex.engine]);
  try {
    // A lesson with custom helpers (ADR-018) renders through `renderWith`, the
    // same path the card uses; otherwise the adapter's plain render.
    let out;
    if (ex.helpers && ex.helpers.trim()) {
      const built = buildHelpers(ex.helpers, safe);
      if (!built.ok) throw new Error("helper source error: " + built.error);
      const r = renderWith(built.helpers, ex.partials || {}, ex.template, ex.data ?? {});
      if (!r.ok) throw new Error(r.error);
      out = r.value;
    } else {
      out = renderer.render(renderer.compile(ex.template, ex.partials || {}).program, ex.data ?? {});
    }
    if (typeof out !== "string" || out.length === 0) throw new Error("rendered empty output");
    console.log(`  ✓ ${key} (${ex.engine}) → ${JSON.stringify(out.slice(0, 50))}${out.length > 50 ? "…" : ""}`);
    collapseWarn(`${key} (${ex.engine})`, ex, out);
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
const pageSrc = readFileSync(new URL("../tutorials/src/pages/minbars.astro", import.meta.url), "utf8");
const minbars = await createRenderer("minbars");
for (const [key, ex] of Object.entries(mustacheExamples)) {
  if (!pageSrc.includes(`ex.${key}.`)) {
    console.error(`  ✗ ${key}: defined in mustache.mjs but never referenced by minbars.astro (orphan)`);
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
    collapseWarn(key, ex, out);
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
  const r = await createRenderer(DIALECT[eng]);
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
    collapseWarn(`${key} (${eng})`, rex, out);
  } catch (e) {
    console.error(`  ✗ ${key} (${eng}): ${e && e.message ? e.message : e}`);
    fail++;
  }
}

// FullBars reference examples (tutorials/src/fullbars.mjs) — every one runs under
// the `surface` engine; a custom-helper example (ADR-018) renders through
// `renderWith` (the same path the card uses), and a `compiles` example must also
// emit JS. Orphan guard against examples never shown on fullbars.astro.
console.log("\nFullBars reference examples (fullbars):");
const fullPageSrc = readFileSync(new URL("../tutorials/src/pages/fullbars.astro", import.meta.url), "utf8");
const fbr = await createRenderer("surface");
for (const [key, fex] of Object.entries(fullbarsExamples)) {
  if (!fullPageSrc.includes(`ex.${key}.`)) {
    console.error(`  ✗ ${key}: defined in fullbars.mjs but never referenced by fullbars.astro (orphan)`);
    fail++;
  }
  try {
    await labHref("fullbars", fex, { labUrl: "/lab/index.html" });
  } catch (e) {
    console.error(`  ✗ ${key}: Open-in-Lab link failed to build — ${e.message}`);
    fail++;
    continue;
  }
  try {
    let out;
    if (fex.helpers && fex.helpers.trim()) {
      const built = buildHelpers(fex.helpers, safe);
      if (!built.ok) throw new Error("helper source error: " + built.error);
      const res = renderWith(built.helpers, fex.partials || {}, fex.template, fex.data ?? {});
      if (!res.ok) throw new Error(res.error);
      out = res.value;
    } else {
      out = fbr.render(fbr.compile(fex.template, fex.partials || {}).program, fex.data ?? {});
    }
    if (typeof out !== "string" || out.length === 0) throw new Error("rendered empty output");
    let note = "";
    if (fex.compiles) {
      const c = fbr.compileToJs(fex.template);
      if (!c || !c.ok) throw new Error("compileToJs failed: " + ((c && c.error) || "unknown"));
      note = ` [compiles ✓ ${c.value.length}b]`;
    }
    console.log(`  ✓ ${key} (fullbars) → ${JSON.stringify(out.slice(0, 50))}${out.length > 50 ? "…" : ""}${note}`);
    collapseWarn(`${key} (fullbars)`, fex, out);
  } catch (e) {
    console.error(`  ✗ ${key} (fullbars): ${e && e.message ? e.message : e}`);
    fail++;
  }
}

// MaxBars reference examples (tutorials/src/maxbars.mjs) — every one runs under
// the `maxbars` engine (FullBars + infix operators, pipes, bare loop vars); a
// `compiles` example must also emit JS via compileToJs. Orphan guard against
// examples never shown on maxbars.astro.
console.log("\nMaxBars reference examples (maxbars):");
const maxPageSrc = readFileSync(new URL("../tutorials/src/pages/maxbars.astro", import.meta.url), "utf8");
const mbr = await createRenderer("maxbars");
for (const [key, mex] of Object.entries(maxbarsExamples)) {
  if (!maxPageSrc.includes(`ex.${key}.`)) {
    console.error(`  ✗ ${key}: defined in maxbars.mjs but never referenced by maxbars.astro (orphan)`);
    fail++;
  }
  try {
    await labHref("maxbars", mex, { labUrl: "/lab/index.html" });
  } catch (e) {
    console.error(`  ✗ ${key}: Open-in-Lab link failed to build — ${e.message}`);
    fail++;
    continue;
  }
  try {
    // A custom-helper example (ADR-018) renders through `renderMaxWith` (MaxBars'
    // operation registrar — the same path the card uses); otherwise plain render.
    let out;
    if (mex.helpers && mex.helpers.trim()) {
      const built = buildHelpers(mex.helpers, safe);
      if (!built.ok) throw new Error("helper source error: " + built.error);
      const r = renderMaxWith(built.helpers, mex.partials || {}, mex.template, mex.data ?? {});
      if (!r.ok) throw new Error(r.error);
      out = r.value;
    } else {
      out = mbr.render(mbr.compile(mex.template, mex.partials || {}).program, mex.data ?? {});
    }
    if (typeof out !== "string" || out.length === 0) throw new Error("rendered empty output");
    let note = "";
    if (mex.compiles) {
      const c = mbr.compileToJs(mex.template);
      if (!c || !c.ok) throw new Error("compileToJs failed: " + ((c && c.error) || "unknown"));
      note = ` [compiles ✓ ${c.value.length}b]`;
    }
    console.log(`  ✓ ${key} (maxbars) → ${JSON.stringify(out.slice(0, 50))}${out.length > 50 ? "…" : ""}${note}`);
    collapseWarn(`${key} (maxbars)`, mex, out);
  } catch (e) {
    console.error(`  ✗ ${key} (maxbars): ${e && e.message ? e.message : e}`);
    fail++;
  }
}

if (warnings.length) {
  console.log(`\n${warnings.length} possible single-line list collapse(s) — non-fatal, review:`);
  for (const w of warnings) console.log(w);
}
console.log(fail ? `\n${fail} example(s) broken overall` : `\nall tutorial + reference examples render + link`);
process.exit(fail ? 1 : 0);
