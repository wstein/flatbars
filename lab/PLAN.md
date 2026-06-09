# FlatBars Lab — template playground (architecture & roadmap)

The FlatBars Lab is a single-page IDE that compiles and renders FlatBars-family
templates entirely in the browser, against the PureScript `flatbars-js` engine
bundled to `vendor/flatbars-engine.mjs` (no WASM). It descends from a multi-engine
"Stem Playground" reference but is now **FlatBars-only**: the Stem WASM engine and
the Handlebars reference engine were dropped so the Lab targets one engine family.

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
That lowered AST (`parseAst`) carries each tag-derived node's opening-tag span as
`src: { start, end }`, so the **Data Access** panel reports the real
`file:line:column` and its rows jump to source — both keyed off `node.src`, not a
1:1 fallback.
The **core / FullBars / MaxBars dialects back `source-map`** (ADR-035): a mapped
render returns output→source `segments`, each tagged with its source `file`, so the
three-way editor↔output provenance linking is live and a partial-origin run links to
its own partial document. They **also back `context-inspect`** — the Context
Inspector snapshots the render context at a clicked run (one per loop iteration).
All pinned by `check:provenance` + the `test:lab:browser` smoke. MinBars backs
neither, so its provenance surfaces gate off honestly.

The boot is defended: a failed engine / example-catalog fetch paints a visible
error overlay (built from the inline design tokens) instead of a blank page —
`test:lab:browser` asserts both the happy path and the missing-asset overlay.

## Roadmap

The provenance arc (ADR-035) is complete for the FlatBars dialects. Open ideas:
context inspection / source maps already cover core / FullBars / MaxBars; the
natural next surfaces are an embeddable Lab component and a per-example metrics
feed into the quality dashboards.
