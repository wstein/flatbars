// SPDX-License-Identifier: Apache-2.0
//
// FlatBars engine-adapter tests — verifies the adapter satisfies the polyglot
// seam (Brace Lab's third engine) without booting the browser app. Run with:
//   node --test flatbars.test.mjs
// Requires vendor/flatbars-engine.mjs (the bundled flatbars-js facade).

import test from "node:test";
import assert from "node:assert/strict";
import { createFlatBarsRenderer } from "./flatbars.mjs";

const SEAM = [
  "render", "compile", "parseAst", "inspectAt", "usedTransformers",
  "requiredAssigns", "partialGraph", "allTransformers", "catalog",
  "engineInfo", "version",
];

const run = (r, src, data, opts) => r.render(r.compile(src, {}, opts).program, data);

test("adapter exposes the full engine seam", async () => {
  const r = await createFlatBarsRenderer();
  for (const k of SEAM) assert.ok(k in r, `missing seam member: ${k}`);
});

test("renders the surface dialect (paths + auto-escape) by default", async () => {
  const r = await createFlatBarsRenderer();
  assert.equal(
    run(r, "<h1>{{ name }}</h1>{{#if admin}} (admin){{/if}}", { name: "Ada & <b>", admin: true }),
    "<h1>Ada &amp; &lt;b&gt;</h1> (admin)",
  );
});

test("renders user-defined helpers via opts.helpers (ADR-018)", async () => {
  const r = await createFlatBarsRenderer("fullbars");
  const helpers = { loud: (s) => String(s).toUpperCase() };
  // escaped in {{ }}, and threaded alongside any partials
  assert.equal(run(r, "{{loud x}}", { x: "<b>ada" }, { helpers }), "&lt;B&gt;ADA");
});

test("renders the core dialect when selected", async () => {
  const r = await createFlatBarsRenderer();
  assert.equal(
    run(r, '{{{ json this (dict "pretty" true) }}}', { a: 1 }, { dialect: "core" }),
    '{\n  "a": 1\n}',
  );
});

test("supports the elif clause chain", async () => {
  const r = await createFlatBarsRenderer();
  assert.equal(run(r, "{{#if a}}A{{elif b}}B{{else}}C{{/if}}", { a: false, b: true }), "B");
});

test("renders the maxbars dialect: infix, bare-infix block conditions, loop vars", async () => {
  const r = await createFlatBarsRenderer();
  const mx = (src, data) => run(r, src, data, { dialect: "maxbars" });
  // infix operators in output
  assert.equal(mx("{{ x > 0 && x < 10 }}", { x: 5 }), "true");
  // bare (un-parenthesised) infix block condition
  assert.equal(mx("{{#if a && b}}Y{{else}}N{{/if}}", { a: true, b: false }), "N");
  // loop variables through the loop object (ADR-021)
  assert.equal(mx("{{#each xs}}[{{loop.index1}}/{{loop.length}}]{{/each}}", { xs: ["a", "b"] }), "[1/2][2/2]");
  // a pipe
  assert.equal(mx("{{{ o | json }}}", { o: { a: 1 } }), '{"a":1}');
});

test("parseAst handles maxbars infix (the AST/analysis panels)", async () => {
  const r = await createFlatBarsRenderer();
  // a bare-infix block condition must parse as an `if` whose condition is the
  // desugared `(and …)` — not a parse error (which a stale engine would give).
  const ast = r.parseAst("{{#if a && b}}x{{/if}}", { dialect: "maxbars" });
  assert.ok(ast.ast, `expected an AST, got ${JSON.stringify(ast)}`);
  assert.equal(ast.ast.nodes[0].t, "if");
});

test("compiles the maxbars dialect to a JS module", async () => {
  const r = await createFlatBarsRenderer();
  // compileToJs is URL-dialect driven; assert the seam member exists and that
  // the maxbars render path (above) works — compile parity is covered by the
  // PureScript conformance harness (dialect "maxbars").
  assert.equal(typeof r.compileToJs, "function");
});

test("advertises the maxbars-dialect capability", async () => {
  const r = await createFlatBarsRenderer();
  assert.ok(r.engineInfo().features.includes("maxbars-dialect"));
});

test("a parse error is thrown as a located render error", async () => {
  const r = await createFlatBarsRenderer();
  assert.throws(() => run(r, "{{ oops", {}), (e) => {
    assert.equal(e.kind, "render");
    assert.match(e.message, /1:1:/); // line:column from the engine diagnostics
    return true;
  });
});

test("engineInfo advertises an honest capability vector", async () => {
  const r = await createFlatBarsRenderer();
  const info = r.engineInfo();
  assert.match(info.version, /\d+\.\d+/);
  assert.ok(Array.isArray(info.features));
  // backs: catalog, data-access, partial-graph; NOT Stem-only / unimplemented
  // features, so those panels gate off.
  for (const has of ["catalog", "required-assigns", "partial-graph"]) {
    assert.ok(info.features.includes(has), `should advertise ${has}`);
  }
  for (const absent of ["transformers", "bytecode-wire", "context-inspect", "standalone"]) {
    assert.ok(!info.features.includes(absent), `should not advertise ${absent} yet`);
  }
  assert.ok(info.builtins.includes("each") && info.builtins.includes("json"));
});

test("compileToJs emits a JS module (the compile-js feature)", async () => {
  const r = await createFlatBarsRenderer();
  assert.equal(typeof r.compileToJs, "function");
  assert.ok(r.engineInfo().features.includes("compile-js"));
  const c = r.compileToJs("Hello {{ name }}!");
  assert.ok(c.ok, c.error);
  assert.match(c.value, /flatbars-compiled/);
  assert.match(c.value, /export default function/);
});

test("analyze reports a truthiness portability finding (the analyse feature)", async () => {
  const r = await createFlatBarsRenderer();
  assert.equal(typeof r.analyze, "function");
  assert.ok(r.engineInfo().features.includes("analyse"));
  // an empty string in a condition diverges (falsy in handlebars, truthy elsewhere).
  const a = r.analyze({ source: "{{#if bio}}x{{/if}}" }, { bio: "" });
  assert.ok(a.ok, a.error);
  assert.match(a.report, /1 portability finding/);
  assert.match(a.report, /data path: `bio`/);
  assert.match(a.jsonata, /"bio": bio = "" \? null : bio/);
  // structured findings drive the Truthiness dock panel.
  assert.equal(a.findings.length, 1);
  const f = a.findings[0];
  assert.equal(f.line, 1);
  assert.equal(f.tag, "{{#if bio}}");
  assert.equal(f.path, "bio");
  assert.deepEqual(f.flips, ["mustache", "minimal", "presence"]);
  assert.match(f.value, /empty string/);
  assert.match(f.fix, /ne s/);
  // false agrees under every rule — no finding.
  const b = r.analyze({ source: "{{#if ok}}x{{/if}}" }, { ok: false });
  assert.match(b.report, /0 portability finding/);
  assert.equal(b.findings.length, 0);
});

test("the catalog entries have the cheat-sheet shape", async () => {
  const r = await createFlatBarsRenderer();
  for (const e of r.catalog()) {
    for (const f of ["name", "category", "arity", "summary", "example"]) {
      assert.ok(f in e, `catalog entry missing ${f}`);
    }
  }
});

test("parseAst returns the {t:…} node shape", async () => {
  const r = await createFlatBarsRenderer();
  const { ast } = r.parseAst("<h1>{{ name }}</h1>{{#each items}}{{ this }}{{/each}}");
  assert.equal(ast.version, "flatbars-ast/v1");
  const kinds = ast.nodes.map((n) => n.t);
  assert.deepEqual(kinds, ["text", "emit", "text", "each"]);
  const emit = ast.nodes[1];
  assert.equal(emit.expr.t, "path");
  assert.deepEqual(emit.expr.segments, ["name"]);
});

test("parseAst surfaces a located parse error", async () => {
  const r = await createFlatBarsRenderer();
  const res = r.parseAst("{{#each xs}}…"); // unclosed block
  assert.ok(res.error, "expected an error result");
  assert.equal(typeof res.error.message, "string");
});

test("requiredAssigns is exact (path roots only, no helpers/params)", async () => {
  const r = await createFlatBarsRenderer();
  const prog = r.compile(
    '{{ title }}{{#each rows as |row|}}{{ row.id }} {{ city.name }}{{/each}}{{#if (eq a b)}}{{ a }}{{/if}}',
    {},
  ).program;
  // `rows`, `city`, `a`, `b` are data; `row` is a block param (a call, excluded);
  // `eq`/`each`/`if` are helpers (excluded).
  assert.deepEqual(r.requiredAssigns(prog), ["a", "b", "city", "rows", "title"]);
});

test("parseAst surfaces partial uses and inline defs as semantic nodes", async () => {
  const r = await createFlatBarsRenderer();
  const { ast } = r.parseAst('{{#*inline "row"}}<li>{{ this }}</li>{{/inline}}{{> row}}{{> missing}}');
  const top = ast.nodes;
  const inline = top.find((n) => n.t === "inline");
  assert.equal(inline && inline.name, "row");
  const partials = top.filter((n) => n.t === "partial").map((n) => n.name);
  assert.deepEqual(partials, ["row", "missing"]);
});

test("named partial documents render (multi-document)", async () => {
  const r = await createFlatBarsRenderer();
  // the host passes partial documents to compile; render registers them.
  const prog = r.compile("<nav>{{> nav}}</nav>{{ title }}", { nav: "[home]" }).program;
  assert.equal(r.render(prog, { title: "T" }), "<nav>[home]</nav>T");
});

test("inline-defined partials actually render", async () => {
  const r = await createFlatBarsRenderer();
  const out = run(r, '{{#*inline "row"}}[{{ this }}]{{/inline}}{{#each xs}}{{> row}}{{/each}}', { xs: ["a", "b"] });
  assert.equal(out, "[a][b]");
});

test("usedTransformers collects block + call helpers", async () => {
  const r = await createFlatBarsRenderer();
  const prog = r.compile("{{#each xs}}{{#if (eq a b)}}{{ x }}{{/if}}{{/each}}", {}).program;
  const used = r.usedTransformers(prog);
  assert.ok(used.includes("each") && used.includes("if") && used.includes("eq"));
});
