// SPDX-License-Identifier: Apache-2.0
//
// MinBars adapter — the engine-neutral playground's Mustache engine.
// `createMinBarsRenderer()` returns the same object shape as the other engine
// adapters (render, compile, parseAst, inspectAt, usedTransformers,
// requiredAssigns, partialGraph, allTransformers, catalog, engineInfo,
// version), so the host wires it through the identical seam.
//
// MinBars is a *peer engine* to FullBars (Mustache semantics — a context stack
// with parent fallback, polymorphic sections, `false null []` truthiness),
// rendering 170/170 of the in-scope mustache/spec suite. It is interpret-only:
// there is no compile-to-JS path, no helper registry, no output->source map. So
// the capability vector is deliberately small — `render` + `partials` +
// `catalog` — and the Phase-1 panel gate hides everything else (Compiled JS,
// Context Inspector, Bytecode, the approximate static analyses).

import { renderMustache as bbRenderMustache } from "./vendor/flatbars-engine.mjs";

const MIN_VERSION = "0.1.0";

// engine-features/v1 capability vector for MinBars. Compared with the FlatBars
// adapter's set, everything compile/AST-analysis specific is absent: MinBars has
// no JS compile, no lowered AST seam here, and no Handlebars-style helper
// catalog — just rendering and (Mustache) partials.
const MIN_FEATURES = ["partials", "catalog"];

// The Mustache constructs, with the metadata the Transformers/cheat-sheet panel
// renders (mirrors the shape of the other adapters' catalogs). Mustache has no
// helpers; these are the tag *forms* the engine implements.
const MIN_CATALOG = [
  { name: "{{name}}", category: "interpolation", arity: "inline", summary: "Interpolate a name (HTML-escaped); {{{name}}} / {{&name}} are raw. Resolves up the context stack with parent fallback; {{.}} is the implicit iterator.", example: "Hello {{name}}!" },
  { name: "#section", category: "sections", arity: "block", summary: "Polymorphic section: render once per array element (pushed), once for a truthy non-list, or never for a falsy value (false/null/[]).", example: "{{#items}}{{.}}{{/items}}" },
  { name: "^inverted", category: "sections", arity: "block", summary: "Render the block only when the value is falsy (false/null/empty list).", example: "{{^items}}none{{/items}}" },
  { name: ">partial", category: "composition", arity: "inline", summary: "Include a partial, rendered against the current context stack and re-indented when standalone. {{>* name}} resolves the partial name from context.", example: "{{> item}}" },
  { name: "<parent", category: "inheritance", arity: "block", summary: "Expand a parent template, overriding its {{$blocks}}. {{<*name}} resolves the parent name from context.", example: "{{<base}}{{$title}}Home{{/title}}{{/base}}" },
  { name: "$block", category: "inheritance", arity: "block", summary: "An overridable region: renders its default unless an enclosing parent overrides it.", example: "{{$title}}default{{/title}}" },
  { name: "!comment", category: "meta", arity: "inline", summary: "A comment — dropped from output. Standalone comment lines are stripped.", example: "{{! ignored }}" },
];

export async function createMinBarsRenderer() {
  // No async init — MinBars is synchronous JS (the compiled PureScript facade).
  // The async signature mirrors the other adapters so the host's `await
  // create…()` call site stays engine-agnostic.

  // `program` is opaque to the host: it carries the source and the partial
  // sources. MinBars has no separate compile step — render reports located
  // parse errors directly — so this just packages them.
  function compile(source, partials = {}, _opts = {}) {
    return { program: { source, partials: partials || {} } };
  }

  function render(program, data, { map = false, policy } = {}) {
    if (policy != null) {
      const err = new Error("MinBars has no render-time { allow, eval } policy (Mustache is logic-less)");
      err.kind = "unsupported-policy";
      throw err;
    }
    const res = bbRenderMustache(program.partials || {}, program.source, data == null ? null : data);
    if (res.ok) return map ? { output: res.value, segments: [] } : res.value;
    const err = new Error(res.error);
    err.kind = "render";
    throw err;
  }

  // MinBars exposes no lowered-AST seam to the host yet, so the AST-derived
  // panels (outline, data-access, partial-graph) gate off via the absent
  // features. The host may still call these analyses defensively during a
  // render, so they return EMPTY rather than throw (honest: Mustache is
  // logic-less, and there is no AST here to analyse). Only `inspectAt` — a
  // user click into a non-existent output->source map — throws `unsupported`.
  function parseAst() {
    return { ast: { version: "minbars-ast/v1", nodes: [] } };
  }
  function inspectAt() {
    const err = new Error("MinBars has no context inspector (no output->source map)");
    err.kind = "unsupported";
    throw err;
  }
  const noUses = () => []; // usedTransformers / requiredAssigns — none surfaceable
  const noGraph = () => ({ nodes: [], edges: [], cycles: [] }); // partialGraph

  function allTransformers() {
    return []; // Mustache is logic-less — no helper registry.
  }

  function catalog() {
    return MIN_CATALOG;
  }

  function engineInfo() {
    return { version: MIN_VERSION, builtins: [], features: MIN_FEATURES };
  }

  return {
    render,
    compile,
    parseAst,
    inspectAt,
    usedTransformers: noUses,
    requiredAssigns: noUses,
    partialGraph: noGraph,
    allTransformers,
    catalog,
    engineInfo,
    version: MIN_VERSION,
  };
}
