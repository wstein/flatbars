// SPDX-License-Identifier: Apache-2.0
//
// The compiler conformance harness — the gate that keeps the two execution
// paths from drifting. For every case it renders with the INTERPRETER
// (FullBars.renderWith, the executable spec) and with the COMPILED function
// (FlatBars.Compile → JS, run against the runtime) and asserts byte-identical
// output. Sources: the inline corpus (conformance/cases.mjs) + the golden
// examples/ (core templates).
//
// Engine functions are imported from `output/` (the spago build product), so the
// harness always tests current source — not a possibly-stale bundle. Run:
//
//   npm run test:compile        # spago build && node packages/compile/conformance.mjs
//
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cases as corpus } from "./conformance/cases.mjs";
import rt from "./runtime/flatbars-runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const enginePath = resolve(root, "output/FullBars.JS/index.js");
if (!existsSync(enginePath)) {
  console.error("error: " + enginePath + " not found — run `spago build` first (npm run test:compile does).");
  process.exit(2);
}
const { compile, compileSurface, compileMaxbars, compileMinbars, compileMinbarsCompat, compileMinbarsWithPartials, render, renderSurface, renderMaxbars, renderMinbars, renderMinbarsCompat, renderMustache, renderWith, renderRawWith, renderMaxWith, renderSurfaceI18n, safe } =
  await import(enginePath);

// Pick the interpreter/compiler pair for a case's dialect: "surface" (FullBars),
// "maxbars" (FullBars + infix/pipes/loop vars), "minbars" (Mustache, spec
// truthiness), "minbars-compat" (Mustache under mustache.js' 0/"" -falsy rule), or
// core. The compat pair gates that the mustache.js render and compile agree too.
const interpreterFor = (dialect) =>
  dialect === "surface" ? renderSurface
    : dialect === "maxbars" ? renderMaxbars
    : dialect === "minbars" ? renderMinbars
    : dialect === "minbars-compat" ? renderMinbarsCompat
    : render;
const compilerFor = (dialect) =>
  dialect === "surface" ? compileSurface
    : dialect === "maxbars" ? compileMaxbars
    : dialect === "minbars" ? compileMinbars
    : dialect === "minbars-compat" ? compileMinbarsCompat
    : compile;

// Render with the interpreter (the spec), in the case's dialect. A `minbars`
// case with `partials` uses the MinBars + partials interpreter (renderMustache).
// Helper/operation cases route by dialect: FullBars `renderWith` (helper),
// RawBars `renderRawWith` / MaxBars `renderMaxWith` (operation — ADR-019 addendum).
const renderWithFor = (dialect) =>
  dialect === "rawbars" ? renderRawWith
    : dialect === "maxbars" ? renderMaxWith
    : renderWith;
const interpret = (t, d, dialect, partials, helpers, translator) =>
  translator ? renderSurfaceI18n(translator, t, d == null ? null : d)
    : helpers ? renderWithFor(dialect)(helpers, partials || {}, t, d == null ? null : d)
    : (dialect === "minbars" && partials) ? renderMustache(partials, t, d == null ? null : d)
    : interpreterFor(dialect)(t, d == null ? null : d);

// Compile then execute against the runtime: -> { ok, value, error }. Custom-helper
// cases (ADR-018) register their helpers on the runtime first, then compile as
// surface — the same names route through `rt.call` → the registry.
async function runCompiled(t, d, dialect, partials, helpers, translator) {
  // ADR-029: seed (or clear) the host translator on the runtime so the compiled
  // i18n ops consult the same brain the interpreter does — the wired seam path.
  rt.registerTranslator(translator || null);
  if (helpers) {
    for (const [n, f] of Object.entries(helpers)) {
      const fn = typeof f === "function" ? f : f.fn; // a bag value is fn or { fn, arity }
      rt.register(n, fn, typeof f === "function" ? undefined : f.arity);
    }
  }
  const c = helpers ? compilerFor(dialect)(t)
    : (dialect === "minbars" && partials) ? compileMinbarsWithPartials(partials, t) : compilerFor(dialect)(t);
  if (!c.ok) return { ok: false, value: "", error: "compile: " + c.error };
  try {
    const mod = await import("data:text/javascript," + encodeURIComponent(c.value));
    return { ok: true, value: mod.default(d == null ? null : d, rt), error: "" };
  } catch (e) {
    return { ok: false, value: "", error: "runtime: " + (e && e.message ? e.message : String(e)) };
  }
}

// Collect cases: the inline corpus + every examples/*/ (core templates).
function exampleCases() {
  const dir = resolve(root, "examples");
  return readdirSync(dir)
    .filter((n) => existsSync(resolve(dir, n, "template.hbs")))
    .map((n) => ({
      name: "example:" + n,
      t: readFileSync(resolve(dir, n, "template.hbs"), "utf8"),
      d: JSON.parse(readFileSync(resolve(dir, n, "data.json"), "utf8")),
    }));
}
// User-defined helper cases (ADR-018): exercise the interpreter (renderWith) and
// the compiled path (rt.register + rt.call) for the same helper, asserting they
// agree. `expect` pins the actual value too, so the gate catches a bug that the
// two paths might share. Covers escaping, raw triple, `safe`, numbers,
// subexpressions, and hash args.
const up = (s) => String(s).toUpperCase();
const helperCases = [
  { name: "helper:escaped", dialect: "surface", helpers: { loud: up }, t: "{{loud x}}", d: { x: "<b>ada" }, expect: "&lt;B&gt;ADA" },
  { name: "helper:raw-triple", dialect: "surface", helpers: { loud: up }, t: "{{{loud x}}}", d: { x: "<b>" }, expect: "<B>" },
  { name: "helper:safe", dialect: "surface", helpers: { wrap: (s) => safe("<i>" + s + "</i>") }, t: "{{wrap x}}", d: { x: "hi" }, expect: "<i>hi</i>" },
  { name: "helper:number", dialect: "surface", helpers: { inc: (n) => n + 1 }, t: "{{inc n}}", d: { n: 41 }, expect: "42" },
  { name: "helper:subexpr", dialect: "surface", helpers: { loud: up }, t: "{{#if (loud x)}}Y{{else}}N{{/if}}", d: { x: "a" }, expect: "Y" },
  { name: "helper:hash", dialect: "surface", helpers: { tag: (n, o) => "<" + n + (o && o.cls ? " class=" + o.cls : "") + ">" }, t: "{{{tag x cls=\"hi\"}}}", d: { x: "div" }, expect: "<div class=hi>" },
  // a declared-arity helper, called correctly, renders the same both ways
  { name: "helper:arity-ok", dialect: "surface", helpers: { loud: { fn: up, arity: 1 } }, t: "{{loud x}}", d: { x: "<b>" }, expect: "&lt;B&gt;" },
  // ARITY-MISMATCH equivalence: both paths must REJECT, with the same arity text.
  // This is the one place the interpreter "errors" on purpose, so it is gated via
  // `expectError` (a substring), not the value-equality path — and it is what
  // pins the two render-path arity-text copies (JS.js + the runtime) together.
  { name: "helper:arity-mismatch", dialect: "surface", helpers: { loud: { fn: up, arity: 1 } }, t: "{{loud x y}}", d: { x: "a", y: "b" }, expectError: "expected exactly 1 argument(s), got 2" },
  // ── ADR-020 block (section) helpers — usage decides; options.fn/inverse ──────
  // Each must render identically in the interpreter (callJsBlockHelperImpl) and
  // the compiled path (rt.block → callUserBlock). The block return is RAW.
  { name: "block:simple", dialect: "surface", helpers: { bold: (options) => safe("<b>" + options.fn() + "</b>") }, t: "{{#bold}}hi{{/bold}}", d: {}, expect: "<b>hi</b>" },
  { name: "block:context-shift", dialect: "surface", helpers: { list: (items, options) => safe("<ul>" + items.map((i) => "<li>" + options.fn(i) + "</li>").join("") + "</ul>") }, t: "{{#list people}}{{name}}{{/list}}", d: { people: [{ name: "Ada" }, { name: "Lin" }] }, expect: "<ul><li>Ada</li><li>Lin</li></ul>" },
  { name: "block:this", dialect: "surface", helpers: { bold: function (options) { return safe("<b>" + options.fn(this) + "</b>"); } }, t: "{{#bold}}{{name}}{{/bold}}", d: { name: "Ada" }, expect: "<b>Ada</b>" },
  { name: "block:inverse", dialect: "surface", helpers: { ifAny: (xs, options) => (xs.length ? options.fn() : options.inverse()) }, t: "{{#ifAny xs}}some{{else}}none{{/ifAny}}", d: { xs: [] }, expect: "none" },
  { name: "block:zero-renders", dialect: "surface", helpers: { hide: () => "" }, t: "{{#hide}}secret{{/hide}}", d: {}, expect: "" },
  { name: "block:n-renders", dialect: "surface", helpers: { twice: (options) => options.fn() + options.fn() }, t: "{{#twice}}x{{/twice}}", d: {}, expect: "xx" },
  // A context-shifting user block INSIDE a loop: scoped vars (@index) from the
  // enclosing frame must be inherited identically by both render paths.
  { name: "block:inherits-scope", dialect: "surface", helpers: { wrap: (x, options) => options.fn(x) }, t: "{{#each rows}}{{#wrap this}}{{@index}}={{label}} {{/wrap}}{{/each}}", d: { rows: [{ label: "a" }, { label: "b" }] }, expect: "0=a 1=b " },
  // ADR-020 Phase 2: a helper SUPPLIES scoped @vars via options.fn(ctx, { data }) —
  // both standard (@index/@first) and would-be custom keys layer over the scope.
  { name: "block:supplies-data", dialect: "surface", helpers: { idx: (items, options) => items.map((x, i) => options.fn(x, { data: { index: i, first: i === 0 } })).join("") }, t: "{{#idx items}}{{@index}}{{#if @first}}*{{/if}}:{{label}} {{/idx}}", d: { items: [{ label: "a" }, { label: "b" }] }, expect: "0*:a 1:b " },
  // ADR-020 Phase 3: options.hash (surface k=v), block params (as |…|), and both
  // together with data — routed through the @hash/@param channel, identical both paths.
  { name: "block:hash", dialect: "surface", helpers: { link: (text, o) => safe('<a class="' + o.hash.cls + '">' + text + "</a>") }, t: '{{#link "Home" cls="nav"}}body{{/link}}', d: {}, expect: '<a class="nav">Home</a>' },
  { name: "block:params", dialect: "surface", helpers: { list: (xs, o) => safe(xs.map((x, i) => o.fn(x, { blockParams: [x, i] })).join("")) }, t: "{{#list xs as |item idx|}}[{{idx}}:{{item}}]{{/list}}", d: { xs: ["a", "b"] }, expect: "[0:a][1:b]" },
  { name: "block:hash-params-data", dialect: "surface", helpers: { rows: (xs, o) => safe(xs.map((x, i) => o.fn(x, { blockParams: [x], data: { index: i } })).join(o.hash.sep)) }, t: '{{#rows xs sep=", " as |row|}}{{@index}}={{row}}{{/rows}}', d: { xs: ["a", "b"] }, expect: "0=a, 1=b" },
  // ── ADR-019 addendum — host-registered block OPERATIONS for RawBars/MaxBars ──
  // The operation marshaller (jsOperation) and the runtime are shared, so the same
  // interpreter/compiled equivalence must hold over the RawBars (strict, core
  // syntax) and MaxBars (lenient, infix/pipe surface) dialects too.
  // RawBars: core syntax (explicit `lookup this`), fn/inverse + options.fn(ctx,{data});
  // no hash / block params (there is no surface to write them).
  { name: "op:raw-simple", dialect: "rawbars", helpers: { wrap: (o) => safe("[" + o.fn() + "]") }, t: "{{#wrap}}{{{lookup this \"x\"}}}{{/wrap}}", d: { x: "hi" }, expect: "[hi]" },
  { name: "op:raw-context-shift", dialect: "rawbars", helpers: { list: (items, o) => safe(items.map((i) => o.fn(i)).join("")) }, t: "{{#list (lookup this \"items\")}}{{{lookup this \"name\"}}}{{/list}}", d: { items: [{ name: "a" }, { name: "b" }] }, expect: "ab" },
  { name: "op:raw-inverse", dialect: "rawbars", helpers: { ifAny: (xs, o) => (xs.length ? o.fn() : o.inverse()) }, t: "{{#ifAny (lookup this \"xs\")}}y{{else}}n{{/ifAny}}", d: { xs: [] }, expect: "n" },
  // a block operation SUPPLIES scoped data; in core a scoped var is just an operation name.
  { name: "op:raw-data", dialect: "rawbars", helpers: { rows: (items, o) => safe(items.map((x, i) => o.fn(x, { data: { index: i } })).join("")) }, t: "{{#rows (lookup this \"items\")}}{{{index}}}:{{{lookup this \"label\"}}} {{/rows}}", d: { items: [{ label: "a" }, { label: "b" }] }, expect: "0:a 1:b " },
  // MaxBars: full surface MINUS block params — fn/inverse + options.hash + options.fn(ctx,{data}).
  { name: "op:max-hash", dialect: "maxbars", helpers: { box: (xs, o) => safe('<ul class="' + o.hash.cls + '">' + xs.map((p) => o.fn(p)).join("") + "</ul>") }, t: '{{#box xs cls="r"}}<li>{{this}}</li>{{/box}}', d: { xs: ["a", "b"] }, expect: '<ul class="r"><li>a</li><li>b</li></ul>' },
  // a block operation supplying scoped @data is a FullBars feature (MaxBars dropped
  // the @ namespace, ADR-021); the MaxBars equivalent supplies block params, see
  // op:max-params below.
  { name: "op:fb-data", dialect: "surface", helpers: { idx: (items, o) => items.map((x, i) => o.fn(x, { data: { index: i, first: i === 0 } })).join("") }, t: "{{#idx items}}{{@index}}{{#if @first}}*{{/if}}:{{label}} {{/idx}}", d: { items: [{ label: "a" }, { label: "b" }] }, expect: "0*:a 1:b " },
  { name: "op:max-inverse", dialect: "maxbars", helpers: { ifAny: (xs, o) => (xs.length ? o.fn() : o.inverse()) }, t: "{{#ifAny xs}}y{{else}}n{{/ifAny}}", d: { xs: [] }, expect: "n" },
  // a MaxBars-distinctive infix expression inside a block-operation body — proves the
  // MaxBars surface (not FullBars) is what compiles/interprets.
  { name: "op:max-infix", dialect: "maxbars", helpers: { wrap: (o) => safe("[" + o.fn() + "]") }, t: "{{#wrap}}{{1 + 2}}{{/wrap}}", d: {}, expect: "[3]" },
  // block params now parse in MaxBars (the head ladder omits the pipe rung), so a
  // block operation can bind them via options.fn(ctx, { blockParams }).
  { name: "op:max-params", dialect: "maxbars", helpers: { list: (xs, o) => safe(xs.map((x, i) => o.fn(x, { blockParams: [x, i] })).join("")) }, t: "{{#list xs as |item idx|}}[{{idx}}:{{item}}]{{/list}}", d: { xs: ["a", "b"] }, expect: "[0:a][1:b]" },
  // a parenthesised pipe in the head coexists with block params — both render paths agree.
  { name: "op:max-paren-pipe-params", dialect: "maxbars", helpers: { box: (xs, o) => safe(xs.map((x) => o.fn(x, { blockParams: [x] })).join("")) }, t: "{{#box (xs | reverse) as |x|}}<i>{{x}}</i>{{/box}}", d: { xs: ["a", "b", "c"] }, expect: "<i>c</i><i>b</i><i>a</i>" },
  // ── Raw blocks {{{{name}}}} — the verbatim body is handed to the head helper via
  //    options.fn(); the inner {{x}} is NEVER interpreted (loud upper-cases the raw
  //    text, so `{{x}}` comes out `{{X}}`). Both render paths must agree, and the
  //    head resolves STRICTLY — an undefined head is UnknownHelper in every dialect,
  //    never an implicit section (the strict-raw-block rule).
  { name: "rawblock:surface", dialect: "surface", helpers: { loud: (o) => o.fn().toUpperCase() }, t: "{{{{loud}}}}hi {{x}}{{{{/loud}}}}", d: { x: "ada" }, expect: "HI {{X}}" },
  { name: "rawblock:max", dialect: "maxbars", helpers: { loud: (o) => o.fn().toUpperCase() }, t: "{{{{#loud}}}}hi {{x}}{{{{/loud}}}}", d: { x: "ada" }, expect: "HI {{X}}" },
  { name: "rawblock:raw", dialect: "rawbars", helpers: { loud: (o) => o.fn().toUpperCase() }, t: "{{{{#loud}}}}hi {{x}}{{{{/loud}}}}", d: { x: "ada" }, expect: "HI {{X}}" },
  // undefined head: both the interpreter and the compiled output must REJECT.
  { name: "rawblock:undefined-surface", dialect: "surface", t: "{{{{nope}}}}body {{x}}{{{{/nope}}}}", d: { x: "a" }, expectError: "UnknownHelper" },
  { name: "rawblock:undefined-max", dialect: "maxbars", t: "{{{{#nope}}}}body {{x}}{{{{/nope}}}}", d: { x: "a" }, expectError: "UnknownHelper" },
];
const allCases = [...corpus, ...exampleCases(), ...helperCases];

let pass = 0, fail = 0;
const fails = [];
for (const { name, t, d, dialect, partials, helpers, translator, expect, expectError } of allCases) {
  const spec = interpret(t, d, dialect, partials, helpers, translator);
  const got = await runCompiled(t, d, dialect, partials, helpers, translator);
  // `expectError`: both paths must fail, each reporting the same diagnostic text
  // (e.g. the arity message) — gates the interpreter/compiled error agreement.
  if (expectError !== undefined) {
    const bothReject = !spec.ok && !got.ok && spec.error.includes(expectError) && got.error.includes(expectError);
    if (bothReject) pass++;
    else { fail++; fails.push({ name, spec: spec.ok ? `OK ${spec.value}` : spec.error, got: got.ok ? `OK ${got.value}` : got.error, ok: false }); }
    continue;
  }
  if (!spec.ok) {
    // The interpreter itself errored — not a compiler conformance case.
    console.log(`  ?    ${name} — interpreter errored: ${spec.error}`);
    continue;
  }
  // `expect` (when present) pins correctness; the equality check pins equivalence.
  const correct = expect === undefined || spec.value === expect;
  if (correct && got.ok && got.value === spec.value) {
    pass++;
  } else {
    fail++;
    fails.push({ name, spec: correct ? spec.value : `${spec.value} (expected ${expect})`, got: got.ok ? got.value : got.error, ok: got.ok && correct });
  }
}

for (const f of fails) {
  console.log(`\n  FAIL ${f.name}`);
  console.log(`       interpreter: ${JSON.stringify(f.spec)}`);
  console.log(`       compiled:    ${f.ok ? JSON.stringify(f.got) : "ERROR " + f.got}`);
}

console.log(`\n${pass}/${pass + fail} cases conform (compiled === interpreter)`);
process.exit(fail === 0 ? 0 : 1);
