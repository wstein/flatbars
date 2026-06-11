# FlatBars Lab — Engine Registry, Local Dev Tool & Trussbars-WASM Citizen

Status: proposed (2026-06-11). Supersedes the "Roadmap" section of `lab/PLAN.md`
for the engine-plurality + local-dev arc; the ADR-0020 seam and capability-vector
described there are the foundation this builds on.

## Goals (from the debate consensus)

1. **trussbars-wasm as an additive engine citizen** — peer to the PureScript
   oracle, not a replacement. Both register against one interface; the UI labels
   one *reference*, one *shipping*, and can diff them.
2. **The Lab as a local developer tool** — render and *analyse local templates on
   disk*, via a user-launched localhost transport, without sacrificing the hosted
   zero-ops static deploy.
3. Kill the structural debt that blocks both: the ~5,000-line inline app in
   `index.html` and the manual `?v=N` cache-buster.

## Reality check (what already exists — do NOT rebuild)

| Capability the debate wanted | Already in tree | File |
| --- | --- | --- |
| Uniform engine seam (ADR-0020) | ✅ `createRenderer(dialect)` returns the seam object | `lab/renderer.mjs` |
| Capability honesty (panels hide on unsupported) | ✅ `engine-features/v1` + `hasFeature`/`featureFidelity`/`tabVisibleUnder` | `lab/playground_utils.mjs`, `lab/renderer.mjs` |
| File-access choke point | ✅ all I/O via `fetch`/`fetchJson`, centred on `loadExample` | `lab/index.html` ~4341 |
| Root-jailed static server w/ `.wasm` MIME | ✅ `makeHandler` (traversal-rejecting) | `scripts/serve-lab.mjs` |
| Differential substrate | ✅ two spec impls (oracle JS + Trussbars Rust) + 71/71 corpus | repo-wide |

What is genuinely missing: (a) an **engine-provider axis** orthogonal to dialect
(today `createRenderer` always wires the PureScript bundle); (b) `trussbars-wasm`
itself; (c) a **FileProvider abstraction** over the `fetch` calls; (d) the
**local-FS transport**; (e) decomposition of the inline app; (f) content-hashed
build to retire `?v=N`.

## The two frozen interfaces (build these FIRST, with one provider each)

### A. EngineProvider / Engine (generalises the existing seam)

```text
EngineProvider = {
  id:    "oracle" | "trussbars",
  label: string,                      // "Reference (PureScript)" | "Trussbars (Rust/WASM)"
  kind:  "reference" | "shipping",
  load(): Promise<void>,              // lazy: fetch/instantiate the bundle/wasm
  create(dialect, opts): Engine,      // the EXISTING ADR-0020 factory, unchanged
}

Engine = {                            // FROZEN — byte-identical to today's seam
  render, compile, parseAst, inspectAt,
  usedTransformers, requiredAssigns, partialGraph,
  analyze, analyzeWith, lint, migrate, compileToJs,
  allTransformers, catalog,
  engineInfo(): { version, builtins, features },   // engine-features/v1 vector
  version,
}
```

Rules:
- The `Engine` shape is **frozen before the refactor ships** (Kos's condition).
  trussbars-wasm targets this fixed contract.
- A provider advertises a **possibly-smaller feature vector**. trussbars-wasm
  ships v1 advertising `["render","catalog","compile-js","analyse"]` and
  *omitting* `source-map`/`context-inspect` until its provenance map lands — the
  existing capability gate then hides those panels for Trussbars **with no UI
  code change**. This is the honesty mechanism doing exactly its job.
- Per-transport default provider: hosted ⇒ `oracle`; local ⇒ `trussbars`. Either
  is loadable on either surface (for the differential).

### B. FileProvider (extracted from the `fetch` calls)

```text
FileProvider = {
  id:    "http" | "fs-access" | "local",
  capabilities: Set<"read"|"list"|"watch"|"write">,
  readText(path): Promise<string>,
  readJson(path): Promise<any>,
  list(dir):  Promise<Array<{name, kind:"file"|"dir"}>>,   // gated on "list"
  watch?(path, cb): () => void,                            // gated on "watch"
  writeText?(path, content): Promise<void>,                // gated on "write"
}
```

Three implementations, one interface:
- `http` — wraps `fetch` (today's behaviour); read-only; hosted default.
- `fs-access` — `showDirectoryPicker()`; read + opt-in write; hosted "Open Folder".
- `local` — talks to the localhost dev-server FS endpoints; read/list/watch +
  opt-in write; the local-dev default.

Transport is chosen by `?transport=` (default `http`), or forced to `local` when
the page is served by `trussbars lab` (the server injects
`<meta name="fb-transport" content="local">` + a session token).

### Decided (2026-06-11)

- **trussbars-wasm runs in-page on BOTH transports.** Hosted and local Lab both
  instantiate the same wasm engine in the browser. Consequence: there is **one
  Trussbars render path everywhere (wasm)** — no native-vs-wasm equivalence
  burden, and the local server **never renders** (it is a pure FileProvider
  transport: no `/render` endpoint). The wasm artifact is conformance-built and
  content-hashed exactly like the JS bundle.
- **The Trussbars Rust binary owns the `lab` subcommand** (`trussbars lab [dir]`).
  It already has the ratatui TUI + filesystem code; it serves the static Lab
  bundle and the root-jailed `/__fs/*` API. Because the engine is in-page wasm,
  the binary's job is *serving files*, not running templates — the FS bridge and
  the engine are fully decoupled.

## Phases (strict order — each lands green before the next)

### Phase 0 — Decompose the inline app  *(prerequisite; no behaviour change)*

The monolith is the inline `<script type="module">` in `index.html` (~1655–6685).
The engine adapters are already out; this extracts the **UI shell** into modules
under `lab/app/`, leaving `index.html` as HTML + `<script src="./app/boot.mjs">`.

Proposed split (mirrors the existing function clusters):

| Module | Absorbs (current inline functions) |
| --- | --- |
| `app/state.mjs` | tabs / openEditors / dataOverlays / partials / loadedExampleIdx + a tiny subscribe store |
| `app/editors.mjs` | CodeMirror setup, `setEditorText`, highlight, lint-gutter wiring |
| `app/explorer.mjs` | `renderExplorer*`, `renderTabs`, strips, rename, open/close, `selectTemplateTab` |
| `app/examples.mjs` | `loadExample`, vendored loading — **rewritten on FileProvider** |
| `app/dock.mjs` | dock panels (problems, transformers, data-access, partials, capabilities, perf, coverage), capability-gated |
| `app/inspect.mjs` | AST / Context-Inspector views |
| `app/boot.mjs` | parse URL params, pick provider+transport, create engine, mount Preact view |
| `app/persist.mjs` | localStorage today; pluggable later |

Guardrails: behaviour-preserving (the `test:lab` node suite + `test:lab:browser`
smoke must stay green); each module gets a `.test.mjs` peer like the existing ones
(`renderer.test.mjs`, `playground_utils.test.mjs` are the pattern). No framework
introduced — vanilla ES modules + Preact/htm as today (honours the deliberate
de-Halogen decision).

### Phase 1 — Content-hashed build, retire `?v=N`

Introduce an esbuild entry that emits content-hashed module filenames and an
import map (or hashed `boot.<hash>.mjs`). This **replaces** the manual `?v=N`
sprinkled across imports and the hand-maintained `lab/cachebust.lock.json`.

- Remove `check:lab-cachebust` + `gen:cachebust`; the hash *is* the cache key, so
  "stale engine in the Lab" becomes structurally impossible (the recurring bug).
- `gen:bundle` still produces `vendor/flatbars-engine.mjs`; the build step hashes
  it on the way into the page. **Net gate change: −1 gate, −1 footgun** (Olund's
  condition: replace, don't layer).

### Phase 2 — Engine registry (one provider: oracle)

Wrap today's `createRenderer` in `app/engines/registry.mjs` exposing the
`EngineProvider` interface, with **`oracle` as the only registered provider**.
`boot.mjs` resolves provider→`create(dialect)` instead of calling `createRenderer`
directly. Freeze the `Engine` shape here (write it down as
`lab/app/engines/contract.md`). No new engine yet — this proves the seam with the
engine we have, so the second engine is a drop-in (Pris's sequencing argument).

### Phase 3 — FileProvider seam (two providers: http, fs-access)  ✅ DONE (2026-06-11)

Replace direct `fetch`/`fetchJson` in `app/examples.mjs` with
`provider.readText/readJson/list`. Ship `http` (default, behaviour-identical) and
`fs-access` ("Open Folder" on the hosted Lab — Chromium-only, gated on
`capabilities.has("list")`). This delivers a *first* slice of "local templates"
with **zero server** and proves the transport abstraction with two real providers
(Rune's condition: extract the interface from two working impls, don't speculate
it).

### Phase 4 — trussbars-wasm provider (citizen #2)  ✅ DONE (2026-06-11)

New crate `trussbars-wasm` (`wasm-bindgen`, `crate-type=["cdylib","rlib"]`) wrapping
the `trussbars-interp` engine. Built to `lab/vendor/trussbars-engine.{js,_bg.wasm}` by
`scripts/gen-trussbars-wasm.mjs` (`npm run gen:trussbars-wasm` — cargo wasm32 →
wasm-bindgen → content-stamp the glue's `_bg.wasm` URL; the glue hash then propagates
through `hash-lab.mjs`). `lab/app/engines/trussbars.mjs` registers a `trussbars`
`EngineProvider` whose async `create()` lazily instantiates the wasm and returns the
frozen `Engine` seam. **v1 feature vector is empty (render-only)** — every analysis
member is an inert, gated-off stub, so the capability gate hides Transformers / Data
Access / Truthiness / Lint / Context Inspector / Compiled JS with no UI change. Render
is byte-identical to the native binary (same JSON→Value ingestion + ECMA-f64 formatter).
Tested against the REAL wasm (`trussbars.test.mjs` instantiates from the committed
bytes; Rust unit tests cover the pure core). Not yet user-selectable — the provider
PICKER is Phase 7 (the differential view); boot still defaults to oracle.

**Runs in-page on both transports (decided).** Same wasm engine in the browser
hosted *and* local — one Trussbars render path, no native-vs-wasm equivalence
problem, and the Phase-5 server stays render-free.

- Gate: `check:bundle`-analog for the wasm artifact (content-hashed like Phase 1).
- Lazy-loaded: oracle first-paints; trussbars `load()` fires on demand.

### Phase 5 — Local dev transport (`flatbars lab`) + `local` FileProvider  ✅ DONE (2026-06-11)

Shipped in two independently-green parts:
- **The `local` FileProvider + transport detection** (`lab/app/file-provider.mjs`):
  `localFileProvider` talks to the `/__fs/*` bridge (read + list) sending the session
  token; `detectTransport`/`selectFileProvider` pick the transport from the served page
  (`<meta name="fb-transport" content="local">` + `window.__FB_TOKEN`), defaulting to
  `http`. 17 file-provider tests.
- **The FS bridge server** — a Node reference (`scripts/lab-server.mjs`, `npm run
  lab:local`) AND the Rust binary that owns it (`trussbars/crates/trussbars-lab`, the
  `trussbars-lab` bin, std-only — no HTTP deps). Both serve the static Lab + a
  root-jailed `/__fs/{read,list,write}` API with the full security baseline (session
  token, CSRF `Origin` guard, read-only unless `--write`, bind 127.0.0.1). The server
  NEVER renders (the engine is in-page wasm). The pure logic is unit-tested both sides
  (8 Node + 7 Rust) and proven end-to-end over a real socket.

**Deferred to Phase 6 (with the project model):** flipping boot to the `local` provider
(the example loader still uses the `http` app assets — a project dir ≠ the bundled
examples), the `<meta fb-transport=local>` injection, and `/__fs/watch` SSE. The token
is already injected; the bridge is live.

Original design (retained for reference):

The **Trussbars Rust binary owns this** (`trussbars lab [dir]`, decided). It
serves the static Lab bundle **and** exposes a narrow, root-jailed FS API. Because
the engine is in-page wasm, the server **never renders** — it is purely a file
transport (`serve-lab.mjs`'s `makeHandler` is the reference behaviour to port to
Rust, or kept as a Node fallback for the hosted preview):

```
GET  /__fs/read?path=    → text          (root-jailed; mirrors makeHandler's resolve+startsWith guard)
GET  /__fs/list?path=    → dir entries
GET  /__fs/watch         → SSE change stream (notify/fs.watch under root)
POST /__fs/write         → opt-in (`--write`), token-guarded
```

Security baseline (Olund's hard line — blocks the phase without all three):
1. **Root-jail** every path to the launch dir (the existing
   `file.startsWith(root + sep)` check, reused).
2. **Per-session token** injected into the served HTML (`window.__FB_TOKEN`),
   required on every `/__fs/*` request; reject cross-origin via `Origin` check
   (CSRF guard — a malicious page can't hit `localhost:PORT`).
3. **Read-only by default**; writes only behind `--write`.
Plus: random port, bind `127.0.0.1` only.

The `local` FileProvider talks to these endpoints; `boot.mjs` detects the
injected `<meta fb-transport=local>` and defaults the provider to `trussbars`.

### Phase 6 — Project model + watch  ✅ DONE (2026-06-11)

The toy→workbench jump, in three tested layers:
- **watch** — `/__fs/watch` SSE on both servers (Node `fs.watch`; the Rust binary
  std-only mtime polling via `scan_mtimes`/`diff_scans`) + `watch(cb)` on the `local`
  FileProvider (consumes the SSE through a fetch stream so the token rides in the
  header). Proven end-to-end over a real socket both sides.
- **the project model** (`lab/app/project.mjs`) — walks a `list`+`read` provider tree
  (skipping `node_modules`/dotdirs, bounded by `maxFiles` with truncation surfaced),
  classifies templates vs data, picks a `main` (index/main/shallowest) + cross-tree
  partials (keyed by path-without-ext) + a data file. 6 unit tests with a fake provider.
- **boot project mode** (`lab/index.html`) — when `detectTransport` sees the injected
  `fb-transport=local` meta, `enterProjectMode` loads the workspace instead of the
  bundled examples and wires `watch → reload + run` (render-on-save; the on-disk file is
  the source of truth). Verified in a real browser (`lab/test/local_project_smoke.mjs`):
  project mode, on-disk render with a cross-tree partial, and render-on-save all pass.

**Still deferred:** glob-based `analyze`/`lint` across the tree, `fs-access` change
observers (its `watch` capability), and the `app/persist.mjs` disk-backed project
store (localStorage remains the hosted fallback). Writes from the Lab back to disk
(`/__fs/write` exists, gated `--write`) are not yet wired to the editors — project
mode reflects disk read-only for now.

### Phase 7 — Differential view + provenance diff

Multi-provider compare panel: run all registered providers, diff outputs
byte-level (v1), then span-level once trussbars-wasm emits the provenance map
(ADR-035) — divergences become *locatable* ("oracle vs Trussbars diverge at this
span"). A "report divergence" affordance emits a corpus-shaped fixture (closing
the loop into the 71/71 suite). Directional verdict: oracle = reference (green),
Trussbars = candidate (flagged on mismatch).

## Gate impact summary

| Gate | Effect |
| --- | --- |
| `check:lab-cachebust` / `gen:cachebust` | **removed** (content-hash replaces it) |
| `check:bundle` | reused; **+1 analog** for `trussbars-engine.wasm` |
| `test:lab` | **+ tests** per new `app/*` module + registry + FileProvider + FS-endpoint unit tests |
| `check:provenance` | unchanged for oracle; Trussbars gates off until it advertises `source-map` |
| `test:lab:browser` | extended to cover the differential + local transport happy/sad paths |

## Risks & mitigations

- **Phase 0 regressions** (extracting 5k lines): strictly behaviour-preserving,
  one module at a time, peer `.test.mjs` + the browser smoke as the net.
- **trussbars-wasm provenance gap**: shipped as a v1 *render-only* citizen; the
  capability gate hides what it can't back — it never lies. Provenance is a
  fast-follow (Phase 7), not a launch blocker.
- **Local-FS security**: the three-part baseline is non-negotiable and standard
  (Vite/webpack-dev-server precedent); writes opt-in.
- **Two `lab`s** (web vs ratatui TUI): TUI frozen at maintenance-only, not
  deleted, until the web-local path provably covers headless/SSH cases.
- **Scope creep into a hosted backend**: explicitly rejected — the local server is
  user-launched, ephemeral, localhost-only; the hosted Lab stays static.

## Sequencing rationale (one line)

Decompose (0) → de-footgun the build (1) → freeze the seam with one engine (2) →
prove the transport with two file providers (3) → drop in the second engine (4) →
add the local server (5) → workspace + watch (6) → differential (7). Every phase
is independently shippable and green; the two new engines and the local tool all
fall out of the two frozen interfaces.
