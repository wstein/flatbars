# FlatBars Lab — template playground (architecture & roadmap)

The FlatBars Lab is a single-page IDE that compiles and renders FlatBars-family
templates entirely in the browser, against the PureScript `flatbars-js` engine
bundled to `vendor/flatbars-engine.mjs` (no WASM). It descends from the
multi-engine "Stem Playground" reference (see `13-playground-interactions.adoc`)
but is now **FlatBars-only**: the Stem WASM engine and the Handlebars reference
engine were dropped so the Lab targets one engine family.

## Engines

The Lab exposes the FlatBars dialects as first-class engines, chosen once per
page load from `?engine=` and fixed thereafter:

- **RawBars** (`?engine=rawbars`) — the austere meaning-free core surface.
- **FullBars** (`?engine=fullbars`, the default) — the Handlebars-flavoured
  surface (`{{ }}` auto-escape, paths, `@data`, `else`/`elif`).
- **MaxBars** (`?engine=maxbars`) — FullBars plus infix operators, pipes, and
  bare loop variables.
- **MinBars** (`?engine=minbars`) — Mustache semantics (logic-less, context-stack
  with parent fallback), rendering the in-scope `mustache/spec` suite.

## The engine seam (ADR-0020)

Each engine is built by an async factory returning one identical object shape, so
the host wires every engine through the same call sites:

```text
{ render, compile, parseAst, inspectAt,
  usedTransformers, requiredAssigns,    // static analyses (exact, from the lowered AST)
  partialGraph,                         // partial dependency graph
  analyze, analyzeWith, lint, migrate,  // FlatBars tooling
  compileToJs,                          // compile to a JS ES module
  allTransformers, catalog,             // helper / tag-form catalog
  engineInfo, version }                 // capability advertisement
```

One adapter implements this seam — `renderer.mjs` — dispatched by dialect:
`createRenderer("rawbars" | "fullbars" | "maxbars" | "minbars")`. MinBars also
takes a construction option `{ compat }` (the mustache.js truthiness rule).

## Capability-gated panels (the honesty mechanism)

`engineInfo().features` is an `engine-features/v1` capability vector; a token may
carry an `:approximate` suffix ("supported, but heuristic"). Three predicates in
`playground_utils.mjs` gate the whole UI on it — `hasFeature`,
`featureFidelity`, `tabVisibleUnder` — bound to `engineHas` / `tabVisible` in the
host. **An engine that does not advertise a feature simply does not show that
panel**, so an unequal engine never lies about what it can do. The dock panels —
`problems`, `transformers`, `data-access`, `partials`, `capabilities`, `perf`,
`coverage` — and the output views gate on this vector.

FlatBars advertises exact (non-heuristic) `used-transformers`, `required-assigns`,
and `partial-graph` because they are computed from the lowered AST, not guessed.
`source-map` (provenance) and `context-inspect` are **not yet natively backed**,
so the provenance-linking and Context Inspector surfaces gate off honestly.

## Roadmap

1. **Native source maps** — emit output→source `segments` from the engine
   (instrument the polymorphic interpret driver) so the three-way
   editor↔output provenance linking lights up for the native dialects. Offsets
   are JS string indices (UTF-16), so no byte↔char bridge is needed.
2. **Native context inspection** — `inspectAt` over the reified render-context
   stack (`RefEnv`), lighting up the Context Inspector.
3. **A tiling-conformance gate** asserting the emitted segments tile the output,
   plus a defended boot path.
