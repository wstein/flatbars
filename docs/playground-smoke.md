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
- [ ] **Truthiness** (ADR-022) — for a template with an ambiguous condition over
      empty/zero data (e.g. `{{#if bio}}…{{/if}}` with `{"bio":""}`):
  - [ ] the report renders as **markdown** (headings, the `⚠`/`✓` lines).
  - [ ] it names the finding, the flipping engines, the fix, and `data path:`.
  - [ ] editing the data re-runs the report (no stale content).
  - [ ] switching away and back repaints (no blank pane, no leftover iframe).
  - [ ] the tab is **absent** when a non-FlatBars engine is selected (it gates on
        the `analyse` capability).

## When a view is added or changed

1. Add it to `VIEW_TABS` in `lab/output-view.mjs` and give it a `viewKind`.
2. If it paints text, add it to the text branch in `applyView` coverage (the
   exhaustiveness test in `lab/output-view.test.mjs` will fail otherwise).
3. Add a row to this checklist for the layer-3 visual confirmation.
