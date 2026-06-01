# FlatBars Lab — polyglot template playground (plan)

Goal: **one** playground that serves **Handlebars**, **Stem**, *and*
**FlatBars/FullBars** — porting the full `lab` ("Stem Playground —
IDE") feature set and adding FlatBars as a first-class engine. Draft for
approval; nothing built yet. (Working name "FlatBars Lab" — see naming options.)

## Decisive finding: the reference is already a multi-engine IDE

`lab` is **adapter-based and polyglot by design**. Each engine provides
the same seam (the "Stem seam"):

```text
{ render, compile, parseAst, inspectAt,
  requiredAssigns,          // data-access analysis
  partialGraph,             // partial dependency graph
  usedTransformers, allTransformers,   // Stem-only; absent ⇒ panel hides
  catalog,                  // helper/feature catalog
  engineInfo, features, version }       // capability advertisement
```

Inspector panels are **feature-gated** (`hasFeature`/`featureFidelity`/
`tabVisibleUnder`): `problems`, `data-access`, `trim`, `partials`,
`capabilities`, `perf`, `coverage`, `dep-arrow`, `transformers`. An engine that
doesn't advertise a feature simply doesn't show that panel. It already runs Stem
+ vendored Handlebars side by side.

## Strategy (the pivot — confirm)

**Build FlatBars Lab on `lab`; add a FlatBars engine adapter; rebrand.**
Do *not* rebuild the IDE in Halogen. Rationale:

- The reference gives us *all* Stem features, the Handlebars engine, and every
  inspector panel **for free** — "migrate all Stem features" becomes "keep them
  and add one adapter," not "reimplement dozens of analyses."
- FlatBars already compiles to JS, so it plugs into the vanilla-JS adapter seam
  via a compiled facade — no WASM needed (the `flatbars-js` facade is the seed:
  `render`/`renderSurface` already exist; we extend it to the full seam).
- The current Halogen `packages/playground` is **superseded** by FlatBars Lab. Keep
  it only if we still want a tiny embeddable FlatBars-only demo (decision below).

Consequence: this reverses the earlier "stay on Halogen / reuse our engine"
decision. We keep the engine in PureScript and expose it to the lab as JS.

## The FlatBars engine adapter (the core new work)

Implement the seam in a `flatbars.mjs` adapter backed by a compiled PureScript
facade (`FullBars.Lab` or an extension of `flatbars-js`):

| Seam member | FlatBars implementation | Reuses |
|---|---|---|
| `render(tmpl, data, opts)` | `FullBars.renderWithDiag` / `renderSurfaceDiag` (dialect = opt) | flatbars-js, the **core/surface toggle** |
| `parseAst(tmpl)` | `parse` → `Template` (+ `lower` → `RNode`) serialized to JS | Parser, Lower |
| `inspectAt(tmpl, offset)` | node/expr at a code-unit offset via spans | `Span` |
| `requiredAssigns(tmpl)` | `foldExpr` over `lookup`/path roots → data fields | `foldExpr` |
| `partialGraph(tmpl, partials)` | scan `{{> }}`/`partial` + `{{#inline}}` defs | Surface, `hoistInline` |
| `catalog()` | helpers from `preludeSchema` / `helper-catalog` | docs-from-helperDefs |
| `features` | advertise: paths, `@data`, partials, inline, `else`/`elif`, `~`, raw, **no transformers** | preludeSchema |
| `engineInfo`/`version` | package metadata | — |
| `problems` (diagnostics) | `validate` + `escapingWarnings` + `ParseError`, located via `lineColumn` | P8, lint |
| `coverage` | branch/path hit-set from an instrumented render | engine walk |

`transformers` and any Stem-only feature are simply not advertised → those panels
hide for the FlatBars engine, exactly as for Handlebars.

## Polyglot headline feature

Cross-engine **side-by-side**: one template + data, rendered by Handlebars vs
Stem vs FlatBars at once, with per-engine diagnostics and a diff. The reference
already does Stem-vs-Handlebars golden comparison; we extend it to three engines.
This is the reason to be polyglot, not just multi-tab.

## Phased roadmap

- **Phase 0 — Adopt & build.** Bring `lab` into the monorepo build as
  the lab (entry point, `build.sh` → our tooling), Stem (WASM) + Handlebars
  intact, green smoke test. Decide the fate of Halogen `packages/playground`.
- **Phase 1 — FlatBars adapter (MVP).** `render` + `parseAst` + `features` +
  `engineInfo`; FlatBars selectable in the engine catalog; Rendered/HTML/AST
  views work. Dialect (core/surface) as an engine option.
- **Phase 2 — FlatBars inspectors.** Wire `problems` (diagnostics), `data-access`
  (`requiredAssigns`), `trim`, `capabilities`/`catalog`, `disassemble` (`lower`).
  Feature-gate the rest.
- **Phase 3 — Partials & multi-document.** `partialGraph`, the partials panel,
  `{{#inline}}` defs across documents.
- **Phase 4 — Cross-engine parity.** 3-way side-by-side + diff; truthiness
  cheat-sheet across engines; golden harness extended to FlatBars.
- **Phase 5 — Rebrand & polish.** Name/logo/landing; data overlays; shareable
  URL state; `coverage`/`perf` panels for FlatBars.
- **Phase 6 — Tests & CI.** Browser-smoke + screenshots per engine (extend
  `lab/test`); golden diffs in CI.

## Status (2026-05-31)

- **Phase 1 ✓** — FlatBars adapter (`lab/flatbars.mjs`); `?engine=flatbars`
  boots in headless Brave, render works (surface + core), 13 adapter tests.
- **Phase 2 ✓** — real `parseAst` + exact `requiredAssigns` + `usedTransformers`
  via `FullBars.JS.astJson`; capability gating verified in-browser (Data Access /
  Transformers panels light up; partials/whitespace gate off).
- **Phase 3 ✓** — cross-engine **compare view** (`compare.html`; Handlebars≡FlatBars
  confirmed, Stem divergence surfaced); an in-header **engine dropdown** (Stem /
  Handlebars / FlatBars, `?engine=` reload) and a FlatBars-only **dialect toggle**
  (Core / Surface, `?dialect=` reload); **multi-document partials** → the Partials
  panel (the adapter renders named partials via `renderSurfaceWith`, advertises
  `partial-graph`, and parseAst surfaces `{{> }}`/`{{#inline}}` as partial nodes).
  Verified headless. *Note:* in-template `{{#inline}}` defs are not graph nodes in
  the file-based dependency view (a documented limitation).

## Open questions

1. **Strategy**: confirm building on `lab` + a FlatBars adapter (vs a
   Halogen rebuild). Recommended: build on the reference.
2. **Name** (see ratings in the chat): FlatBars Lab / FlatBars Lab / Polybars / …
3. **Halogen `packages/playground`**: retire it, or keep a minimal embeddable
   FlatBars-only demo?
4. **Stem source**: is the prebuilt `wasm/stem_native` the canonical Stem, or do
   we track a Stem source/repo for rebuilds?
5. **Repo placement**: does FlatBars Lab live in this repo (e.g. `packages/lab` or
   promote `lab`), and is the Stem/Handlebars vendoring kept as-is?
