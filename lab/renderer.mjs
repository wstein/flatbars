// SPDX-License-Identifier: Apache-2.0
//
// The FlatBars Lab renderer — ONE factory over every FlatBars-family engine.
// `createRenderer(dialect, opts)` returns the ADR-0020 seam object (render,
// compile, parseAst, inspectAt, usedTransformers, requiredAssigns, partialGraph,
// allTransformers, catalog, engineInfo, version — plus the FlatBars tooling:
// analyze, analyzeWith, lint, migrate, compileToJs), so the host wires every
// engine through the identical contract and the capability gate hides whatever a
// dialect doesn't back.
//
//   createRenderer("rawbars" | "core")     → the austere meaning-free core
//   createRenderer("classicbars" | "surface") → the Handlebars-flavoured surface (default)
//   createRenderer("maxbars")              → ClassicBars + infix operators / pipes / bare loop vars
//   createRenderer("minbars" | "mustache", { compat }) → Mustache (logic-less)
//
// All four are the PureScript `flatbars-js` engine compiled to JS — no WASM. The
// bundle is `vendor/flatbars-engine.mjs` (regenerate with `npm run gen:bundle`,
// bump the `?v=` below). This unifies the former stem.mjs / flatbars.mjs /
// minbars.mjs adapters into one seam after the Stem WASM engine was dropped.

import {
  // FlatBars (core / surface / maxbars) render paths
  render as bbRender,
  renderSurface as bbRenderSurface,
  renderSurfaceWithPartials as bbRenderSurfaceWith,
  renderMaxbars as bbRenderMaxbars,
  renderMaxbarsWithPartials as bbRenderMaxbarsWith,
  renderWith as bbRenderWith,
  renderRawWith as bbRenderRawWith,
  renderMaxWith as bbRenderMaxWith,
  renderSurfaceI18n as bbRenderSurfaceI18n,
  renderSurfaceMapped as bbRenderSurfaceMapped,
  renderSurfaceMappedWithPartials as bbRenderSurfaceMappedWith,
  renderMapped as bbRenderMapped,
  renderMappedWithPartials as bbRenderMappedWith,
  renderMaxbarsMapped as bbRenderMaxbarsMapped,
  renderMaxbarsMappedWithPartials as bbRenderMaxbarsMappedWith,
  inspectSurface as bbInspectSurface,
  inspect as bbInspect,
  inspectMaxbars as bbInspectMaxbars,
  // FlatBars AST + compile + tooling
  astJson,
  compile as bbCompile,
  compileSurface as bbCompileSurface,
  compileMaxbars as bbCompileMaxbars,
  compileMaxbarsWithPartials as bbCompileMaxbarsWith,
  analyze as bbAnalyze,
  analyzeWith as bbAnalyzeWith,
  analyzeMinbars as bbAnalyzeMinbars,
  lint as bbLint,
  migrate as bbMigrate,
  // MinBars (Mustache) render + compile paths
  renderMustache as bbRenderMustache,
  renderMinbarsCompat as bbRenderMinbarsCompat,
  renderMinbarsCompatWithPartials as bbRenderMinbarsCompatWith,
  renderMinbarsMapped as bbRenderMinbarsMapped,
  renderMinbarsMappedWithPartials as bbRenderMinbarsMappedWith,
  renderMinbarsMappedCompat as bbRenderMinbarsMappedCompat,
  renderMinbarsMappedCompatWithPartials as bbRenderMinbarsMappedCompatWith,
  inspectMinbars as bbInspectMinbars,
  inspectMinbarsCompat as bbInspectMinbarsCompat,
  compileMinbars as bbCompileMinbars,
  compileMinbarsWithPartials as bbCompileMinbarsWithPartials,
  compileMinbarsCompat as bbCompileMinbarsCompat,
  compileMinbarsCompatWithPartials as bbCompileMinbarsCompatWith,
} from "./vendor/flatbars-engine.mjs?v=149";

import { buildDependencyGraph } from "./playground_utils.mjs";

const VERSION = "0.1.0";

// The mapped (source-map) render entrypoints per FlatBars dialect (ADR-035): the
// dialects that emit segments. A dialect absent here advertises no `source-map`
// and its provenance UI gates off.
const MAPPED = {
  core: { plain: bbRenderMapped, withPartials: bbRenderMappedWith },
  surface: { plain: bbRenderSurfaceMapped, withPartials: bbRenderSurfaceMappedWith },
  maxbars: { plain: bbRenderMaxbarsMapped, withPartials: bbRenderMaxbarsMappedWith },
};

// The context-inspector entrypoint per FlatBars dialect (ADR-035): `(partials,
// target, source, data) -> { ok, snapshots, error }`. A dialect absent here
// advertises no `context-inspect` and its inspector gates off.
const INSPECT = {
  core: bbInspect,
  surface: bbInspectSurface,
  maxbars: bbInspectMaxbars,
};

// Map a UI/param dialect name to the engine's internal dialect, or `null` for an
// unrecognised value. `rawbars`→"core", `classicbars`→"surface", `mustache`→"minbars";
// `maxbars`/`minbars` are their own engine entrypoints.
function normalizeDialect(d) {
  if (d === "maxbars" || d === "core" || d === "surface" || d === "minbars") return d;
  if (d === "rawbars") return "core";
  if (d === "classicbars") return "surface";
  if (d === "mustache") return "minbars";
  return null;
}

// The active dialect default, from `?dialect=` (the header dialect toggle sets
// this param); defaults to the Handlebars-flavoured surface.
const DIALECT = (() => {
  if (typeof location === "undefined") return "surface";
  return normalizeDialect(new URLSearchParams(location.search).get("dialect")) ?? "surface";
})();

// engine-features/v1 capability vector — the FlatBars dialects. FlatBars backs
// rendering, a static helper catalog (→ Transformers panel), EXACT used-transformers
// and data-access (→ Transformers / Data Access panels — the lowered AST is precise,
// not heuristic like Handlebars), and an EXACT partial graph (→ Partials panel;
// {{> name}}/{{#inline}} surface as `partial` AST nodes). The core / surface /
// maxbars dialects back provenance (`source-map`) and the Context Inspector
// (`context-inspect`) — both added per-dialect in engineInfo; MinBars backs both
// through its own mapped/inspect path (see MIN_FEATURES).
const BB_FEATURES = [
  "catalog",
  "used-transformers",
  "required-assigns",
  "partial-graph",
  "compile-js", // FlatBars-only: compile the template to a JS module (Compiled JS view)
  "analyse", // ADR-022: trace a render, report truthiness portability (Truthiness view)
  "lint", // ADR-019: deprecated-alias + non-canonical scoped-variable warnings (Lint panel)
  "migrate", // Handlebars → MaxBars source rewrite, with a residual report (Migrated view)
  "surface-dialect", // {{ }} auto-escape, paths, @data, else/elif (Handlebars-flavoured)
  "core-dialect", // the austere meaning-free core syntax
  "maxbars-dialect", // ClassicBars + infix operators, pipes, bare loop variables
];

// engine-features/v1 for MinBars: it renders + has (Mustache) partials + a catalog
// + a JS compiler (ADR-016) + truthiness analysis (`analyse`, ADR-022 — the
// Mustache-portability story: where would `mustache.js` branch the other way?) +
// the partial-dependency graph (`partial-graph`) + data access (`required-assigns`,
// over the lowered MinBars AST) + a source map (`source-map`, ADR-035 — the mapped
// render MinBars now emits) + the Context Inspector (`context-inspect`, snapshotting
// the context stack at a clicked span). MinBars now backs every diagnostic panel
// (the compat-rule source map is the one tracked follow-up).
const MIN_FEATURES = ["partials", "catalog", "compile-js", "analyse", "partial-graph", "required-assigns", "source-map", "context-inspect"];

// The prelude helpers, with the metadata the cheat-sheet panel renders. The
// user-facing subset of the single-source helper catalog.
const BB_CATALOG = [
  { name: "if", category: "logic", arity: "block", summary: "Render the block when the argument is truthy; supports {{elif}} / {{else}} clauses.", example: "{{#if active}}on{{elif other}}alt{{else}}off{{/if}}" },
  { name: "unless", category: "logic", arity: "block", summary: "The inverse of if.", example: "{{#unless done}}todo{{/unless}}" },
  { name: "each", category: "collections", arity: "block", summary: "Iterate an array or object; @index/@key/@first/@last (and @../index) in scope. MaxBars adds bare loop vars: index0/index1/rindex0/rindex1/length (aliases index/rindex/size).", example: "{{#each items}}{{ this }}{{/each}}" },
  { name: "with", category: "access", arity: "block", summary: "Shift context into the argument for the block.", example: "{{#with user}}{{ name }}{{/with}}" },
  { name: "local", category: "access", arity: "block", summary: "Bounded binding: block-scoped aliases (name=value) for the body without re-rooting the context — sequential, RawBars/MaxBars (ADR-024, renamed from `let` by docs-17).", example: "{% local total=(add a b) %}{{ total }}{% endlocal %}" },
  { name: "lookup", category: "access", arity: "inline", summary: "Variadic path lookup; the target of surface path desugaring.", example: "{{{ lookup this \"a\" \"b\" }}}" },
  { name: "eq", category: "logic", arity: "inline", summary: "Value equality ⇒ boolean. Also ne/lt/gt/lte/gte, and/or/not.", example: "{{#if (eq a b)}}…{{/if}}" },
  { name: "escapeHtml", category: "output", arity: "inline", summary: "HTML-escape a value (idempotent on safe values).", example: "{{{ escapeHtml x }}}" },
  { name: "safe", category: "output", arity: "inline", summary: "Mark a value as trusted markup (no escaping).", example: "{{{ safe html }}}" },
  { name: "json", category: "output", arity: "inline", summary: "Serialize a value as JSON text; pretty=true indents.", example: "{{{ json this pretty=true }}}" },
  { name: "escapeJson", category: "output", arity: "inline", summary: "JSON + HTML-escape (for embedding in HTML).", example: "{{{ escapeJson this }}}" },
  { name: "dict", category: "data", arity: "inline", summary: "Build an object from key/value pairs (target of hash args).", example: "{{#if n (dict \"includeZero\" true)}}…{{/if}}" },
  { name: "bind", category: "data", arity: "inline", summary: "A one-key object — the RawBars `{% local (bind \"name\" value) %}` binding form (ADR-024/docs-17).", example: "{% local (bind \"total\" (add a b)) %}{{{ total }}}{% endlocal %}" },
  { name: "partial", category: "composition", arity: "inline", summary: "Render a registered partial; block form gives a fallback + {{> @partial-block}}.", example: "{{> nav user}}" },
  { name: "list", category: "collections", arity: "inline", summary: "Build an array from its arguments — the MaxBars […] list-literal helper.", example: "{{#each [\"a\", \"b\", \"c\"]}}{{this}}{{/each}}" },
  { name: "range", category: "collections", arity: "inline", summary: "The inclusive integer range [a, b] as an array (the basis for counted loops); capped to keep a huge range from hanging.", example: "{{#each (range 1 count)}}{{ loop.index1 }}{{/each}}" },
];

// The Mustache constructs (tag *forms* — Mustache has no helpers).
const MIN_CATALOG = [
  { name: "{{name}}", category: "interpolation", arity: "inline", summary: "Interpolate a name (HTML-escaped); {{{name}}} / {{&name}} are raw. Resolves up the context stack with parent fallback; {{.}} is the implicit iterator.", example: "Hello {{name}}!" },
  { name: "#section", category: "sections", arity: "block", summary: "Polymorphic section: render once per array element (pushed), once for a truthy non-list, or never for a falsy value (false/null/[]).", example: "{{#items}}{{.}}{{/items}}" },
  { name: "^inverted", category: "sections", arity: "block", summary: "Render the block only when the value is falsy (false/null/empty list).", example: "{{^items}}none{{/items}}" },
  { name: ">partial", category: "composition", arity: "inline", summary: "Include a partial, rendered against the current context stack and re-indented when standalone. {{>* name}} resolves the partial name from context.", example: "{{> item}}" },
  { name: "<parent", category: "inheritance", arity: "block", summary: "Expand a parent template, overriding its {{$blocks}}. {{<*name}} resolves the parent name from context.", example: "{{<base}}{{$title}}Home{{/title}}{{/base}}" },
  { name: "$block", category: "inheritance", arity: "block", summary: "An overridable region: renders its default unless an enclosing parent overrides it.", example: "{{$title}}default{{/title}}" },
  { name: "!comment", category: "meta", arity: "inline", summary: "A comment — dropped from output. Standalone comment lines are stripped.", example: "{{! ignored }}" },
];

// ── The factory ──────────────────────────────────────────────────────────────

export async function createRenderer(dialectArg, opts = {}) {
  // No async init — the engine is synchronous JS. The async signature keeps the
  // host's `await createRenderer(...)` call site uniform with the old adapters.
  const dialect = normalizeDialect(dialectArg) ?? DIALECT;
  return dialect === "minbars" ? minbarsRenderer(opts) : flatbarsRenderer(dialect, opts);
}

// ── FlatBars (core / surface / maxbars) ──────────────────────────────────────

function flatbarsRenderer(activeDialect, _opts) {
  // `program` is opaque to the host: source + active dialect + named partial
  // documents (+ optional user helpers / translator, surface only).
  function compile(source, partials = {}, opts = {}) {
    const dialect = normalizeDialect(opts.dialect) ?? activeDialect;
    return { program: { source, dialect, partials: partials || {}, helpers: opts.helpers || null, translator: opts.translator || null } };
  }

  function render(program, data, { map = false, policy } = {}) {
    if (policy != null) {
      const err = new Error("FlatBars has no render-time { allow, eval } policy");
      err.kind = "unsupported-policy";
      throw err;
    }
    const d = data == null ? {} : data;
    const hasPartials = program.partials && Object.keys(program.partials).length > 0;
    const hasHelpers = program.helpers && Object.keys(program.helpers).length > 0;
    let res;
    if (program.translator) {
      // ADR-029: localization wires the first-class translator seam — surface
      // render with `t`/`number`/`date`/… driven by the host translator.
      res = bbRenderSurfaceI18n(program.translator, program.source, d);
    } else if (program.dialect === "core") {
      res = hasHelpers
        ? bbRenderRawWith(program.helpers, program.partials || {}, program.source, d)
        : hasPartials
          ? bbRenderRawWith({}, program.partials, program.source, d)
          : bbRender(program.source, d);
    } else if (program.dialect === "maxbars") {
      res = hasHelpers
        ? bbRenderMaxWith(program.helpers, program.partials || {}, program.source, d)
        : hasPartials
          ? bbRenderMaxbarsWith(program.partials, program.source, d)
          : bbRenderMaxbars(program.source, d);
    } else if (hasHelpers) {
      res = bbRenderWith(program.helpers, program.partials || {}, program.source, d);
    } else {
      res = hasPartials
        ? bbRenderSurfaceWith(program.partials, program.source, d)
        : bbRenderSurface(program.source, d);
    }
    if (!res.ok) {
      const err = new Error(res.error);
      err.kind = "render";
      throw err;
    }
    if (!map) return res.value;
    // Attach a source map where the engine backs it (ADR-035): the core / surface /
    // maxbars dialects without host helpers or a translator (the mapped renders
    // thread neither). Other paths tile no map, so the render falls back to an empty
    // `segments` and the provenance UI gates off.
    const mapped = !program.translator && !hasHelpers ? MAPPED[program.dialect] : null;
    if (mapped) {
      const m = hasPartials
        ? mapped.withPartials(program.partials, program.source, d)
        : mapped.plain(program.source, d);
      // Each run carries its own `file` ("main" or a partial name; ADR-035), which
      // the provenance UI reads to pick the editor tab (tabIndexByFile) — so a
      // partial-origin emit links into its own partial document.
      if (m.ok) return { output: m.output, segments: m.segments };
    }
    return { output: res.value, segments: [] };
  }

  // Analyse mode (ADR-022 Part B): render + report the truthiness decisions that
  // would branch differently on another engine.
  function analyze(program, data) {
    return bbAnalyze(program.source, data == null ? {} : data);
  }
  // ADR-030: `analyze` with a host path schema `schema(path, value) => boolean`.
  function analyzeWith(schema, program, data) {
    return bbAnalyzeWith(schema, program.source, data == null ? {} : data);
  }
  // Canonicalization lint (ADR-019): deprecated-alias + non-canonical scoped-variable
  // warnings for the active dialect. The facade keys on the UI dialect name.
  function lint(source, dialect) {
    const internal = normalizeDialect(dialect) ?? activeDialect;
    const ui = internal === "core" ? "rawbars" : internal === "surface" ? "classicbars" : internal;
    return bbLint(source, ui);
  }
  // Handlebars → MaxBars source migration (ADR; the `migrate` feature).
  function migrate(source) {
    return bbMigrate(source);
  }

  // parseAst returns the lowered AST in the host's {t:…} node shape (or {error}).
  function parseAst(source, opts = {}) {
    return astJson(normalizeDialect(opts.dialect) ?? activeDialect, source);
  }

  // compile-js: compile the template to a JS ES module via FlatBars.Compile.
  function compileToJs(source, partials) {
    const ps = partials && Object.keys(partials).length > 0 ? partials : null;
    if (activeDialect === "maxbars") return ps ? bbCompileMaxbarsWith(ps, source) : bbCompileMaxbars(source);
    if (activeDialect === "core") return bbCompile(source);
    return bbCompileSurface(source);
  }

  // ── static analyses over the lowered AST ──
  function walk(nodes, visit) {
    for (const node of nodes || []) {
      visit(node);
      for (const key of ["then", "else", "body"]) {
        if (Array.isArray(node[key])) walk(node[key], visit);
      }
    }
  }
  function walkExpr(expr, visit) {
    if (!expr || typeof expr !== "object") return;
    visit(expr);
    if (expr.t === "call") for (const a of expr.args || []) walkExpr(a.value, visit);
  }
  function eachExpr(node, fn) {
    if (node.t === "emit") fn(node.expr);
    if (node.cond) fn(node.cond);
    if (node.subject) fn(node.subject);
    if (Array.isArray(node.args)) for (const a of node.args) fn(a.value);
  }
  function nodesOf(program) {
    const parsed = astJson(program.dialect, program.source);
    return parsed.ast ? parsed.ast.nodes : [];
  }

  // required-assigns (EXACT): the root of every `{t:"path"}`. Helpers are explicit
  // calls and block params are `(param)` calls, so neither leaks in.
  function requiredAssigns(program) {
    const out = new Set();
    walk(nodesOf(program), (node) =>
      eachExpr(node, (e) => walkExpr(e, (x) => {
        if (x.t === "path" && x.segments && x.segments.length) out.add(x.segments[0]);
      })),
    );
    return [...out].sort();
  }
  // used-transformers: block-helper node types + every `{t:"call"}` head.
  function usedTransformers(program) {
    const names = new Set();
    const STRUCTURAL = new Set(["text", "emit", "sep", "raw"]);
    walk(nodesOf(program), (node) => {
      if (["if", "unless", "each", "with"].includes(node.t)) names.add(node.t);
      else if (node.t && !STRUCTURAL.has(node.t)) names.add(node.t);
      eachExpr(node, (e) => walkExpr(e, (x) => { if (x.t === "call" && x.name) names.add(x.name); }));
    });
    return [...names].sort();
  }
  // partial-graph (EXACT): the lowered AST surfaces every `{{> name}}` as a
  // `{t:"partial"}` node, so the host's dependency-graph builder maps it directly.
  function partialGraph(program) {
    const asts = {};
    const main = astJson(program.dialect, program.source);
    asts.main = main.ast ? main.ast.nodes : [];
    for (const [name, src] of Object.entries(program.partials || {})) {
      const p = astJson(program.dialect, src);
      asts[name] = p.ast ? p.ast.nodes : [];
    }
    return buildDependencyGraph(asts);
  }

  // context-inspect (ADR-035): snapshot the render context at a clicked output
  // run's source span, per execution. The core / surface / maxbars dialects back
  // it; MinBars advertises it off and never reaches here.
  function inspectAt(program, data, target) {
    const fn = INSPECT[activeDialect];
    if (!fn) {
      const err = new Error("The context inspector is not available for this dialect");
      err.kind = "unsupported";
      throw err;
    }
    const res = fn(program.partials || {}, target, program.source, data == null ? {} : data);
    if (!res.ok) {
      const err = new Error(res.error);
      err.kind = "render";
      throw err;
    }
    return res.snapshots;
  }

  function allTransformers() { return BB_CATALOG.map((e) => e.name); }
  function catalog() { return BB_CATALOG; }
  function engineInfo() {
    // The core / surface / maxbars dialects back source maps (ADR-035), lighting
    // up the provenance UI; a dialect without a mapped entrypoint advertises it off.
    // The ClassicBars surface also backs the Context Inspector (`context-inspect`).
    const features = MAPPED[activeDialect] ? [...BB_FEATURES, "source-map"] : [...BB_FEATURES];
    if (INSPECT[activeDialect]) features.push("context-inspect");
    return { version: VERSION, builtins: allTransformers(), features };
  }

  return {
    render, analyze, analyzeWith, lint, migrate, compile, parseAst, inspectAt,
    usedTransformers, requiredAssigns, partialGraph, allTransformers, catalog,
    compileToJs, engineInfo, version: VERSION,
  };
}

// ── MinBars (Mustache) ───────────────────────────────────────────────────────

function minbarsRenderer(opts) {
  // `compat` selects the `mustache.js` truthiness rule (`0`/`""` falsy) instead of
  // MinBars' language-agnostic spec default (`0`/`""` truthy) — ADR-022 S2. It can
  // be fixed at construction (createRenderer("minbars", { compat })) and overridden
  // per render call (the Lab's MinBars truthiness toggle threads it per `run()`).
  const defaultCompat = !!opts.compat;

  function compile(source, partials = {}, _opts = {}) {
    return { program: { source, partials: partials || {} } };
  }

  function render(program, data, { map = false, policy, compat = defaultCompat } = {}) {
    if (policy != null) {
      const err = new Error("MinBars has no render-time { allow, eval } policy (Mustache is logic-less)");
      err.kind = "unsupported-policy";
      throw err;
    }
    const partials = program.partials || {};
    const d = data == null ? null : data;
    const hasPartials = Object.keys(partials).length > 0;
    // Source map (ADR-035): the mapped path tiles the output under the SAME
    // truthiness rule the render uses, so it tracks the compat toggle (the Lab's
    // MinBars default is mustache.js-compat). The spec/compat rules render different
    // sections, so the segments must match the output shown.
    if (map) {
      const plain = compat ? bbRenderMinbarsMappedCompat : bbRenderMinbarsMapped;
      const withP = compat ? bbRenderMinbarsMappedCompatWith : bbRenderMinbarsMappedWith;
      const mp = hasPartials ? withP(partials, program.source, d) : plain(program.source, d);
      if (mp.ok) return { output: mp.output, segments: mp.segments };
      const e = new Error(mp.error); e.kind = "render"; throw e;
    }
    const res = compat
      ? (hasPartials ? bbRenderMinbarsCompatWith(partials, program.source, d) : bbRenderMinbarsCompat(program.source, d))
      : bbRenderMustache(partials, program.source, d);
    if (res.ok) return map ? { output: res.value, segments: [] } : res.value;
    const err = new Error(res.error);
    err.kind = "render";
    throw err;
  }

  // compile-js (ADR-016): `{{> p}}` is inlined; recursive/dynamic partials and
  // dynamic-name parents compile-reject with a clear error (slice limitation).
  function compileToJs(source, partials, { compat = defaultCompat } = {}) {
    const hasPartials = partials && Object.keys(partials).length;
    if (compat) {
      return hasPartials ? bbCompileMinbarsCompatWith(partials, source) : bbCompileMinbarsCompat(source);
    }
    return hasPartials ? bbCompileMinbarsWithPartials(partials, source) : bbCompileMinbars(source);
  }

  // Truthiness analysis (ADR-022): the Mustache-portability story. MinBars renders
  // on the language-agnostic `mustache-spec` rule, so a finding marks exactly where
  // `mustache.js` (the `handlebars` rule, `0`/`""` falsy) would branch the other
  // way. Same `AnalyseResult` shape as the FlatBars dialects, so the Truthiness
  // panel is engine-agnostic. (No `analyzeWith` — the host path-schema is a
  // FlatBars/ADR-030 concern; the Lab falls back to `analyze`.)
  function analyze(program, data) {
    return bbAnalyzeMinbars(program.source, data == null ? {} : data);
  }

  // The lowered MinBars AST (flatbars-ast/v1): parse the Mustache surface and lower
  // it to the core operation tree (`section`/`inverted`/`mlookup`/`partial`). This
  // is the real tree — the foundation a Mustache→FlatBars/MaxBars migration reads,
  // what the Partials panel walks for `{{> name}}` (a `{t:"partial"}` node), and
  // what the Data Access panel reads as `mlookup` lookups.
  function parseAst(source) { return astJson("minbars", source); }

  // context-inspect (ADR-035): snapshot the context stack at a target span (from a
  // source-map segment). Mustache binds no loop vars, so each snapshot reports only
  // the context chain (this/parent/root). The truthiness rule must match the one the
  // source map used (the target span came from it), so `opts.compat` (the Lab's
  // MinBars rule) picks the inspector. `inspectAt(program, data, target, opts)`.
  function inspectAt(program, data, target, { compat = defaultCompat } = {}) {
    const fn = compat ? bbInspectMinbarsCompat : bbInspectMinbars;
    const r = fn(program.partials || {}, target, program.source, data == null ? null : data);
    if (!r.ok) { const e = new Error(r.error); e.kind = "inspect"; throw e; }
    return r.snapshots;
  }

  // partial-graph (EXACT): every `{{> name}}` lowers to a `{t:"partial"}` node, so
  // the shared dependency-graph builder maps it directly — the same path the
  // FlatBars dialects take, over the MinBars AST.
  function partialGraph(program) {
    const asts = { main: astJson("minbars", program.source).ast?.nodes || [] };
    for (const [name, src] of Object.entries(program.partials || {})) {
      asts[name] = astJson("minbars", src).ast?.nodes || [];
    }
    return buildDependencyGraph(asts);
  }

  // required-assigns: the root key of every data read in the ROOT scope. MinBars
  // lowers reads to `mlookup("a.b")` calls (head = `a`); a `section` pushes a new
  // context, so reads inside its body are NOT root assigns, while an `inverted`
  // body keeps the root scope. Mirrors the ClassicBars `requiredAssigns` over the
  // MinBars AST (the same scoping `analyseDataAccess` applies).
  function requiredAssigns(program) {
    const out = new Set();
    const visitExpr = (e) => {
      if (!e || typeof e !== "object" || e.t !== "call") return;
      if (e.name === "mlookup") {
        const lit = e.args && e.args[0] && e.args[0].value;
        if (lit && lit.t === "lit" && typeof lit.value === "string" && lit.value !== "" && lit.value !== ".")
          out.add(lit.value.split(".")[0]);
      } else for (const a of e.args || []) visitExpr(a.value);
    };
    const visit = (nodes, scoped) => {
      for (const n of nodes || []) {
        if (n.t === "emit") { if (!scoped) visitExpr(n.expr); }
        else if (n.t === "section" || n.t === "inverted") {
          if (!scoped) visitExpr(n.args && n.args[0] && n.args[0].value);
          visit(n.body, n.t === "section" ? true : scoped);
        }
      }
    };
    visit(astJson("minbars", program.source).ast?.nodes || [], false);
    return [...out].sort();
  }
  const noUses = () => [];

  function allTransformers() { return []; }
  function catalog() { return MIN_CATALOG; }
  function engineInfo() { return { version: VERSION, builtins: [], features: MIN_FEATURES }; }

  return {
    render, compile, compileToJs, analyze, parseAst, partialGraph, requiredAssigns, inspectAt,
    usedTransformers: noUses,
    allTransformers, catalog, engineInfo, version: VERSION,
  };
}
