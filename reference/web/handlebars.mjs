// SPDX-License-Identifier: Apache-2.0
//
// Handlebars adapter — the engine-neutral playground's SECOND engine (ADR-0020,
// minutes 00004). `createHandlebarsRenderer()` returns the SAME object shape as
// stem.mjs's `createRenderer` (render, compile, parseAst, inspectAt,
// usedTransformers, requiredAssigns, partialGraph, allTransformers, catalog,
// engineInfo, version), so the host wires it through the identical seam.
//
// The honesty is in `engineInfo().features`: Handlebars backs partials, helpers
// (HTML-escaped by default) and a static AST, but NOT the portable stem-bc
// wire, output->source provenance, per-emit escape modes, ST4, the eval gate, or
// context snapshots. Those capability bits are absent, so the Phase-1 gate hides
// the panels that depend on them. The three static analyses it CAN approximate
// (used-transformers, required-assigns, partial-graph) carry an `:approximate`
// suffix so the UI badges them and bars them from cross-engine diffs.

import Handlebars from "./vendor/handlebars.mjs";

// ADR-0020 capability vector for Handlebars (engine-features/v1). Compare with
// the Stem adapter's full set — everything Stem-specific is deliberately absent.
const HB_FEATURES = [
  "partials",
  "catalog",
  "used-transformers:approximate",
  "required-assigns:approximate",
  "partial-graph:approximate",
  "hbs-known-helpers",
  "hbs-proto-hardening",
];

// Handlebars' framework-internal helpers — not user-facing surface, so they are
// excluded from the catalog / used-transformers report.
const INTERNAL_HELPERS = new Set(["blockHelperMissing", "helperMissing"]);

// The built-in block/inline helpers, with the metadata the Transformers panel's
// cheat sheet renders (mirrors the shape of Stem.Transformers.Catalog.entries).
const HB_CATALOG = [
  { name: "if", category: "logic", arity: "block", summary: "Render the block when the argument is truthy (Handlebars truthiness: [] and {} are truthy).", example: "{{#if active}}on{{/if}}" },
  { name: "unless", category: "logic", arity: "block", summary: "Render the block when the argument is falsy.", example: "{{#unless done}}todo{{/unless}}" },
  { name: "each", category: "collections", arity: "block", summary: "Iterate an array or object; @index/@key/@first/@last are in scope.", example: "{{#each items}}{{this}}{{/each}}" },
  { name: "with", category: "access", arity: "block", summary: "Shift the context into the argument for the block.", example: "{{#with user}}{{name}}{{/with}}" },
  { name: "lookup", category: "access", arity: "inline", summary: "Dynamic property lookup (avoids literal-path limits).", example: "{{lookup obj key}}" },
  { name: "log", category: "host", arity: "inline", summary: "Log the arguments to the host console (no output).", example: "{{log value}}" },
];

export async function createHandlebarsRenderer() {
  // No async initialisation — Handlebars is synchronous JS. The async signature
  // mirrors the Stem adapter so the host's `await create…()` call site is
  // engine-agnostic (ADR-0020 single-shape contract).

  // An isolated Handlebars environment for this renderer, so custom helpers a
  // controller registers (see applyController) don't leak into other instances
  // or the module-level import.
  const hb = Handlebars.create();

  // ── AST mapping: Handlebars.parse() -> a stem-ast/v1-shaped node tree ──────
  // The host's AST inspector (astOutline) and dependency graph
  // (buildDependencyGraph) walk this shape. Handlebars partials map to
  // `{t:"partial"}` nodes, which buildDependencyGraph already detects — so the
  // Partials panel works with no host change. No byte spans: Handlebars has no
  // output->source map, so nodes carry no `src` (provenance gates off cleanly).

  const pathName = (path) =>
    path && path.type === "PathExpression" ? path.original : (path && path.original) || "?";

  function mapExpr(node) {
    if (!node || typeof node !== "object") return { t: "lit", value: node };
    switch (node.type) {
      case "PathExpression": {
        if (node.data) {
          const head = node.parts[0];
          if (["index", "key", "first", "last"].includes(head)) return { t: head };
          if (head === "root") return { t: "context", kind: "root" };
          return { t: "context", kind: head };
        }
        if (node.original === "this" || node.original === ".") return { t: "context", kind: "this" };
        if (node.parts.length <= 1) return { t: "identifier", name: node.parts[0] ?? node.original };
        return { t: "path", segments: node.parts };
      }
      case "StringLiteral":
      case "NumberLiteral":
      case "BooleanLiteral":
        return { t: "lit", value: node.value };
      case "UndefinedLiteral":
        return { t: "lit", value: null };
      case "NullLiteral":
        return { t: "lit", value: null };
      case "SubExpression":
        return { t: "call", name: pathName(node.path), args: (node.params || []).map((p) => ({ value: mapExpr(p) })) };
      default:
        return { t: "lit", value: node.original ?? "?" };
    }
  }

  // A mustache (`{{x}}` / `{{helper a b}}`) as an expression: a bare path is the
  // value; a path with params/hash is a helper call.
  function mustacheExpr(node) {
    if ((node.params && node.params.length) || (node.hash && node.hash.pairs && node.hash.pairs.length)) {
      return { t: "call", name: pathName(node.path), args: (node.params || []).map((p) => ({ value: mapExpr(p) })) };
    }
    return mapExpr(node.path);
  }

  const partialName = (node) => {
    const n = node.name;
    if (!n) return "?";
    if (n.type === "PathExpression") return n.original;
    if (n.type === "StringLiteral") return n.value;
    return "?"; // dynamic partial (SubExpression) — not statically resolvable
  };

  function mapNode(node) {
    switch (node.type) {
      case "ContentStatement":
        return { t: "text", text: node.value };
      case "MustacheStatement":
        return { t: "emit", expr: mustacheExpr(node), escape: node.escaped ? "html" : "none" };
      case "BlockStatement": {
        const name = pathName(node.path);
        const subject = node.params && node.params[0] ? mapExpr(node.params[0]) : { t: "lit", value: null };
        const then = node.program ? node.program.body.map(mapNode) : [];
        const otherwise = node.inverse ? node.inverse.body.map(mapNode) : [];
        if (name === "if") return { t: "if", cond: subject, then, else: otherwise };
        if (name === "unless") return { t: "unless", cond: subject, then, else: otherwise };
        if (name === "each") return { t: "each", subject, body: then, else: otherwise };
        if (name === "with") return { t: "with", subject, body: then, else: otherwise };
        // A custom block helper: keep its name and body so partials inside it are
        // still found by the dependency walk (childLists checks then/else/body).
        return { t: name, subject, body: then, else: otherwise };
      }
      case "PartialStatement":
        return { t: "partial", name: partialName(node) };
      case "PartialBlockStatement":
        return { t: "partial", name: partialName(node), body: node.program ? node.program.body.map(mapNode) : [] };
      case "CommentStatement":
        return { t: "comment", text: node.value };
      default:
        return { t: node.type || "?" };
    }
  }

  function parseAst(source) {
    try {
      const ast = hb.parse(source);
      return { ast: { version: "hb-ast/v1", nodes: ast.body.map(mapNode) } };
    } catch (e) {
      return { error: { message: e && e.message ? e.message : String(e), start: 0, end: 0 } };
    }
  }

  // ── compile / render ──────────────────────────────────────────────────────
  // `program` is opaque to the host: it carries the source, the partial sources,
  // the parsed AST, and the compiled template fn. The host passes it straight
  // back to render/usedTransformers/etc. There is no portable wire (the
  // `bytecode-wire` capability is absent, so the Bytecode view is gated off).

  function compile(source, partials = {}, { map = false, standalone = true } = {}) {
    const errors = [];
    let mainAst;
    try {
      mainAst = hb.parse(source);
    } catch (e) {
      errors.push({ message: e && e.message ? e.message : String(e), file: "main", start: 0, end: 0 });
    }
    for (const [name, src] of Object.entries(partials)) {
      try {
        hb.parse(src);
      } catch (e) {
        errors.push({ message: e && e.message ? e.message : String(e), file: name, start: 0, end: 0 });
      }
    }
    if (errors.length) return { errors };
    let template;
    try {
      template = hb.compile(source);
    } catch (e) {
      return { errors: [{ message: e && e.message ? e.message : String(e), file: "main", start: 0, end: 0 }] };
    }
    return { program: { source, partials, ast: mainAst, template } };
  }

  function render(program, data, { map = false, policy } = {}) {
    // ADR-0020 Phase 2: a Stem-shaped `{ allow, eval }` host policy can't be
    // enforced by Handlebars (its closest control is compile-time
    // knownHelpersOnly), so reject it with a typed error rather than silently
    // accept a false "allowed".
    if (policy != null) {
      const err = new Error(
        "Handlebars does not enforce a render-time { allow, eval } policy — use knownHelpersOnly at compile time",
      );
      err.kind = "unsupported-policy";
      throw err;
    }
    try {
      const output = program.template(data == null ? {} : data, { partials: program.partials });
      // Single-shape contract: always { output, segments } under map; Handlebars
      // has no output->source map, so segments is [] (provenance self-disables).
      return map ? { output, segments: [] } : output;
    } catch (e) {
      const err = new Error(e && e.message ? e.message : String(e));
      err.kind = "render";
      throw err;
    }
  }

  // ── Controller (custom helpers + optional data transform) ─────────────────
  // The Handlebars analogue of Stem's JSONata transform slot: a small JS script
  // that registers custom helpers on this renderer's isolated instance and may
  // return a transformed view-model. Handlebars helpers ARE JavaScript, so —
  // unlike the sandboxed JSONata transform — this is a real `new Function` eval.
  // It runs in the host page (the user's own browser, their own code); the
  // rendered OUTPUT still goes through the iframe + CSP sandbox.
  //
  // The environment pre-binds everything a helpers file needs — no import or
  // require boilerplate:
  //   Handlebars    — this renderer's instance (Handlebars.registerHelper(…))
  //   helper(n, fn) — shorthand for Handlebars.registerHelper
  //   data          — the current view-model (return a value to transform it)
  // Returns `{ data }` (the possibly-transformed view-model) or `{ data, error }`.
  // Helpers a previous controller registered are removed first, so each run
  // starts from the built-ins (if/each/with/…) only — no cross-run accumulation.
  let controllerHelpers = [];
  function applyController(src, data) {
    for (const name of controllerHelpers) hb.unregisterHelper(name);
    controllerHelpers = [];
    if (!src || !src.trim()) return { data };
    const before = new Set(Object.keys(hb.helpers));
    try {
      const fn = new Function("data", "Handlebars", "helper", src);
      const helper = (name, f) => hb.registerHelper(name, f);
      const out = fn(data == null ? {} : data, hb, helper);
      controllerHelpers = Object.keys(hb.helpers).filter((n) => !before.has(n));
      return { data: out === undefined ? data : out };
    } catch (e) {
      // Track whatever got registered before the throw so the next run cleans up.
      controllerHelpers = Object.keys(hb.helpers).filter((n) => !before.has(n));
      return { data, error: { message: e && e.message ? e.message : String(e) } };
    }
  }

  // inspectAt has no Handlebars analogue (no output->source map to anchor a
  // clicked span). Per ADR-0020 an absent capability's method throws a typed
  // `unsupported` error; the host gates the Context Inspector off via the
  // missing `context-inspect` feature, so this is a belt-and-braces guard.
  function inspectAt() {
    const err = new Error("Handlebars has no context inspector (no output->source map)");
    err.kind = "unsupported";
    throw err;
  }

  // ── Static analyses (approximate — AST walks, badged in the UI) ────────────

  const registered = () => hb.helpers || {};

  // Walk every node/expression, calling `visit` on each AST node and `visitExpr`
  // on each mapped expression.
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

  // used-transformers (approximate): block helpers, plus inline mustache/sub
  // calls whose head is a registered helper. The `{{foo}}`-is-helper-or-data
  // ambiguity is why this is approximate.
  function usedTransformers(program) {
    const helpers = registered();
    const names = new Set();
    walk(program.ast.body.map(mapNode), (node) => {
      // Block helpers surface as their own node `t` (if/unless/each/with) or a
      // custom-named block node.
      if (["if", "unless", "each", "with"].includes(node.t)) names.add(node.t);
      else if (node.t !== "text" && node.t !== "emit" && node.t !== "partial" && node.t !== "comment" && node.t) {
        if (!INTERNAL_HELPERS.has(node.t)) names.add(node.t); // custom block helper
      }
      if (node.t === "emit") {
        walkExpr(node.expr, (e) => {
          if (e.t === "call" && !INTERNAL_HELPERS.has(e.name) && (helpers[e.name] || true)) {
            // A call head in a mustache is a helper invocation by construction
            // (a bare path stays a path, never a call).
            names.add(e.name);
          }
        });
      }
    });
    return [...names].sort();
  }

  // required-assigns (approximate): the first segment of every non-data path
  // used as a VALUE (emitted bare, or as a helper/block argument), minus context
  // vars, `this`, and helper names. Can't see block-local params, hence approx.
  function requiredAssigns(program) {
    const helperNames = new Set(usedTransformers(program));
    const assigns = new Set();
    const noteExpr = (e) => {
      if (e.t === "identifier" && e.name && !helperNames.has(e.name)) assigns.add(e.name);
      else if (e.t === "path" && e.segments && e.segments.length) assigns.add(e.segments[0]);
      else if (e.t === "call") for (const a of e.args || []) noteExpr(a.value);
    };
    walk(program.ast.body.map(mapNode), (node) => {
      if (node.t === "emit") walkExpr(node.expr, (e) => {
        if (e.t === "identifier" || e.t === "path") noteExpr(e);
      });
      if (node.cond) noteExpr(node.cond);
      if (node.subject) noteExpr(node.subject);
    });
    return [...assigns].sort();
  }

  // partial-graph (approximate): static call-site edges only (no cycle
  // confidence, no dynamically-registered partials). The host normally builds
  // its graph from parseAst via buildDependencyGraph; this mirrors that for the
  // contract and any host that calls it directly.
  function partialGraph(program) {
    const files = { main: program.ast.body.map(mapNode) };
    for (const [name, src] of Object.entries(program.partials)) {
      const p = parseAst(src);
      files[name] = p.ast ? p.ast.nodes : [];
    }
    const known = new Set(Object.keys(files));
    const nodes = Object.keys(files).map((id) => ({ id, isMain: id === "main", missing: false }));
    const edgeMap = new Map();
    for (const [from, list] of Object.entries(files)) {
      walk(list, (node) => {
        if (node.t === "partial" && node.name) {
          const key = from + "\0" + node.name;
          const e = edgeMap.get(key);
          if (e) e.count++;
          else edgeMap.set(key, { from, to: node.name, count: 1, missing: !known.has(node.name), span: null });
        }
      });
    }
    const edges = [...edgeMap.values()];
    for (const e of edges) {
      if (!known.has(e.to) && !nodes.some((n) => n.id === e.to)) nodes.push({ id: e.to, isMain: false, missing: true });
    }
    return { nodes, edges, cycles: [] };
  }

  // All user-facing helper names (built-ins + any registered), sorted.
  function allTransformers() {
    return Object.keys(registered()).filter((n) => !INTERNAL_HELPERS.has(n)).sort();
  }

  // Per-helper metadata for the cheat sheet. Built-ins carry rich entries; any
  // extra registered helper appears as a bare `host` entry.
  function catalog() {
    const known = new Set(HB_CATALOG.map((e) => e.name));
    const extra = allTransformers()
      .filter((n) => !known.has(n))
      .map((name) => ({ name, category: "host", arity: "inline", summary: "Registered Handlebars helper.", example: `{{${name} value}}` }));
    return [...HB_CATALOG, ...extra];
  }

  function engineInfo() {
    return {
      version: Handlebars.VERSION,
      builtins: allTransformers(),
      features: HB_FEATURES,
    };
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
    // Handlebars-specific extension (not part of the core Stem seam): the host
    // calls it when a JS controller is present, before render, to register the
    // template's custom helpers.
    applyController,
    version: Handlebars.VERSION,
  };
}
