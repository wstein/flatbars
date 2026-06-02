// SPDX-License-Identifier: Apache-2.0
//
// FlatBars adapter — backs the lab's three FlatBars dialect engines (RawBars /
// FullBars / MaxBars), selected by the dialect argument to
// `createFlatBarsRenderer()`. Like stem.mjs and minbars.mjs it returns the SAME
// seam shape (render, compile, parseAst, inspectAt, usedTransformers,
// requiredAssigns, partialGraph, allTransformers, catalog, engineInfo, version),
// so the host wires it through the identical contract and the capability gate
// hides whatever FlatBars doesn't (yet) back.
//
// FlatBars is a PureScript engine compiled to JS — no WASM. The engine is the
// `flatbars-js` facade, bundled to `vendor/flatbars-engine.mjs` (regenerate with
//   spago bundle -p flatbars-js --module FullBars.JS \
//     --bundle-type module --platform browser --outfile vendor/flatbars-engine.mjs
// ). It renders the **surface** dialect by default — the Handlebars-compatible
// layer (paths, `{{ }}` auto-escape, `@data`, `else`/`elif`) — which is the
// right basis for cross-engine comparison; the austere **core** dialect is an
// option (the FlatBars-specific control, surfaced in Phase 2).
//
// Supported: render (core + surface dialects, `?dialect=`), the lowered AST
// (parseAst), data-access (required-assigns), the helper catalog, and the
// partial graph (multi-document partials). The generic rt.block fallback for
// exotic block helpers and `inspectAt` are not yet implemented, so those
// features are not advertised and the matching panels gate off.

import {
  render as bbRender,
  renderSurface as bbRenderSurface,
  renderSurfaceWithPartials as bbRenderSurfaceWith,
  renderMaxbars as bbRenderMaxbars,
  astJson,
  compile as bbCompile,
  compileSurface as bbCompileSurface,
  compileMaxbars as bbCompileMaxbars,
  renderWith as bbRenderWith,
} from "./vendor/flatbars-engine.mjs?v=14";

const BB_VERSION = "0.1.0";

// Map a UI/param dialect name to the engine's internal dialect, or `null` for an
// unrecognised value. `rawbars`→"core", `fullbars`→"surface", `maxbars` is its
// own engine entrypoint (FullBars + infix operators, pipes, bare loop variables).
function normalizeDialect(d) {
  if (d === "maxbars" || d === "core" || d === "surface") return d;
  if (d === "rawbars") return "core";
  if (d === "fullbars") return "surface";
  return null;
}

// The active dialect, from `?dialect=` (the header dialect toggle sets this
// param); defaults to the Handlebars-flavoured surface.
const DIALECT = (() => {
  if (typeof location === "undefined") return "surface";
  return normalizeDialect(new URLSearchParams(location.search).get("dialect")) ?? "surface";
})();

// engine-features/v1 capability vector. FlatBars backs rendering, a static helper
// catalog (→ Transformers panel), exact data-access (→ Data Access panel — the
// surface dialect desugars every bare path to `lookup`), and a partial graph
// (→ Partials panel; {{> name}}/{{#inline}} surface as partial nodes). AST-only
// Stem features (standalone-whitespace, provenance, …) stay absent, gated off.
const BB_FEATURES = [
  "catalog",
  "required-assigns",
  "partial-graph",
  "compile-js", // FlatBars-only: compile the template to a JS module (Compiled JS view)
  "surface-dialect", // {{ }} auto-escape, paths, @data, else/elif (Handlebars-flavoured)
  "core-dialect", // the austere meaning-free core syntax
  "maxbars-dialect", // FullBars + infix operators, pipes, bare loop variables
];

// The prelude helpers, with the metadata the cheat-sheet panel renders (mirrors
// Stem.Transformers.Catalog.entries / HB_CATALOG). Generated single source is
// `docs/.../helper-catalog.adoc`; this is the user-facing subset.
const BB_CATALOG = [
  { name: "if", category: "logic", arity: "block", summary: "Render the block when the argument is truthy; supports {{elif}} / {{else}} clauses.", example: "{{#if active}}on{{elif other}}alt{{else}}off{{/if}}" },
  { name: "unless", category: "logic", arity: "block", summary: "The inverse of if.", example: "{{#unless done}}todo{{/unless}}" },
  { name: "each", category: "collections", arity: "block", summary: "Iterate an array or object; @index/@key/@first/@last (and @../index) in scope. MaxBars adds bare loop vars: index0/index1/rindex0/rindex1/length (aliases index/rindex/size).", example: "{{#each items}}{{ this }}{{/each}}" },
  { name: "with", category: "access", arity: "block", summary: "Shift context into the argument for the block.", example: "{{#with user}}{{ name }}{{/with}}" },
  { name: "lookup", category: "access", arity: "inline", summary: "Variadic path lookup; the target of surface path desugaring.", example: "{{{ lookup this \"a\" \"b\" }}}" },
  { name: "eq", category: "logic", arity: "inline", summary: "Value equality ⇒ boolean. Also ne/lt/gt/lte/gte, and/or/not.", example: "{{#if (eq a b)}}…{{/if}}" },
  { name: "escapeHtml", category: "output", arity: "inline", summary: "HTML-escape a value (idempotent on safe values).", example: "{{{ escapeHtml x }}}" },
  { name: "safe", category: "output", arity: "inline", summary: "Mark a value as trusted markup (no escaping).", example: "{{{ safe html }}}" },
  { name: "json", category: "output", arity: "inline", summary: "Serialize a value as JSON text; pretty=true indents.", example: "{{{ json this pretty=true }}}" },
  { name: "escapeJson", category: "output", arity: "inline", summary: "JSON + HTML-escape (for embedding in HTML).", example: "{{{ escapeJson this }}}" },
  { name: "dict", category: "data", arity: "inline", summary: "Build an object from key/value pairs (target of hash args).", example: "{{#if n (dict \"includeZero\" true)}}…{{/if}}" },
  { name: "partial", category: "composition", arity: "inline", summary: "Render a registered partial; block form gives a fallback + {{> @partial-block}}.", example: "{{> nav user}}" },
];

export async function createFlatBarsRenderer(dialectArg) {
  // No async init — the engine is synchronous JS. The async signature mirrors the
  // Stem adapter so the host's `await create…()` site stays uniform.
  //
  // The active dialect is fixed by the engine choice: the lab now exposes the
  // three FlatBars dialects as first-class engines (RawBars→"core",
  // FullBars→"surface", MaxBars→"maxbars"), so the host passes the dialect in.
  // Falls back to the `?dialect=` URL default for back-compat / per-call use.
  const activeDialect = normalizeDialect(dialectArg) ?? DIALECT;

  // Map the engine's `{ ok, value, error }` result to the seam's render contract:
  // the string on success, a thrown `{ kind: "render" }` error otherwise.
  function renderResult(res, map) {
    if (res.ok) return map ? { output: res.value, segments: [] } : res.value;
    const err = new Error(res.error);
    err.kind = "render";
    throw err;
  }

  // `program` is opaque to the host: it carries the source, the active dialect,
  // and the named partial documents (the host's multi-document sources).
  function compile(source, partials = {}, opts = {}) {
    // No separate compile step — render reports located parse errors directly.
    // An explicit `opts.dialect` overrides the URL-driven default (used by tests
    // and any host that selects per-call); `rawbars`/`fullbars` are the engine's
    // "core"/"surface". `opts.helpers` is a built `{ name: fn }` bag of
    // user-defined helpers (ADR-018) — surface/FullBars only.
    const dialect = normalizeDialect(opts.dialect) ?? activeDialect;
    return { program: { source, dialect, partials: partials || {}, helpers: opts.helpers || null } };
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
    if (program.dialect === "core") {
      res = bbRender(program.source, d);
    } else if (program.dialect === "maxbars") {
      // MaxBars reuses the FullBars surface pipeline; named external partials are
      // not threaded through its entrypoint, so inline `{{#inline}}` only here.
      res = bbRenderMaxbars(program.source, d);
    } else if (hasHelpers) {
      // Custom helpers (ADR-018) render through the facade's renderWith, which
      // also threads partials — the surface/FullBars path.
      res = bbRenderWith(program.helpers, program.partials || {}, program.source, d);
    } else {
      res = hasPartials
        ? bbRenderSurfaceWith(program.partials, program.source, d)
        : bbRenderSurface(program.source, d);
    }
    return renderResult(res, map);
  }

  // ── AST + static analyses ──────────────────────────────────────────────────
  // parseAst returns the lowered AST in the host's {t:…} node shape (or {error}).
  // The engine facade does the parse+lower+map in PureScript; the analyses below
  // walk that shape, exactly like the Handlebars adapter walks its mapped nodes.

  function parseAst(source, opts = {}) {
    return astJson(normalizeDialect(opts.dialect) ?? activeDialect, source);
  }

  // FlatBars-specific (the `compile-js` feature): compile the template to a JS
  // ES module via FlatBars.Compile, honouring the active dialect. Returns
  // `{ ok, value, error }` — `value` is the JS source. Drives the Compiled JS view.
  function compileToJs(source) {
    const c = activeDialect === "core" ? bbCompile : activeDialect === "maxbars" ? bbCompileMaxbars : bbCompileSurface;
    return c(source);
  }

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

  // Every expression position in a node (the emitted value, a condition/subject,
  // and any call arguments).
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

  // required-assigns (EXACT for FlatBars): the root of every `{t:"path"}` — i.e.
  // every bare/dotted data path. Helpers are explicit calls and block params are
  // `(param)` calls, so neither leaks in (unlike the Handlebars approximation).
  function requiredAssigns(program) {
    const out = new Set();
    walk(nodesOf(program), (node) =>
      eachExpr(node, (e) => walkExpr(e, (x) => {
        if (x.t === "path" && x.segments && x.segments.length) out.add(x.segments[0]);
      })),
    );
    return [...out].sort();
  }

  // used-transformers: block-helper node types (if/unless/each/with + any custom
  // block) and every `{t:"call"}` head.
  function usedTransformers(program) {
    const names = new Set();
    const STRUCTURAL = new Set(["text", "emit", "sep", "raw"]);
    walk(nodesOf(program), (node) => {
      if (["if", "unless", "each", "with"].includes(node.t)) names.add(node.t);
      else if (node.t && !STRUCTURAL.has(node.t)) names.add(node.t); // custom block helper
      eachExpr(node, (e) => walkExpr(e, (x) => { if (x.t === "call" && x.name) names.add(x.name); }));
    });
    return [...names].sort();
  }

  function inspectAt() {
    const err = new Error("FlatBars context inspector is not implemented yet");
    err.kind = "unsupported";
    throw err;
  }
  // partial-graph is not advertised yet (FlatBars partials are `partial` calls,
  // not distinct AST nodes — a Phase-3 mapping), so the Partials panel gates off.
  function partialGraph() { return { nodes: [], edges: [], cycles: [] }; }
  function allTransformers() { return BB_CATALOG.map((e) => e.name); }
  function catalog() { return BB_CATALOG; }
  function engineInfo() {
    return { version: BB_VERSION, builtins: allTransformers(), features: BB_FEATURES };
  }

  return {
    render,
    compile,
    parseAst,
    inspectAt,
    usedTransformers,
    requiredAssigns,
    partialGraph,
    allTransformers,
    catalog,
    compileToJs,
    engineInfo,
    version: BB_VERSION,
  };
}
