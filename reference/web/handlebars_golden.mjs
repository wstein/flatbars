// SPDX-License-Identifier: Apache-2.0
//
// L2 oracle test for the Handlebars adapter (ADR-0020 Phase 4). For each case it
// renders a template TWICE:
//   - ADAPTER: createHandlebarsRenderer().compile(...).then(render(... {map}))
//     — the playground's exact path (partials passed at render time, the
//     { output, segments } unwrap).
//   - ORACLE:  canonical Handlebars usage on a fresh, isolated
//     `Handlebars.create()` instance with registerPartial — the upstream API,
//     independent of the adapter code.
// The goldens are produced by upstream Handlebars, NOT by the adapter, so this
// is a real differential check of the adapter's wiring (partial passing,
// escaping, context, the single-shape unwrap), not a self-tautology. A
// divergence is an adapter bug. Run from the repo root:
//
//   node native/web/handlebars_golden.mjs
//
// Scope: the oracle is the vendored upstream bundle (handlebars 4.7.8). It
// guards the adapter against upstream behaviour; a separately-pinned npm copy
// would additionally guard the vendored bundle's integrity (covered indirectly
// by the contract test, handlebars_smoke.mjs).

import Handlebars from "./vendor/handlebars.mjs";
import { createHandlebarsRenderer } from "./handlebars.mjs";

const r = await createHandlebarsRenderer();

// Canonical upstream render on an isolated instance (no global partial leak).
function oracle(template, data, partials) {
  const hb = Handlebars.create();
  for (const [name, src] of Object.entries(partials || {})) hb.registerPartial(name, src);
  return hb.compile(template)(data == null ? {} : data);
}

// Adapter render through the playground's exact seam.
function adapter(template, data, partials) {
  const compiled = r.compile(template, partials || {});
  if (compiled.errors) throw new Error("adapter compile: " + JSON.stringify(compiled.errors));
  const { output } = r.render(compiled.program, data, { map: true });
  return output;
}

const CASES = [
  { label: "escaped variable", t: "Hi {{name}}", d: { name: "Ada & <Co>" } },
  { label: "triple-stash raw", t: "{{{html}}}", d: { html: "<b>x</b>" } },
  { label: "ampersand raw", t: "{{&html}}", d: { html: "<i>y</i>" } },
  { label: "dotted path", t: "{{a.b.c}}", d: { a: { b: { c: "deep" } } } },
  { label: "missing key", t: "[{{nope}}]", d: {} },
  { label: "each array", t: "{{#each xs}}[{{this}}]{{/each}}", d: { xs: [1, 2, 3] } },
  { label: "each @index/@first/@last", t: "{{#each xs}}{{@index}}:{{this}}{{#unless @last}},{{/unless}}{{/each}}", d: { xs: ["a", "b", "c"] } },
  { label: "each empty -> else", t: "{{#each xs}}x{{else}}none{{/each}}", d: { xs: [] } },
  { label: "if truthy", t: "{{#if a}}Y{{else}}N{{/if}}", d: { a: 1 } },
  { label: "if empty object (truthy in HB)", t: "{{#if a}}Y{{else}}N{{/if}}", d: { a: {} } },
  { label: "if empty array (falsy)", t: "{{#if a}}Y{{else}}N{{/if}}", d: { a: [] } },
  { label: "if zero (falsy)", t: "{{#if a}}Y{{else}}N{{/if}}", d: { a: 0 } },
  { label: "unless", t: "{{#unless done}}todo{{/unless}}", d: { done: false } },
  { label: "with", t: "{{#with u}}{{name}}/{{role}}{{/with}}", d: { u: { name: "Grace", role: "Runtime" } } },
  { label: "lookup helper", t: "{{lookup obj key}}", d: { obj: { x: "found" }, key: "x" } },
  { label: "partial", t: "{{> row}}", d: { name: "Z" }, p: { row: "<li>{{name}}</li>" } },
  { label: "partial in each", t: "<ul>{{#each people}}{{> row}}{{/each}}</ul>", d: { people: [{ name: "A" }, { name: "B" }] }, p: { row: "<li>{{name}}</li>" } },
  { label: "partial hash arg", t: "{{> row n=name}}", d: { name: "H" }, p: { row: "[{{n}}]" } },
  { label: "nested blocks", t: "{{#each xs}}{{#if this}}T{{else}}F{{/if}}{{/each}}", d: { xs: [1, 0, 2] } },
  { label: "standalone whitespace", t: "{{#each xs}}\n  {{this}}\n{{/each}}", d: { xs: ["a", "b"] } },
  { label: "comment", t: "a{{! ignored }}b", d: {} },
];

let failed = 0;
for (const c of CASES) {
  let want, got, err;
  try { want = oracle(c.t, c.d, c.p); } catch (e) { err = "oracle: " + e.message; }
  try { got = adapter(c.t, c.d, c.p); } catch (e) { err = (err ? err + "; " : "") + "adapter: " + e.message; }
  const ok = !err && want === got;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${c.label}` +
    (ok ? "" : ` — ${err || `want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`}`));
}

console.log(`\nhandlebars oracle: ${CASES.length - failed}/${CASES.length} cases byte-match upstream Handlebars`);
if (failed) process.exit(1);
