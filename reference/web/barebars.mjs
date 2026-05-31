// SPDX-License-Identifier: Apache-2.0
//
// BareBars adapter — the polyglot lab's THIRD engine (Brace Lab). Like stem.mjs
// and handlebars.mjs, `createBareBarsRenderer()` returns the SAME seam shape
// (render, compile, parseAst, inspectAt, usedTransformers, requiredAssigns,
// partialGraph, allTransformers, catalog, engineInfo, version), so the host
// wires it through the identical contract and the capability gate hides whatever
// BareBars doesn't (yet) back.
//
// BareBars is a PureScript engine compiled to JS — no WASM. The engine is the
// `barebars-js` facade, bundled to `vendor/barebars-engine.mjs` (regenerate with
//   spago bundle -p barebars-js --module FullBars.JS \
//     --bundle-type module --platform browser --outfile vendor/barebars-engine.mjs
// ). It renders the **surface** dialect by default — the Handlebars-compatible
// layer (paths, `{{ }}` auto-escape, `@data`, `else`/`elif`) — which is the
// right basis for cross-engine comparison; the austere **core** dialect is an
// option (the BareBars-specific control, surfaced in Phase 2).
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
  astJson,
  compile as bbCompile,
  compileSurface as bbCompileSurface,
} from "./vendor/barebars-engine.mjs";

const BB_VERSION = "0.1.0";

// The active dialect, from `?dialect=` — `rawbars` (the austere core) or
// `fullbars` (default; the Handlebars-flavoured layer). The header dialect
// toggle sets this param. (Internally these are the engine's "core"/"surface".)
const DIALECT = (() => {
  if (typeof location === "undefined") return "surface";
  const d = new URLSearchParams(location.search).get("dialect");
  return d === "core" || d === "rawbars" ? "core" : "surface";
})();

// engine-features/v1 capability vector. BareBars backs rendering, a static helper
// catalog (→ Transformers panel), exact data-access (→ Data Access panel — the
// surface dialect desugars every bare path to `lookup`), and a partial graph
// (→ Partials panel; {{> name}}/{{#inline}} surface as partial nodes). AST-only
// Stem features (standalone-whitespace, provenance, …) stay absent, gated off.
const BB_FEATURES = [
  "catalog",
  "required-assigns",
  "partial-graph",
  "compile-js", // BareBars-only: compile the template to a JS module (Compiled JS view)
  "surface-dialect", // {{ }} auto-escape, paths, @data, else/elif (Handlebars-flavoured)
  "core-dialect", // the austere meaning-free core syntax
];

// The prelude helpers, with the metadata the cheat-sheet panel renders (mirrors
// Stem.Transformers.Catalog.entries / HB_CATALOG). Generated single source is
// `docs/.../helper-catalog.adoc`; this is the user-facing subset.
const BB_CATALOG = [
  { name: "if", category: "logic", arity: "block", summary: "Render the block when the argument is truthy; supports {{elif}} / {{else}} clauses.", example: "{{#if active}}on{{elif other}}alt{{else}}off{{/if}}" },
  { name: "unless", category: "logic", arity: "block", summary: "The inverse of if.", example: "{{#unless done}}todo{{/unless}}" },
  { name: "each", category: "collections", arity: "block", summary: "Iterate an array or object; @index/@key/@first/@last (and @../index) in scope.", example: "{{#each items}}{{ this }}{{/each}}" },
  { name: "with", category: "access", arity: "block", summary: "Shift context into the argument for the block.", example: "{{#with user}}{{ name }}{{/with}}" },
  { name: "lookup", category: "access", arity: "inline", summary: "Variadic path lookup; the target of surface path desugaring.", example: "{{{ lookup this \"a\" \"b\" }}}" },
  { name: "eq", category: "logic", arity: "inline", summary: "Value equality ⇒ boolean. Also ne/lt/gt/lte/gte, and/or/not.", example: "{{#if (eq a b)}}…{{/if}}" },
  { name: "esc_html", category: "output", arity: "inline", summary: "HTML-escape a value (idempotent on safe values).", example: "{{{ esc_html x }}}" },
  { name: "safe", category: "output", arity: "inline", summary: "Mark a value as trusted markup (no escaping).", example: "{{{ safe html }}}" },
  { name: "json", category: "output", arity: "inline", summary: "Serialize a value as JSON text; pretty=true indents.", example: "{{{ json this pretty=true }}}" },
  { name: "esc_json", category: "output", arity: "inline", summary: "JSON + HTML-escape (for embedding in HTML).", example: "{{{ esc_json this }}}" },
  { name: "dict", category: "data", arity: "inline", summary: "Build an object from key/value pairs (target of hash args).", example: "{{#if n (dict \"includeZero\" true)}}…{{/if}}" },
  { name: "partial", category: "composition", arity: "inline", summary: "Render a registered partial; block form gives a fallback + {{> @partial-block}}.", example: "{{> nav user}}" },
];

export async function createBareBarsRenderer() {
  // No async init — the engine is synchronous JS. The async signature mirrors the
  // Stem/Handlebars adapters so the host's `await create…()` site stays uniform.

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
  function compile(source, partials = {}, _opts = {}) {
    // No separate compile step — render reports located parse errors directly.
    return { program: { source, dialect: DIALECT, partials: partials || {} } };
  }

  function render(program, data, { map = false, policy } = {}) {
    if (policy != null) {
      const err = new Error("BareBars has no render-time { allow, eval } policy");
      err.kind = "unsupported-policy";
      throw err;
    }
    const d = data == null ? {} : data;
    const hasPartials = program.partials && Object.keys(program.partials).length > 0;
    const res = program.dialect === "core"
      ? bbRender(program.source, d)
      : hasPartials
        ? bbRenderSurfaceWith(program.partials, program.source, d)
        : bbRenderSurface(program.source, d);
    return renderResult(res, map);
  }

  // ── AST + static analyses ──────────────────────────────────────────────────
  // parseAst returns the lowered AST in the host's {t:…} node shape (or {error}).
  // The engine facade does the parse+lower+map in PureScript; the analyses below
  // walk that shape, exactly like the Handlebars adapter walks its mapped nodes.

  function parseAst(source) {
    return astJson(DIALECT, source);
  }

  // BareBars-specific (the `compile-js` feature): compile the template to a JS
  // ES module via BareBars.Compile, honouring the active dialect. Returns
  // `{ ok, value, error }` — `value` is the JS source. Drives the Compiled JS view.
  function compileToJs(source) {
    return (DIALECT === "core" ? bbCompile : bbCompileSurface)(source);
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

  // required-assigns (EXACT for BareBars): the root of every `{t:"path"}` — i.e.
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
    const err = new Error("BareBars context inspector is not implemented yet");
    err.kind = "unsupported";
    throw err;
  }
  // partial-graph is not advertised yet (BareBars partials are `partial` calls,
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
