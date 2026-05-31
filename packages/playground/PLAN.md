# Expert-level Playground — phased plan

Goal: bring `packages/playground` to the bar set by `reference/web` (the **"Stem
Playground — IDE"**), a reference-quality, IDE-like template playground. This
document maps each reference capability to a BareBars task and sequences them
into shippable phases. **Nothing here is built yet — this is for approval.**

## Reference inventory (`reference/web`)

What the reference ships (from `index.html`, `playground_utils.mjs`,
`validate.mjs`, `panels/`, `wasm/`, `vendor/`):

- **IDE shell**: docked tab strips — `tmpl-tabs`/`sources` (multi-document
  editing), `view-tabs` (output modes), `inspect-tabs`/`dock-tabs` (inspector
  panels), `output-preview`. Panes switch between `output` and `sources`.
- **Editor intelligence**: `byteToChar`/`charToByte`/`byteRangeToCharRange`/
  `charToLineColumn` (position mapping), `partialNameAt` (cursor-aware),
  `debounce`.
- **Static analyses**: `astOutline`, `analyseDataAccess`, `analyseCalls`,
  `analyseWhitespace`, `analyseEscapeRuns`, `analyseCoverage`,
  `buildDependencyGraph`, `disassemble`.
- **Parity & reference**: `stemTruthy` vs `handlebarsTruthy`, `handlebars_golden`
  (golden comparison), `buildCheatSheetData`, vendored `handlebars`, `jsonata`,
  `js-yaml`.
- **Data**: `mergeDataOverlays` + overlay-name validation (compose data sources).
- **Panels**: `partials`, `transformers`.
- **Engine**: `wasm/stem_native` (Stem compiled to WASM) + `validate.mjs` golden
  expectations; `test/browser_smoke.mjs` with screenshots.

## Current state (`packages/playground`)

Halogen SPA (~340 lines): template editor + JSON data editor, example picker,
**core/surface dialect toggle**, 5 output views (Rendered / HTML / Parse tree /
Real AST / Validation), status footer. Renders entirely in-browser via the
`barebars` + `flatbars` engine compiled to JS.

## Architectural decisions (to confirm)

1. **Stay on Halogen/PureScript, do not port the reference's vanilla JS.** Our
   engine already compiles to JS; we reuse it directly (`parse`, `lower`,
   `validate`, `escapingWarnings`, `Span.lineColumn`, `preludeSchema`, the
   `FlatBars` renderers). No WASM is needed — BareBars *is* the JS engine. The
   reference's JS is a behavioural reference, not code to copy.
2. **Analyses are AST passes, not string scans.** Each reference analysis maps to
   a `foldTemplate`/`foldExpr`/`lower` pass over our typed AST — more faithful
   than the reference's text heuristics and reusing existing tooling.
3. **Offsets: code units, not bytes.** The reference maps UTF-8 byte ranges; we
   use code-unit offsets (`Span`, `lineColumn`) end to end, so we skip the
   byte/char conversion layer (simpler, already correct for our `Span`s).
4. **"Transformers" has no BareBars analogue.** That is a Stem concept; we either
   omit that panel or repurpose it as a **helpers** panel (the prelude + custom
   registrations). Flagged for decision in Phase 3.

## Mapping: reference feature → BareBars implementation

| Reference | BareBars implementation | Reuses |
|---|---|---|
| `charToLineColumn`, position mapping | `Span.lineColumn`, `parseErrorAt` | P8 (done) |
| inline error markers | render `validate`/`escapingWarnings` issues + `ParseError` at line:col | P8, `escapingWarnings` |
| `astOutline` | `foldTemplate` → collapsible node tree | `foldTemplate` |
| `analyseDataAccess` | `foldExpr` collecting `lookup`/path roots → data-field map | `foldExpr` |
| `analyseCalls` | `foldExpr` collecting `App` heads → used helpers vs `preludeSchema` | `preludeSchema` |
| `analyseEscapeRuns` | the escaping lint (raw output of data) | `escapingWarnings` (done) |
| `analyseWhitespace` | detect `~`/trim effects from the structural parse | `Lexer` trims |
| `analyseCoverage` | branch/path hit-set from an instrumented `render` over data | engine walk |
| `disassemble` | the **Real AST** (`lower`) view, expanded | `lower` (done) |
| `buildDependencyGraph` | scan `{{> name}}`/`partial` calls across documents | Surface/`hoistInline` |
| `stemTruthy` vs `handlebarsTruthy` | `FlatBars.truthy` vs vendored Handlebars; parity table | `truthy`, vendor HB |
| `buildCheatSheetData` | generate from `preludeSchema` / the helper catalog | docs-from-helperDefs (done) |
| `mergeDataOverlays` | merge N JSON data docs into the render context | `BareBars.Json` |
| `partials` panel | named-partial documents | `renderSurfaceWith`, `{{#inline}}` |
| `handlebars_golden` | side-by-side BareBars vs vendored Handlebars output | vendor HB |

## Phased roadmap

Each phase is independently shippable, keeps the suite + smoke test green, and
ends with a polish/UX pass.

- **Phase 0 — IDE shell.** Restructure the layout into the docked multi-pane shell
  (sources dock, editor, `view-tabs`, inspector dock) without losing current
  features. Establishes the component structure the later panels slot into.
- **Phase 1 — Editor diagnostics (recommended first).** Line:column readout;
  inline error/issue markers + a gutter, mapping `ParseError` and `validate`/
  `escapingWarnings` issues to positions via `Span.lineColumn`. Highest
  polish-per-effort; builds on P8.
- **Phase 2 — Analysis inspectors.** AST outline, data-access map, call graph
  (used helpers vs schema, unknown/over-arity flags), whitespace + escape-run
  views, coverage-over-data. Each a new inspector pane over the AST.
- **Phase 3 — Multi-document.** Partials panel (named partials via
  `renderSurfaceWith`, `{{#inline}}` hoisting), partial-dependency graph. Decide
  the "transformers" → "helpers" panel question here.
- **Phase 4 — Handlebars parity.** Side-by-side BareBars vs vendored Handlebars
  output, the truthiness parity cheat sheet, and a golden-comparison harness
  (mirroring `handlebars_golden.mjs`).
- **Phase 5 — Reference/cheat sheet.** A helper cheat-sheet panel generated from
  `preludeSchema` / `helper-catalog.adoc` (single source — ties to the
  docs-from-helperDefs work).
- **Phase 6 — UX polish.** Data overlays (compose data docs), shareable state
  (encode editor state in the URL), search, and a `browser_smoke` + screenshot
  harness matching the reference test rig.

## Cross-cutting

- **Testing**: extend `reference/web/test`-style browser smoke (Brave/puppeteer,
  already used for the current smoke) per phase; keep `playground_utils`-style
  pure helpers unit-tested.
- **Examples**: the reference's `examples/` set; align our generated examples.
- **Fidelity**: per feature, cross-check behaviour against `reference/web` during
  implementation rather than guessing from this map.

## Open questions for the user

1. Confirm **Halogen/PureScript** (decision 1) vs porting the reference stack.
2. **Transformers** panel: omit, or repurpose as a **helpers** panel?
3. Phase order — start at **Phase 1** (editor diagnostics) or **Phase 0** (shell
   first)?
4. Scope of **Handlebars parity** — is matching `{hb}` output a hard goal for the
   playground, or informational?
