// SPDX-License-Identifier: Apache-2.0
//
// BareBars engine-adapter tests — verifies the adapter satisfies the polyglot
// seam (Brace Lab's third engine) without booting the browser app. Run with:
//   node --test barebars.test.mjs
// Requires vendor/barebars-engine.mjs (the bundled barebars-js facade).

import test from "node:test";
import assert from "node:assert/strict";
import { createBareBarsRenderer } from "./barebars.mjs";

const SEAM = [
  "render", "compile", "parseAst", "inspectAt", "usedTransformers",
  "requiredAssigns", "partialGraph", "allTransformers", "catalog",
  "engineInfo", "version",
];

const run = (r, src, data, opts) => r.render(r.compile(src, {}, opts).program, data);

test("adapter exposes the full engine seam", async () => {
  const r = await createBareBarsRenderer();
  for (const k of SEAM) assert.ok(k in r, `missing seam member: ${k}`);
});

test("renders the surface dialect (paths + auto-escape) by default", async () => {
  const r = await createBareBarsRenderer();
  assert.equal(
    run(r, "<h1>{{ name }}</h1>{{#if admin}} (admin){{/if}}", { name: "Ada & <b>", admin: true }),
    "<h1>Ada &amp; &lt;b&gt;</h1> (admin)",
  );
});

test("renders the core dialect when selected", async () => {
  const r = await createBareBarsRenderer();
  assert.equal(
    run(r, '{{{ json this (dict "pretty" true) }}}', { a: 1 }, { dialect: "core" }),
    '{\n  "a": 1\n}',
  );
});

test("supports the elif clause chain", async () => {
  const r = await createBareBarsRenderer();
  assert.equal(run(r, "{{#if a}}A{{elif b}}B{{else}}C{{/if}}", { a: false, b: true }), "B");
});

test("a parse error is thrown as a located render error", async () => {
  const r = await createBareBarsRenderer();
  assert.throws(() => run(r, "{{ oops", {}), (e) => {
    assert.equal(e.kind, "render");
    assert.match(e.message, /1:1:/); // line:column from the engine diagnostics
    return true;
  });
});

test("engineInfo advertises an honest capability vector", async () => {
  const r = await createBareBarsRenderer();
  const info = r.engineInfo();
  assert.match(info.version, /^barebars /);
  assert.ok(Array.isArray(info.features));
  // MVP: no Stem-only / AST-backed features advertised, so those panels gate off.
  for (const absent of ["transformers", "static-ast", "partial-graph", "bytecode-wire", "context-inspect"]) {
    assert.ok(!info.features.includes(absent), `should not advertise ${absent} yet`);
  }
  assert.ok(info.builtins.includes("each") && info.builtins.includes("json"));
});

test("the catalog entries have the cheat-sheet shape", async () => {
  const r = await createBareBarsRenderer();
  for (const e of r.catalog()) {
    for (const f of ["name", "category", "arity", "summary", "example"]) {
      assert.ok(f in e, `catalog entry missing ${f}`);
    }
  }
});
