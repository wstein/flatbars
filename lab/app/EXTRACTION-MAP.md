# Phase 0 — index.html inline-app extraction map

Tracks the decomposition of the ~5,000-line inline `<script type="module">` in
`lab/index.html` into `lab/app/*` modules (Phase 0 of
`PLAN-registry-local-trussbars.md`). The render/analyse adapters
(`renderer.mjs`, `playground_utils.mjs`, `panels/*`) are already extracted; this
is the **UI shell** only.

## Principles

- **Behaviour-preserving.** `test:lab` + `test:lab:browser` stay green at every
  step; each extracted module gets a peer `.test.mjs` where it has pure logic.
- **One module per commit.** No big-bang.
- **Leaves before roots.** Pure, state-free helpers first; the tangled stateful
  core (state store → explorer → render `run()` → dock) last, once the shared
  state container exists.
- **No framework introduced.** Vanilla ES modules + Preact/htm as today.

## The shared-state problem

Most of the inline app closes over module-level `let` state (`tabs`,
`activeTabIdx`, `loadedExampleIdx`, `outputView`, …) and a central `run()`. The
ordered plan introduces `app/state.mjs` (a tiny subscribe store) BEFORE extracting
any stateful section, so the explorer/tabs/dock/render modules import shared state
instead of re-closing over it.

## Status legend

✅ done · 🔜 next · ⛔ blocked on `app/state.mjs`

## Map (index.html section → target module)

| index.html section (line @ start) | Target module | State coupling | Status |
| --- | --- | --- | --- |
| engine resolution (in Bootstrap) | `app/engine-config.mjs` | none (pure) | ✅ |
| `byId`/`qs` (in Bootstrap) | `app/dom.mjs` | none | ✅ |
| `showBootError`/`bootFail` (Bootstrap) | `app/boot-error.mjs` | none (DOM-only) | ✅ (`fetchJson` stays inline → Phase 3 FileProvider) |
| State block (1876) | `app/state.mjs` (`createAppState` record) | **defines** it | ✅ primitive built + tested; **adoption incremental** (consumers adopt on extraction) |
| CodeMirror (1986): StreamLanguage tokenizers | `app/cm-languages.mjs` | none (pure) | ✅ (jsonata/js/bytecode, unit-tested) |
| CodeMirror (1986) + Output editor (2288): EditorView wiring, decoration fields, update listeners | `app/editors.mjs` | reads ~14 state vars + ~10 inline callbacks | ⛔ (the nerve center — extract last, after its callback deps move) |
| Virtual file explorer (2378) | `app/explorer.mjs` | reads/writes tabs | ⛔ |
| Tabs (2658) + open-editor helpers (2769) | `app/tabs.mjs` | reads/writes tabs | ⛔ |
| Compile + render: `previewDoc` + `applyEscape` | `app/render-helpers.mjs` | none (pure; capability passed in) | ✅ (unit-tested) |
| Compile + render `run()` (3080) + the ~25 `last*` caches | `app/render.mjs` | central; reads/writes everything | ⛔ (the nerve center — needs the ctx/DI restructure, see below) |
| Download / export (3222) | `app/export.mjs` | reads workspace | ⛔ |
| Status bar (3821) | `app/statusbar.mjs` | reads state | ⛔ |
| Output view (3865) + source-map interactions (3934) | `app/output.mjs` | reads state | ⛔ |
| Splitter (4158) + Focus mode (4251) | `app/layout.mjs` | reads state | ⛔ |
| Examples (4265) + vendored fixtures (4402) | `app/examples.mjs` | **FileProvider seam** (Phase 3) | ⛔ |
| URL state (4490) | `app/url-state.mjs` | reads/writes state | ⛔ |
| Share menu (4596) + Toast (4618) | `app/ui-chrome.mjs` | local | ✅ (toast + menu toggles; share *actions* stay inline pending saveHash/download extraction) |
| Tweaks panel (4639) | `app/tweaks.mjs` | reads/writes state | ⛔ |
| Find in all files (4845) | `app/search.mjs` | reads tabs | ⛔ |
| Wire events (5136) | `app/boot.mjs` (entry) | wires everything | ⛔ (last) |
| `makeEl` (dock DOM builder, 138 uses) | `app/dom.mjs` | none | ✅ |
| Dock Panel #6 Performance | `app/dock/performance.mjs` | reads 1 cache (`lastTimings`) | ✅ (ctx form; DOM-fake tested) |
| Dock Panel #2 Whitespace | `app/dock/whitespace.mjs` | 1 cache + openProblem + standalone flag | ✅ (ctx form; DOM-fake tested) |
| Dock Panel #7 Coverage | `app/dock/coverage.mjs` | 1 cache + rowPosition + openProblem | ✅ (ctx form; DOM-fake tested) |
| Diagnostics dock + panels 1/3/5 + Truthiness (5183–6386) | `app/dock/*.mjs` (one per panel) | read analyses caches | ⛔ (migrate one at a time, ctx form + DOM-fake test each) |
| Render Config popover (6387) | `app/config-view.mjs` | reads/writes state | ⛔ |
| Boot (6611) | `app/boot.mjs` | entry point | ⛔ (last) |

## Recommended commit order

1. ✅ `engine-config.mjs` + `dom.mjs` — pure leaves, prove the pipeline.
2. ✅ `boot-error.mjs` (smoke-covered), `app/state.mjs` primitive (tested, ready),
   and `ui-chrome.mjs` (toast + share-menu toggles, tested).
3. **Adopt `app/state.mjs`** — the first stateful extraction (`editors.mjs`) imports
   the record; its readers/writers move WITH it (contained rename, smoke-verified).
4. `editors.mjs`, then `tabs.mjs`/`explorer.mjs` (they sit on the store).
5. `examples.mjs` — extracted against a `FileProvider` interface (sets up Phase 3).
6. `render.mjs` (`run()`), `output.mjs`, dock panels (`dock/*.mjs`).
7. `boot.mjs` — the entry; index.html collapses to HTML + `<script src="./app/boot.mjs">`.

When step 7 lands, `index.html` carries no inline app logic and Phase 1
(content-hashed build) can hash the `app/*` graph as one unit.

## The entangled core needs a `ctx` (dependency-injection) restructure

The pure-leaf extractions (engine-config, dom, boot-error, ui-chrome, cm-languages,
render-helpers) are nearly exhausted. What remains — `run()`, `setOutput`, the ~25
`last*` analysis caches, `renderDock`/`renderTabs`/`renderDataInspect`, the
EditorView update listeners — is a single mutually-recursive cluster: `run()` calls
the renderers, which read the caches, which `run()` writes; the editor listeners
call `scheduleRun`/`renderTabs`. You cannot lift one function out without its
siblings.

The safe way to break it (next design step, NOT a blind sweep):

1. Land `app/state.mjs` adoption + a `ctx` object that also holds the live handles
   the cluster shares: the CM views, `lastOutput`/`lastSegments`/the `last*` caches,
   and the cross-references (`scheduleRun`, `renderDock`, …).
2. Move functions into `app/render.mjs` / `app/dock/*.mjs` as `(ctx) => …` closures,
   one at a time, index.html holding and passing `ctx`. Each move is behaviour-
   preserving and smoke-verifiable (the smoke covers the boot→render→provenance→
   data-access path strongly).
3. When the cluster is fully in modules, `ctx` becomes the module-internal store and
   the `let`s leave index.html for good.

This is a deliberate restructure, not a leaf extraction — worth its own design note
before implementation.
