# FlatBars Lab — manual smoke checklist (layer 3)

The Lab's output-view system is tested in three layers (see
`lab/output-view.mjs` and the debate that established this split):

| Layer | What | Where it is checked |
| --- | --- | --- |
| 1 · **decision** | which pane + what text for a view | `lab/output-view.test.mjs` (pure, automated) |
| 2 · **wiring** | tab click → correct pane visible, paint called | `lab/output-view.test.mjs` (hand-rolled fake DOM, automated) |
| 3 · **pixels** | CodeMirror actually *renders* it, highlighted, measured | **this checklist** (manual; no headless tool asserts it honestly) |

Layers 1–2 run offline in `npm run test:lab` with **zero browser dependencies**.
Layer 3 is what a real browser — and only a real browser — can confirm. A
headless harness (jsdom/Playwright) was deliberately *not* adopted: it would add a
heavy/networked dependency to do, with lower fidelity, what the fake-DOM harness
already does for wiring, while still not honestly covering pixels. Revisit
Playwright only if visual regressions become a tracked priority, as an opt-in gate
off the default `test:lab` path.

## How to run

```sh
npm run gen:bundle          # rebuild lab/vendor/flatbars-engine.mjs if the engine changed
python3 -m http.server -d lab 8080   # or any static server; the Lab is static files
# open http://localhost:8080
```

The Lab imports CodeMirror from esm.sh, so this pass needs network.

## Checklist — output views

Load an example, then click each output-view tab. For every text view, confirm
the read-only editor shows content with the right syntax highlighting; for the
preview views, confirm the iframe renders.

- [ ] **Plain Text** — rendered output, source-map provenance decorations on hover.
- [ ] **HTML Preview** / **Markdown Preview** — iframe renders (text pane hidden).
- [ ] **Render Data** — the view-model as YAML.
- [ ] **Compiled JS** — the emitted module (FlatBars dialect), JS-highlighted.
- [ ] **Migrated MaxBars** — the template rewritten from Handlebars to MaxBars
      (template-grammar highlighted); residuals appear as leading `{{! … }}`
      comments. The tab is **absent** under a non-FlatBars engine (gates on the
      `migrate` capability). Opening `/lint`'s migrate examples via *Open in Lab*
      lands here.

## Checklist — Lint diagnostics panel (ADR-019)

The canonicalization lint is a **dock panel** (next to Truthiness). With a
template using a deprecated alias or legacy scoped variable
(e.g. `{{ plus a b }}`, or `{{#each xs}}{{ index }}{{/each}}` in RawBars/MaxBars):

- [ ] the **Lint** tab appears in the diagnostics dock, with a finding count and an
      amber badge (green when there are none).
- [ ] each finding row shows the offending name, the message naming the canonical
      spelling, and `main:line:col`; clicking a row jumps to the tag in the editor.
- [ ] the tab is **absent** under a non-FlatBars engine (gates on the `lint`
      capability), and the scoped-variable lint does **not** fire in FullBars (where
      `{{@index}}` is canonical).
- [ ] opening `/lint`'s lint examples via *Open in Lab* lands with this panel open.

## Checklist — Truthiness diagnostics panel (ADR-022)

The truthiness report is a **dock panel** (next to Coverage / Data Access), not an
output view. With a template that has an ambiguous condition over empty/zero data
(e.g. `{{#if bio}}…{{/if}}` with `{"bio":""}`):

- [ ] the **Truthiness** tab appears in the diagnostics dock, with a finding count
      and an amber badge (green when there are none).
- [ ] each finding row shows the tag, the value tested, the engines it flips
      under, `main:line:col`, and a **Fix:** line.
- [ ] clicking a row jumps to the condition in the template editor.
- [ ] editing the data re-runs it (a finding clears when the value stops being
      ambiguous; `0 findings — portable` shows).
- [ ] the tab is **absent** when a non-FlatBars engine is selected (it gates on
      the `analyse` capability).

## When a view is added or changed

1. Add it to `VIEW_TABS` in `lab/output-view.mjs` and give it a `viewKind`.
2. If it paints text, add it to the text branch in `applyView` coverage (the
   exhaustiveness test in `lab/output-view.test.mjs` will fail otherwise).
3. Add a row to this checklist for the layer-3 visual confirmation.
