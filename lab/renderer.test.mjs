// SPDX-License-Identifier: Apache-2.0
//
// Renderer tests — verify the unified `createRenderer(dialect)` seam (the single
// FlatBars-family adapter) without booting the browser app. Covers the FlatBars
// dialects (RawBars / FullBars / MaxBars) and MinBars (Mustache), plus the
// capability vector each advertises. Run with: node --test renderer.test.mjs
// Requires vendor/flatbars-engine.mjs (the bundled flatbars-js facade).

import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "./renderer.mjs";

// ── FlatBars dialects (core / surface / maxbars) ─────────────────────────────

const FLATBARS_SEAM = [
  "render", "analyze", "analyzeWith", "lint", "migrate", "compile", "parseAst", "inspectAt",
  "usedTransformers", "requiredAssigns", "partialGraph", "allTransformers",
  "catalog", "engineInfo", "version",
];

const run = (r, src, data, opts) => r.render(r.compile(src, {}, opts).program, data);

test("createRenderer dispatches the FlatBars dialects and exposes the full seam", async () => {
  const r = await createRenderer("fullbars");
  for (const k of FLATBARS_SEAM) assert.ok(k in r, `missing seam member: ${k}`);
});

test("renders the surface dialect (paths + auto-escape) by default", async () => {
  const r = await createRenderer();
  assert.equal(
    run(r, "<h1>{{ name }}</h1>{{#if admin}} (admin){{/if}}", { name: "Ada & <b>", admin: true }),
    "<h1>Ada &amp; &lt;b&gt;</h1> (admin)",
  );
});

test("renders user-defined helpers via opts.helpers (ADR-018)", async () => {
  const r = await createRenderer("fullbars");
  const helpers = { loud: (s) => String(s).toUpperCase() };
  // escaped in {{ }}, and threaded alongside any partials
  assert.equal(run(r, "{{loud x}}", { x: "<b>ada" }, { helpers }), "&lt;B&gt;ADA");
});

test("opts.helpers register for the maxbars and core dialects too (operation registrars)", async () => {
  // A raw block's head must resolve to a defined operation (the strict-raw-block
  // rule) — so a maxbars/rawbars example with custom ops must route through the
  // per-dialect registrar, not the helper-less render. Regression: the Lab once
  // rendered maxbars before checking opts.helpers, so {{{{#rawloud}}}} threw
  // UnknownHelper in the playground despite the example registering it.
  const r = await createRenderer("fullbars");
  const helpers = { rawloud: (options) => options.fn().toUpperCase() };
  const tpl = "{{{{#rawloud}}}}\n  {{bar}}\n{{{{/rawloud}}}}";
  assert.equal(run(r, tpl, null, { dialect: "maxbars", helpers }), "\n  {{BAR}}\n");
  assert.equal(run(r, tpl, null, { dialect: "core", helpers }), "\n  {{BAR}}\n");
});

test("maxbars threads external (host) partials through render + compileToJs", async () => {
  // External `{{> name}}` partials, each MaxBars source (the `| uppercase` pipe),
  // must resolve in BOTH render and the compiled JS — the renderMaxbarsWithPartials
  // / compileMaxbarsWithPartials seam. Regression: the Lab once rendered maxbars via
  // the helper-less entrypoint, dropping external partials (`{{> name}}` → empty).
  const r = await createRenderer("maxbars");
  const partials = { greeting: "Hi {{name | uppercase}}!" };
  const tpl = "{{> greeting}} ({{count items}})";
  const data = { name: "ada", items: [1, 2, 3] };
  assert.equal(r.render(r.compile(tpl, partials, { dialect: "maxbars" }).program, data), "Hi ADA! (3)");
  // and the compiled module folds the same partials into its registry
  const c = r.compileToJs(tpl, partials);
  assert.ok(c.ok, c.error);
  assert.ok(c.value.includes("greeting"), "compiled module should register the external partial");
});

test("renders the core dialect when selected", async () => {
  const r = await createRenderer();
  assert.equal(
    run(r, '{{{ json this (dict "pretty" true) }}}', { a: 1 }, { dialect: "core" }),
    '{\n  "a": 1\n}',
  );
});

test("supports the elif clause chain", async () => {
  const r = await createRenderer();
  assert.equal(run(r, "{{#if a}}A{{elif b}}B{{else}}C{{/if}}", { a: false, b: true }), "B");
});

test("renders the maxbars dialect: infix, bare-infix block conditions, loop vars", async () => {
  const r = await createRenderer("maxbars");
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
  const r = await createRenderer("maxbars");
  // a bare-infix block condition must parse as an `if` whose condition is the
  // desugared `(and …)` — not a parse error (which a stale engine would give).
  const ast = r.parseAst("{{#if a && b}}x{{/if}}", { dialect: "maxbars" });
  assert.ok(ast.ast, `expected an AST, got ${JSON.stringify(ast)}`);
  assert.equal(ast.ast.nodes[0].t, "if");
});

test("advertises the maxbars-dialect capability", async () => {
  const r = await createRenderer("maxbars");
  assert.ok(r.engineInfo().features.includes("maxbars-dialect"));
});

test("a parse error is thrown as a located render error", async () => {
  const r = await createRenderer();
  assert.throws(() => run(r, "{{ oops", {}), (e) => {
    assert.equal(e.kind, "render");
    assert.match(e.message, /1:1:/); // line:column from the engine diagnostics
    return true;
  });
});

test("engineInfo advertises an honest capability vector", async () => {
  const r = await createRenderer("fullbars");
  const info = r.engineInfo();
  assert.match(info.version, /\d+\.\d+/);
  assert.ok(Array.isArray(info.features));
  // backs (exactly, from the lowered AST): catalog, used-transformers,
  // required-assigns, partial-graph; plus source maps + the context inspector
  // (ADR-035) on the surface.
  for (const has of ["catalog", "used-transformers", "required-assigns", "partial-graph", "source-map", "context-inspect"]) {
    assert.ok(info.features.includes(has), `should advertise ${has}`);
  }
  // not backed → those panels gate off honestly.
  for (const absent of ["bytecode-wire", "standalone"]) {
    assert.ok(!info.features.includes(absent), `should not advertise ${absent}`);
  }
  assert.ok(info.builtins.includes("each") && info.builtins.includes("json"));
});

test("compileToJs emits a JS module (the compile-js feature)", async () => {
  const r = await createRenderer("fullbars");
  assert.equal(typeof r.compileToJs, "function");
  assert.ok(r.engineInfo().features.includes("compile-js"));
  const c = r.compileToJs("Hello {{ name }}!");
  assert.ok(c.ok, c.error);
  assert.match(c.value, /flatbars-compiled/);
  assert.match(c.value, /export default function/);
});

test("lint flags a deprecated alias and is surface-scoped (the lint feature)", async () => {
  const r = await createRenderer("fullbars");
  assert.equal(typeof r.lint, "function");
  assert.ok(r.engineInfo().features.includes("lint"));
  // a deprecated alias (`plus` for `add`) — flagged in every dialect.
  const aliased = r.lint('{{ plus a b }}', "maxbars");
  assert.ok(aliased.ok, aliased.error);
  assert.equal(aliased.findings.length, 1);
  assert.match(aliased.findings[0].message, /add/);
  // findings locate the offending NAME, not the tag start (Lint panel click-to-jump):
  // "{{ plus a b }}" → `plus` is at column 4 (after "{{ ").
  assert.equal(aliased.findings[0].line, 1);
  assert.equal(aliased.findings[0].column, 4);
  // a non-canonical scoped variable (`index` for `index0`) — flagged in maxbars
  // (native), but NOT in the FullBars surface where {{@index}} is canonical.
  const scoped = "{{#each xs}}{{ index }}{{/each}}";
  assert.ok(r.lint(scoped, "maxbars").findings.length >= 1, "maxbars flags `index`");
  assert.equal(r.lint(scoped, "fullbars").findings.length, 0, "fullbars does not");
  // a clean template reports zero findings.
  assert.equal(r.lint("{{ name }}", "fullbars").findings.length, 0);
});

test("migrate rewrites Handlebars to MaxBars with a residual report (the migrate feature)", async () => {
  const r = await createRenderer("fullbars");
  assert.equal(typeof r.migrate, "function");
  assert.ok(r.engineInfo().features.includes("migrate"));
  // an inverted section migrates to {{#unless}}.
  const m = r.migrate("{{^done}}todo{{/done}}");
  assert.ok(m.ok, m.error);
  assert.match(m.source, /\{\{#unless done\}\}todo\{\{\/unless\}\}/);
  assert.ok(Array.isArray(m.residuals));
});

test("analyze reports a truthiness portability finding (the analyse feature)", async () => {
  const r = await createRenderer("fullbars");
  assert.equal(typeof r.analyze, "function");
  assert.ok(r.engineInfo().features.includes("analyse"));
  // an empty string in a condition diverges (falsy in handlebars/mustache.js,
  // truthy under the spec/Ruby Mustache rule and the others).
  const a = r.analyze({ source: "{{#if bio}}x{{/if}}" }, { bio: "" });
  assert.ok(a.ok, a.error);
  assert.match(a.report, /1 observed/);
  assert.match(a.report, /data path: `bio`/);
  // the report legend distinguishes mustache.js (= the engine rule) from spec Mustache.
  assert.match(a.report, /mustache\.js/);
  assert.match(a.jsonata, /"bio": bio = "" \? null : bio/);
  // structured findings drive the Truthiness dock panel.
  assert.equal(a.findings.length, 1);
  const f = a.findings[0];
  assert.equal(f.kind, "observed");
  assert.equal(f.line, 1);
  assert.equal(f.tag, "{{#if bio}}");
  assert.equal(f.path, "bio");
  assert.deepEqual(f.flips, ["mustache-spec", "minimal", "presence"]);
  assert.match(f.value, /empty string/);
  assert.match(f.fix, /ne s/);
  // false agrees under every rule — no finding.
  const b = r.analyze({ source: "{{#if ok}}x{{/if}}" }, { ok: false });
  assert.match(b.report, /0 observed/);
  assert.equal(b.findings.length, 0);
  // ADR-030 symbolic what-if: count=5 is portable as observed, but the same-type
  // ambiguous `0` it could hold is flagged as a *potential* finding — coverage that
  // does not depend on the sample.
  const c = r.analyze({ source: "{{#if count}}x{{else}}y{{/if}}" }, { count: 5 });
  assert.match(c.report, /1 potential finding/);
  const pot = c.findings.find((x) => x.kind === "potential");
  assert.ok(pot, "a potential finding is present");
  assert.equal(pot.path, "count");
  assert.match(pot.value, /the number `0`/);
  // ADR-030 path schema: a host predicate ruling out the path suppresses the
  // potential what-if (the count is never the ambiguous `0`).
  const schema = (path /*, value */) => path !== "count";
  const d = r.analyzeWith(schema, { source: "{{#if count}}x{{else}}y{{/if}}" }, { count: 5 });
  assert.match(d.report, /0 potential/);
  assert.equal(d.findings.filter((x) => x.kind === "potential").length, 0);
  // ADR-030 #4: a bare path absent from a present object is an advisory miss.
  const m = r.analyze({ source: "{{user.naem}}" }, { user: { name: "Ada" } });
  const miss = m.findings.find((x) => x.kind === "miss");
  assert.ok(miss, "a miss finding is present for the typo'd path");
  assert.equal(miss.path, "user.naem");
  // the host schema suppresses a known-optional miss.
  const m2 = r.analyzeWith((p) => p !== "user.naem", { source: "{{user.naem}}" }, { user: { name: "Ada" } });
  assert.equal(m2.findings.filter((x) => x.kind === "miss").length, 0);
});

test("the catalog entries have the cheat-sheet shape", async () => {
  const r = await createRenderer("fullbars");
  for (const e of r.catalog()) {
    for (const f of ["name", "category", "arity", "summary", "example"]) {
      assert.ok(f in e, `catalog entry missing ${f}`);
    }
  }
});

test("parseAst returns the {t:…} node shape", async () => {
  const r = await createRenderer("fullbars");
  const { ast } = r.parseAst("<h1>{{ name }}</h1>{{#each items}}{{ this }}{{/each}}");
  assert.equal(ast.version, "flatbars-ast/v1");
  const kinds = ast.nodes.map((n) => n.t);
  assert.deepEqual(kinds, ["text", "emit", "text", "each"]);
  const emit = ast.nodes[1];
  assert.equal(emit.expr.t, "path");
  assert.deepEqual(emit.expr.segments, ["name"]);
});

test("parseAst nodes carry their source span (Data Access jump-to-source)", async () => {
  // Regression: the lowered-AST JSON used to omit `src`, so the Data Access
  // panel fell back to line 1, column 1 for every lookup. Each tag-derived
  // node must now report the code-unit range of its opening tag.
  const r = await createRenderer("fullbars");
  const src = "<h1>{{ name }}</h1>{{#each items}}{{ this }}{{/each}}";
  const { ast } = r.parseAst(src);
  const emit = ast.nodes[1];
  assert.deepEqual(emit.src, { start: 4, end: 14 });
  assert.equal(src.slice(emit.src.start, emit.src.end), "{{ name }}");
  const each = ast.nodes[3];
  assert.deepEqual(each.src, { start: 19, end: 34 });
  assert.equal(src.slice(each.src.start, each.src.end), "{{#each items}}");
  // …and into block bodies: the scoped `{{ this }}` keeps its own span.
  assert.deepEqual(each.body[0].src, { start: 34, end: 44 });
  // Literal text nodes are not tags and carry no span.
  assert.equal(ast.nodes[0].t, "text");
  assert.equal(ast.nodes[0].src, undefined);
});

test("parseAst is forgiving: a parse error yields a recovered tree + located errors", async () => {
  const r = await createRenderer("fullbars");
  const res = r.parseAst("{{#each xs}}…"); // unclosed block
  // ADR-023: the AST view never blanks — it returns the best-effort tree…
  assert.ok(res.ast && Array.isArray(res.ast.nodes), "expected a recovered AST tree");
  // …plus the located errors (the same set `diagnostics` reports).
  assert.ok(Array.isArray(res.errors) && res.errors.length > 0, "expected located errors");
  assert.equal(typeof res.errors[0].message, "string");
  assert.equal(typeof res.errors[0].line, "number");
});

test("requiredAssigns is exact (path roots only, no helpers/params)", async () => {
  const r = await createRenderer("fullbars");
  const prog = r.compile(
    '{{ title }}{{#each rows as |row|}}{{ row.id }} {{ city.name }}{{/each}}{{#if (eq a b)}}{{ a }}{{/if}}',
    {},
  ).program;
  // `rows`, `city`, `a`, `b` are data; `row` is a block param (a call, excluded);
  // `eq`/`each`/`if` are helpers (excluded).
  assert.deepEqual(r.requiredAssigns(prog), ["a", "b", "city", "rows", "title"]);
});

test("usedTransformers collects block + call helpers (the used-transformers feature)", async () => {
  const r = await createRenderer("fullbars");
  assert.ok(r.engineInfo().features.includes("used-transformers"));
  const prog = r.compile("{{#each xs}}{{#if (eq a b)}}{{ x }}{{/if}}{{/each}}", {}).program;
  const used = r.usedTransformers(prog);
  assert.ok(used.includes("each") && used.includes("if") && used.includes("eq"));
});

test("parseAst surfaces partial uses and inline defs as semantic nodes", async () => {
  const r = await createRenderer("fullbars");
  const { ast } = r.parseAst('{{#*inline "row"}}<li>{{ this }}</li>{{/inline}}{{> row}}{{> missing}}');
  const top = ast.nodes;
  const inline = top.find((n) => n.t === "inline");
  assert.equal(inline && inline.name, "row");
  const partials = top.filter((n) => n.t === "partial").map((n) => n.name);
  assert.deepEqual(partials, ["row", "missing"]);
});

test("named partial documents render (multi-document)", async () => {
  const r = await createRenderer("fullbars");
  // the host passes partial documents to compile; render registers them.
  const prog = r.compile("<nav>{{> nav}}</nav>{{ title }}", { nav: "[home]" }).program;
  assert.equal(r.render(prog, { title: "T" }), "<nav>[home]</nav>T");
});

test("inline-defined partials actually render", async () => {
  const r = await createRenderer("fullbars");
  const out = run(r, '{{#*inline "row"}}[{{ this }}]{{/inline}}{{#each xs}}{{> row}}{{/each}}', { xs: ["a", "b"] });
  assert.equal(out, "[a][b]");
});

test("partialGraph builds a real dependency graph natively (the partial-graph feature)", async () => {
  const r = await createRenderer("fullbars");
  assert.ok(r.engineInfo().features.includes("partial-graph"));
  // main → header, main → body, body → header — drawn from the lowered AST's
  // `{t:"partial"}` nodes across every document.
  const prog = r.compile("{{> header}}{{> body}}", { header: "H", body: "{{> header}}" }).program;
  const g = r.partialGraph(prog);
  const ids = g.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["body", "header", "main"]);
  const edge = (from, to) => g.edges.some((e) => e.from === from && e.to === to);
  assert.ok(edge("main", "header") && edge("main", "body") && edge("body", "header"));
  assert.deepEqual(g.cycles, []);
  // a referenced-but-undefined partial surfaces as a missing node.
  const prog2 = r.compile("{{> gone}}", {}).program;
  const g2 = r.partialGraph(prog2);
  assert.ok(g2.nodes.some((n) => n.id === "gone" && n.missing));
});

// the source-map segments must tile the output: contiguous from 0, every len > 0,
// covering exactly [0, output.length).
const tilesExactly = (output, segments) => {
  let at = 0;
  for (const s of segments) {
    if (s.out !== at || s.len <= 0) return false;
    at += s.len;
  }
  return at === output.length;
};

test("source map: a mapped surface render returns segments that tile the output (the source-map feature)", async () => {
  const r = await createRenderer("fullbars");
  assert.ok(r.engineInfo().features.includes("source-map"));
  const prog = r.compile("<b>{{ name }}</b>{{#each xs}}[{{ this }}]{{/each}}").program;
  const { output, segments } = r.render(prog, { name: "Ada", xs: ["a", "b"] }, { map: true });
  assert.equal(output, "<b>Ada</b>[a][b]");
  assert.ok(tilesExactly(output, segments), "segments tile the output exactly");
  // the {{ name }} emit links to its tag span (offsets are JS string indices).
  const emits = segments.filter((s) => s.kind === "emit" && s.start != null);
  assert.ok(emits.some((s) => s.start === 3 && s.end === 13), "{{ name }} carries its tag span");
  // every run is tagged with the entry template, so the host links to its tab.
  assert.ok(segments.every((s) => s.file === "main"), "runs are tagged file=main");
  // both loop iterations of {{ this }} point at the same source tag.
  const thisEnds = emits.filter((s) => s.start === 30).map((s) => s.end);
  assert.deepEqual(thisEnds, [40, 40], "both {{ this }} iterations share the tag span");
  // text runs carry no source span.
  assert.ok(segments.every((s) => s.kind !== "text" || (s.start == null && s.end == null)));
});

test("source map: partials tile, and partial-origin emits link to their own document", async () => {
  const r = await createRenderer("fullbars");
  const prog = r.compile("{{#each xs}}{{> row}}{{/each}}", { row: "<li>{{ this }}</li>" }).program;
  const { output, segments } = r.render(prog, { xs: ["x", "y"] }, { map: true });
  assert.equal(output, "<li>x</li><li>y</li>");
  assert.ok(tilesExactly(output, segments), "segments tile the output exactly");
  // the {{ this }} emits originate in the `row` partial: they carry its file + tag
  // span (the file dimension, ADR-035), so the UI links into the row document.
  const emits = segments.filter((s) => s.kind === "emit");
  assert.ok(emits.length >= 1);
  assert.ok(emits.every((s) => s.file === "row" && s.start != null), "partial emits link to the row document");

  // an inline-defined partial indexes the entry template (where it is written).
  const inlineProg = r.compile('{{#*inline "item"}}[{{ this }}]{{/inline}}{{> item}}', {}).program;
  const inlineOut = r.render(inlineProg, "z", { map: true });
  assert.ok(inlineOut.segments.some((s) => s.kind === "emit" && s.file === "main" && s.start != null));
});

test("source map: the core and maxbars dialects also emit tiling segments", async () => {
  // core (RawBars): a triple-stache emit links to its tag; the map tiles.
  const core = await createRenderer("rawbars");
  assert.ok(core.engineInfo().features.includes("source-map"));
  const c = core.render(core.compile("Hi {{{ this }}}!").program, "Ada", { map: true });
  assert.equal(c.output, "Hi Ada!");
  assert.ok(tilesExactly(c.output, c.segments));
  assert.ok(c.segments.some((s) => s.kind === "emit" && s.start != null && s.file === "main"));

  // maxbars: an each over a pipe expression tiles, every run tagged file=main.
  const max = await createRenderer("maxbars");
  assert.ok(max.engineInfo().features.includes("source-map"));
  const m = max.render(max.compile("{{#each xs}}[{{ this }}]{{/each}}").program, { xs: ["a", "b"] }, { map: true });
  assert.equal(m.output, "[a][b]");
  assert.ok(tilesExactly(m.output, m.segments));
  assert.ok(m.segments.every((s) => s.file === "main"));
});

test("source map: MinBars (logic-less) has no source map", async () => {
  const r = await createRenderer("minbars");
  assert.ok(!r.engineInfo().features.includes("source-map"));
  // {{.}} is Mustache's implicit iterator (renders the string context verbatim).
  assert.deepEqual(r.render(r.compile("{{.}}").program, "x", { map: true }), { output: "x", segments: [] });
});

// the source span of the first linkable emit, used to drive the inspector.
const firstEmitTarget = (r, prog, data) => {
  const { segments } = r.render(prog, data, { map: true });
  return segments.find((s) => s.kind === "emit" && s.start != null);
};

test("context inspector: per-execution snapshots of the render context (context-inspect)", async () => {
  const r = await createRenderer("fullbars");
  assert.ok(r.engineInfo().features.includes("context-inspect"));
  const prog = r.compile("{{#each xs}}<b>{{ this }}</b>{{/each}}").program;
  const data = { xs: ["a", "b"], top: "T" };
  const snaps = r.inspectAt(prog, data, firstEmitTarget(r, prog, data));
  assert.equal(snaps.length, 2, "one snapshot per loop iteration");
  assert.deepEqual(snaps.map((s) => s.this), ["a", "b"]);
  assert.deepEqual(snaps.map((s) => s.index), [0, 1]);
  assert.equal(snaps[0].first, true);
  assert.equal(snaps[1].last, true);
  assert.deepEqual(snaps[0].root, data);
});

test("context inspector: block params surface as locals", async () => {
  const r = await createRenderer("fullbars");
  const prog = r.compile("{{#each xs as |item|}}[{{ item }}]{{/each}}").program;
  const snaps = r.inspectAt(prog, { xs: ["x"] }, firstEmitTarget(r, prog, { xs: ["x"] }));
  assert.deepEqual(snaps[0].locals, { item: "x" });
});

test("context inspector: the maxbars dialect snapshots too", async () => {
  const r = await createRenderer("maxbars");
  assert.ok(r.engineInfo().features.includes("context-inspect"));
  const prog = r.compile("{{#each xs}}[{{ this }}]{{/each}}").program;
  const snaps = r.inspectAt(prog, { xs: ["x", "y"] }, firstEmitTarget(r, prog, { xs: ["x", "y"] }));
  assert.deepEqual(snaps.map((s) => s.this), ["x", "y"]);
  assert.deepEqual(snaps.map((s) => s.index), [0, 1]);
});

test("context inspector: the core dialect snapshots too", async () => {
  const r = await createRenderer("rawbars");
  assert.ok(r.engineInfo().features.includes("context-inspect"));
  // core: bare names are helper calls, so iterate via an explicit lookup.
  const prog = r.compile('{{#each (lookup this "xs")}}[{{{ this }}}]{{/each}}').program;
  const data = { xs: ["a", "b"] };
  const snaps = r.inspectAt(prog, data, firstEmitTarget(r, prog, data));
  assert.deepEqual(snaps.map((s) => s.this), ["a", "b"]);
});

test("context inspector: MinBars (logic-less) gates off (unsupported)", async () => {
  const r = await createRenderer("minbars");
  assert.ok(!r.engineInfo().features.includes("context-inspect"));
  assert.throws(
    () => r.inspectAt(r.compile("{{.}}").program, "x", { file: "main", start: 0, end: 1 }),
    (e) => e.kind === "unsupported",
  );
});

// ── MinBars (Mustache) ───────────────────────────────────────────────────────

const minrun = (r, src, data, opts) => r.render(r.compile(src).program, data, opts);

test("createRenderer('minbars') dispatches the Mustache engine (logic-less)", async () => {
  const r = await createRenderer("minbars");
  const info = r.engineInfo();
  assert.deepEqual(info.features, ["partials", "catalog", "compile-js", "analyse"]);
  assert.deepEqual(r.allTransformers(), []); // Mustache has no helper registry
  // the AST-analysis panels gate off (no lowered-AST seam): empty, not thrown.
  assert.deepEqual(r.partialGraph(), { nodes: [], edges: [], cycles: [] });
  assert.deepEqual(r.usedTransformers(), []);
});

test("createRenderer('minbars') analyses truthiness portability (the analyse feature)", async () => {
  const r = await createRenderer("minbars");
  // A section over count=0 renders under mustache-spec but would skip under
  // mustache.js (handlebars rule) — a portability finding (ADR-022).
  const flagged = r.analyze({ source: "{{#count}}c{{/count}}" }, { count: 0 });
  assert.equal(flagged.ok, true);
  assert.equal(flagged.findings.length, 1);
  assert.ok(flagged.findings[0].flips.includes("handlebars"));
  // A boolean section is portable (no ambiguous instance), so no finding.
  const clean = r.analyze({ source: "{{#flag}}c{{/flag}}" }, { flag: true });
  assert.equal(clean.findings.length, 0);
});

test("MinBars renders the language-agnostic Mustache (spec) rule by default — 0/'' truthy", async () => {
  const r = await createRenderer("minbars");
  const tpl = "{{#n}}has{{/n}}{{^n}}none{{/n}}";
  assert.equal(minrun(r, tpl, { n: 0 }), "has");
  assert.equal(minrun(r, "{{#s}}has{{/s}}{{^s}}none{{/s}}", { s: "" }), "has");
});

test("MinBars compat mode renders mustache.js truthiness — 0 and '' are falsy", async () => {
  const r = await createRenderer("minbars");
  assert.equal(minrun(r, "{{#n}}has{{/n}}{{^n}}none{{/n}}", { n: 0 }, { compat: true }), "none");
  assert.equal(minrun(r, "{{#s}}has{{/s}}{{^s}}none{{/s}}", { s: "" }, { compat: true }), "none");
  // a non-empty / non-zero value is truthy under both rules
  assert.equal(minrun(r, "{{#n}}has{{/n}}{{^n}}none{{/n}}", { n: 5 }, { compat: true }), "has");
  // {} stays truthy and [] stays falsy in both rules — only the "ambiguous two" flip
  assert.equal(minrun(r, "{{#o}}y{{/o}}{{^o}}n{{/o}}", { o: {} }, { compat: true }), "y");
  assert.equal(minrun(r, "{{#xs}}y{{/xs}}{{^xs}}n{{/xs}}", { xs: [] }, { compat: true }), "n");
});

test("MinBars compat is also fixable at construction (createRenderer('minbars', { compat }))", async () => {
  const r = await createRenderer("minbars", { compat: true });
  // the construction default applies without a per-call flag…
  assert.equal(minrun(r, "{{#n}}has{{/n}}{{^n}}none{{/n}}", { n: 0 }), "none");
  // …and a per-call option still overrides it.
  assert.equal(minrun(r, "{{#n}}has{{/n}}{{^n}}none{{/n}}", { n: 0 }, { compat: false }), "has");
});

test("MinBars compat mode honors partials", async () => {
  const r = await createRenderer("minbars");
  const prog = r.compile("{{#n}}{{> row}}{{/n}}{{^n}}none{{/n}}", { row: "R" }).program;
  assert.equal(r.render(prog, { n: 0 }, { compat: true }), "none"); // 0 falsy → inverted
  assert.equal(r.render(prog, { n: 1 }, { compat: true }), "R"); // truthy → partial renders
});

test("MinBars compileToJs seeds the chosen truthiness rule", async () => {
  const r = await createRenderer("minbars");
  const spec = r.compileToJs("{{#n}}has{{/n}}");
  assert.ok(spec.ok, spec.error);
  assert.match(spec.value, /truthyMustache/);
  const compat = r.compileToJs("{{#n}}has{{/n}}", undefined, { compat: true });
  assert.ok(compat.ok, compat.error);
  assert.match(compat.value, /truthyHandlebars/);
});
