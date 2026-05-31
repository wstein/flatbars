# Bars Lab — polyglot template playground (plan)

Goal: **one** playground that serves **Handlebars**, **Stem**, *and*
**BareBars/FlatBars** — porting the full `reference/web` ("Stem Playground —
IDE") feature set and adding BareBars as a first-class engine. Draft for
approval; nothing built yet. (Working name "Bars Lab" — see naming options.)

## Decisive finding: the reference is already a multi-engine IDE

`reference/web` is **adapter-based and polyglot by design**. Each engine provides
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

**Build Bars Lab on `reference/web`; add a BareBars engine adapter; rebrand.**
Do *not* rebuild the IDE in Halogen. Rationale:

- The reference gives us *all* Stem features, the Handlebars engine, and every
  inspector panel **for free** — "migrate all Stem features" becomes "keep them
  and add one adapter," not "reimplement dozens of analyses."
- BareBars already compiles to JS, so it plugs into the vanilla-JS adapter seam
  via a compiled facade — no WASM needed (the `barebars-js` facade is the seed:
  `render`/`renderSurface` already exist; we extend it to the full seam).
- The current Halogen `packages/playground` is **superseded** by Bars Lab. Keep
  it only if we still want a tiny embeddable BareBars-only demo (decision below).

Consequence: this reverses the earlier "stay on Halogen / reuse our engine"
decision. We keep the engine in PureScript and expose it to the lab as JS.

## The BareBars engine adapter (the core new work)

Implement the seam in a `barebars.mjs` adapter backed by a compiled PureScript
facade (`FlatBars.Lab` or an extension of `barebars-js`):

| Seam member | BareBars implementation | Reuses |
|---|---|---|
| `render(tmpl, data, opts)` | `FlatBars.renderWithDiag` / `renderSurfaceDiag` (dialect = opt) | barebars-js, the **core/surface toggle** |
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
hide for the BareBars engine, exactly as for Handlebars.

## Polyglot headline feature

Cross-engine **side-by-side**: one template + data, rendered by Handlebars vs
Stem vs BareBars at once, with per-engine diagnostics and a diff. The reference
already does Stem-vs-Handlebars golden comparison; we extend it to three engines.
This is the reason to be polyglot, not just multi-tab.

## Phased roadmap

- **Phase 0 — Adopt & build.** Bring `reference/web` into the monorepo build as
  the lab (entry point, `build.sh` → our tooling), Stem (WASM) + Handlebars
  intact, green smoke test. Decide the fate of Halogen `packages/playground`.
- **Phase 1 — BareBars adapter (MVP).** `render` + `parseAst` + `features` +
  `engineInfo`; BareBars selectable in the engine catalog; Rendered/HTML/AST
  views work. Dialect (core/surface) as an engine option.
- **Phase 2 — BareBars inspectors.** Wire `problems` (diagnostics), `data-access`
  (`requiredAssigns`), `trim`, `capabilities`/`catalog`, `disassemble` (`lower`).
  Feature-gate the rest.
- **Phase 3 — Partials & multi-document.** `partialGraph`, the partials panel,
  `{{#inline}}` defs across documents.
- **Phase 4 — Cross-engine parity.** 3-way side-by-side + diff; truthiness
  cheat-sheet across engines; golden harness extended to BareBars.
- **Phase 5 — Rebrand & polish.** Name/logo/landing; data overlays; shareable
  URL state; `coverage`/`perf` panels for BareBars.
- **Phase 6 — Tests & CI.** Browser-smoke + screenshots per engine (extend
  `reference/web/test`); golden diffs in CI.

## Status (2026-05-31)

- **Phase 1 ✓** — BareBars adapter (`reference/web/barebars.mjs`); `?engine=barebars`
  boots in headless Brave, render works (surface + core), 13 adapter tests.
- **Phase 2 ✓** — real `parseAst` + exact `requiredAssigns` + `usedTransformers`
  via `FlatBars.JS.astJson`; capability gating verified in-browser (Data Access /
  Transformers panels light up; partials/whitespace gate off).
- **Phase 3 ◑** — cross-engine **compare view** shipped (`compare.html`, the
  headline; Handlebars≡BareBars confirmed, Stem divergence surfaced) + partial/
  inline AST fidelity. *Remaining:* multi-document partials → `partial-graph`
  panel (needs `renderSurfaceWith` + the sources panel), and the core/surface
  **dialect toggle** as a UI control.

## Open questions

1. **Strategy**: confirm building on `reference/web` + a BareBars adapter (vs a
   Halogen rebuild). Recommended: build on the reference.
2. **Name** (see ratings in the chat): Bars Lab / Brace Lab / Polybars / …
3. **Halogen `packages/playground`**: retire it, or keep a minimal embeddable
   BareBars-only demo?
4. **Stem source**: is the prebuilt `wasm/stem_native` the canonical Stem, or do
   we track a Stem source/repo for rebuilds?
5. **Repo placement**: does Bars Lab live in this repo (e.g. `packages/lab` or
   promote `reference/web`), and is the Stem/Handlebars vendoring kept as-is?
