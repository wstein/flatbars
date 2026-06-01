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
import { lessons } from "../tutorials/src/examples.mjs";
import { createBareBarsRenderer } from "../lab/barebars.mjs";
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
    ex.engine === "minbars" ? await createMinBarsRenderer() : await createBareBarsRenderer(DIALECT[ex.engine]);
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
process.exit(fail ? 1 : 0);
