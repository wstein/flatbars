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
//   spago bundle -p barebars-js --module FlatBars.JS \
//     --bundle-type module --platform browser --outfile vendor/barebars-engine.mjs
// ). It renders the **surface** dialect by default — the Handlebars-compatible
// layer (paths, `{{ }}` auto-escape, `@data`, `else`/`elif`) — which is the
// right basis for cross-engine comparison; the austere **core** dialect is an
// option (the BareBars-specific control, surfaced in Phase 2).
//
// MVP scope (Phase 1): render + honest capability advertisement. The AST-backed
// inspectors (parseAst outline, required-assigns, partial-graph) are Phase 2,
// pending a `FlatBars.Lab` facade that exposes the lowered AST as JSON; until
// then BareBars does not advertise those features, so those panels gate off
// exactly as for any engine that lacks them.

import { render as bbRender, renderSurface as bbRenderSurface } from "./vendor/barebars-engine.mjs";

const BB_VERSION = "barebars 0.1.0";

// engine-features/v1 capability vector. Deliberately thin for the MVP: BareBars
// backs rendering and a static helper catalog, but the AST-backed analyses are
// not advertised yet (Phase 2), so the gate hides those panels.
const BB_FEATURES = [
  "catalog",
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

  // `program` is opaque to the host: it carries the source and the chosen dialect.
  function compile(source, partials = {}, { dialect = "surface" } = {}) {
    // A compile-time parse check via a throwaway render against empty data would
    // conflate parse and eval errors; instead defer to render (which reports
    // located parse errors). The MVP has no separate compile step.
    return { program: { source, dialect } };
  }

  function render(program, data, { map = false, policy } = {}) {
    if (policy != null) {
      const err = new Error("BareBars has no render-time { allow, eval } policy");
      err.kind = "unsupported-policy";
      throw err;
    }
    const d = data == null ? {} : data;
    const res = program.dialect === "core" ? bbRender(program.source, d) : bbRenderSurface(program.source, d);
    return renderResult(res, map);
  }

  // parseAst / inspectors: Phase 2 (needs the FlatBars.Lab AST-JSON facade). The
  // features above omit the AST capabilities, so the host gates these panels off;
  // these are belt-and-braces typed `unsupported` guards.
  function parseAst() {
    return { ast: { version: "barebars-ast/v1", nodes: [] } };
  }
  function inspectAt() {
    const err = new Error("BareBars context inspector is not implemented yet");
    err.kind = "unsupported";
    throw err;
  }
  function usedTransformers() { return []; }
  function requiredAssigns() { return []; }
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
    engineInfo,
    version: BB_VERSION,
  };
}
