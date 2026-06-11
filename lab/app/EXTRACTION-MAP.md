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
| `showBootError`/`bootFail`/`fetchJson` (Bootstrap) | `app/boot-error.mjs` | none (DOM-only) | 🔜 |
| State block (1876) | `app/state.mjs` (subscribe store) | **defines** it | 🔜 (unblocks the rest) |
| CodeMirror (1986) + Output editor (2288) | `app/editors.mjs` | reads state | ⛔ |
| Virtual file explorer (2378) | `app/explorer.mjs` | reads/writes tabs | ⛔ |
| Tabs (2658) + open-editor helpers (2769) | `app/tabs.mjs` | reads/writes tabs | ⛔ |
| Compile + render `run()` (3080) | `app/render.mjs` | central; reads all | ⛔ |
| Download / export (3222) | `app/export.mjs` | reads workspace | ⛔ |
| Status bar (3821) | `app/statusbar.mjs` | reads state | ⛔ |
| Output view (3865) + source-map interactions (3934) | `app/output.mjs` | reads state | ⛔ |
| Splitter (4158) + Focus mode (4251) | `app/layout.mjs` | reads state | ⛔ |
| Examples (4265) + vendored fixtures (4402) | `app/examples.mjs` | **FileProvider seam** (Phase 3) | ⛔ |
| URL state (4490) | `app/url-state.mjs` | reads/writes state | ⛔ |
| Share menu (4596) + Toast (4618) | `app/ui-chrome.mjs` | local | 🔜 |
| Tweaks panel (4639) | `app/tweaks.mjs` | reads/writes state | ⛔ |
| Find in all files (4845) | `app/search.mjs` | reads tabs | ⛔ |
| Wire events (5136) | `app/boot.mjs` (entry) | wires everything | ⛔ (last) |
| Diagnostics dock + panels 1–7 + Truthiness (5183–6386) | `app/dock/*.mjs` (one per panel) | reads analyses | ⛔ |
| Render Config popover (6387) | `app/config-view.mjs` | reads/writes state | ⛔ |
| Boot (6611) | `app/boot.mjs` | entry point | ⛔ (last) |

## Recommended commit order

1. ✅ `engine-config.mjs` + `dom.mjs` (this commit) — pure leaves, prove the pipeline.
2. `boot-error.mjs` + `ui-chrome.mjs` (toast/share) — DOM-only leaves, no app state.
3. `app/state.mjs` — the subscribe store; migrate the State block. **Unblocks all ⛔.**
4. `editors.mjs`, then `tabs.mjs`/`explorer.mjs` (they sit on the store).
5. `examples.mjs` — extracted against a `FileProvider` interface (sets up Phase 3).
6. `render.mjs` (`run()`), `output.mjs`, dock panels (`dock/*.mjs`).
7. `boot.mjs` — the entry; index.html collapses to HTML + `<script src="./app/boot.mjs">`.

When step 7 lands, `index.html` carries no inline app logic and Phase 1
(content-hashed build) can hash the `app/*` graph as one unit.
