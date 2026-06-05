// SPDX-License-Identifier: Apache-2.0
//
// MinBars adapter tests — verify the Mustache engine seam, focusing on the
// truthiness toggle (ADR-022 S2): the Lab's `compat` render option flips MinBars
// from its language-agnostic spec rule (0/"" truthy) to the mustache.js rule
// (0/"" falsy). Run with: node --test minbars.test.mjs
// Requires vendor/flatbars-engine.mjs (the bundled flatbars-js facade).

import test from "node:test";
import assert from "node:assert/strict";
import { createMinBarsRenderer } from "./minbars.mjs";

// Render `src` against `data`; `opts` (e.g. { compat: true }) reaches render().
const run = (r, src, data, opts) => r.render(r.compile(src).program, data, opts);

test("renders the language-agnostic Mustache (spec) rule by default — 0/'' truthy", async () => {
  const r = await createMinBarsRenderer();
  const tpl = "{{#n}}has{{/n}}{{^n}}none{{/n}}";
  assert.equal(run(r, tpl, { n: 0 }), "has");
  assert.equal(run(r, "{{#s}}has{{/s}}{{^s}}none{{/s}}", { s: "" }), "has");
});

test("compat mode renders mustache.js truthiness — 0 and '' are falsy", async () => {
  const r = await createMinBarsRenderer();
  assert.equal(run(r, "{{#n}}has{{/n}}{{^n}}none{{/n}}", { n: 0 }, { compat: true }), "none");
  assert.equal(run(r, "{{#s}}has{{/s}}{{^s}}none{{/s}}", { s: "" }, { compat: true }), "none");
  // a non-empty / non-zero value is truthy under both rules
  assert.equal(run(r, "{{#n}}has{{/n}}{{^n}}none{{/n}}", { n: 5 }, { compat: true }), "has");
  // {} stays truthy and [] stays falsy in both rules — only the "ambiguous two" flip
  assert.equal(run(r, "{{#o}}y{{/o}}{{^o}}n{{/o}}", { o: {} }, { compat: true }), "y");
  assert.equal(run(r, "{{#xs}}y{{/xs}}{{^xs}}n{{/xs}}", { xs: [] }, { compat: true }), "n");
});

test("compat mode honors partials", async () => {
  const r = await createMinBarsRenderer();
  const prog = r.compile("{{#n}}{{> row}}{{/n}}{{^n}}none{{/n}}", { row: "R" }).program;
  assert.equal(r.render(prog, { n: 0 }, { compat: true }), "none"); // 0 falsy → inverted
  assert.equal(r.render(prog, { n: 1 }, { compat: true }), "R"); // truthy → partial renders
});

test("compileToJs seeds the chosen truthiness rule", async () => {
  const r = await createMinBarsRenderer();
  const spec = r.compileToJs("{{#n}}has{{/n}}");
  assert.ok(spec.ok, spec.error);
  assert.match(spec.value, /truthyMustache/);
  const compat = r.compileToJs("{{#n}}has{{/n}}", undefined, { compat: true });
  assert.ok(compat.ok, compat.error);
  assert.match(compat.value, /truthyHandlebars/);
});
