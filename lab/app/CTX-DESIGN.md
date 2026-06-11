# The `ctx` restructure — breaking the render/dock core out of index.html

The pure-leaf extractions (engine-config, dom, boot-error, ui-chrome, cm-languages,
render-helpers) are done. What remains in index.html is one mutually-recursive
cluster that cannot be lifted a function at a time without a shared context:

```
run()  ──writes──▶  last* caches  ──read──▶  renderDock / renderTabs / renderDataInspect
  ▲                                                   │
  └──────────── scheduleRun ◀── editor update listeners
```

This note fixes the approach BEFORE implementation (the project's
"decide-before-implementing" rule), so the moves stay mechanical and
smoke-verifiable rather than a risky rewrite.

## The context object

A single `ctx`, created at boot, holds everything the cluster shares. It is a
plain mutable object — the SAME imperative model index.html uses today (no reactive
store), just relocated so the functions can move out:

```js
const ctx = {
  state,            // createAppState(ENGINE) — the UI `let`s (tabs, outputView, …)
  engine: { renderer, engineHas, engineFeatures, ENGINE, ENGINE_LABEL },
  views: { templateView, dataView, outputEditor },   // live CM handles
  caches: {         // the ~25 `last*` render/analysis caches
    lastOutput: "", lastSegments: [], lastData: null, lastProgram: null,
    lastSegViews: [], lastUsedTransformers: [], lastTimings: null, lastAst: null,
    lastDataAccess: [], lastWhitespace: [], lastDeps: null, lastCalls: [],
    lastEscapeRuns: null, lastCoverage: [], lastAnalyse: { ok: true, findings: [] },
    lastAnalyseSuppressed: 0, lastLint: { ok: true, findings: [] },
    lastRequiredAssigns: [], lastMissingAssigns: [],
    dockProblems: [], dockActiveTab: "problems", hadProblems: false,
  },
  fns: {},          // cross-references (scheduleRun, run, renderDock, …) filled as
                    // functions move out, so a moved fn calls ctx.fns.scheduleRun(ctx)
};
```

`ctx` mutates in place exactly where the `let`s were reassigned — `lastOutput = x`
becomes `ctx.caches.lastOutput = x`. No semantic change.

## Progress

- ✅ All 11 dock/inspector panels extracted to `app/dock/*.mjs` (leaf consumers).
- ✅ `ctx` object introduced; the output caches (lastOutput/lastSegments/lastData/
  lastProgram) migrated into `ctx.caches.*` via a word-boundary sweep (43 sites),
  rename-only — verified by the smoke (a missed site throws a loud ReferenceError).
  Other last* caches migrate into ctx.caches as their owning subsystem moves.
- ✅ `setOutput` → `app/output.mjs` (createSetOutput factory: binds ctx + the five
  host refreshers + the active-view getter; call sites unchanged). First core fn.
- ✅ paintTextView + renderPreview + setOutputDoc + buildProvenance folded into the
  same `createOutputView(ctx, host)` factory. lastSegViews migrated into ctx.caches.
  Output subsystem fully modular.
- ✅ run() + scheduleRun → app/render.mjs (createRun(ctx, host) factory, ~40 deps).
  THE render root — the most-coupled fn — is out. Branch-tested (compile/YAML/
  transform/denial/helper/missing-assign) since the smoke covers only the happy path.

## Move order (leaf-most consumers first, run() last)

Each function moves to a module as `export function f(ctx, …args)`; index.html
calls `f(ctx, …)`. After each move: `npm run test:lab` + the browser smoke
(`npm run test:lab:browser`) — which covers boot → render → provenance →
data-access → partials → jump-to-source — must stay green.

1. ✅ **`outputHasContent(view, caches)`** — pure cache reader; the gateway proof
   (this commit; lives in `render-helpers.mjs`, no ctx needed yet — it takes the
   cache snapshot directly).
2. **Dock panel renderers** → `app/dock/*.mjs` — each reads `ctx.caches.*`; they are
   leaves of the graph (nothing calls back into run()).
3. **`setOutput` / `paintTextView` / `renderPreview`** → `app/output.mjs` — write
   `ctx.caches.lastOutput`, call the dock renderers via `ctx.fns`.
4. **`run()` / `scheduleRun`** → `app/render.mjs` — the root; moves once everything
   it calls is already a `ctx.fns` entry.
5. **Editor update listeners** → fold into `app/editors.mjs`, calling
   `ctx.fns.scheduleRun` / `ctx.fns.renderTabs`.

When the cluster is fully in modules, `ctx` becomes their shared store and the
`let`s leave index.html entirely (the Phase-0 finish line: index.html = HTML +
`<script src="./app/boot.mjs">`).

## Why a plain mutable ctx, not a reactive store

index.html already re-renders imperatively (explicit `run()`/`renderX()` after
mutations). Introducing subscriptions would be a paradigm change — out of scope for
a behaviour-preserving extraction. `ctx` is the minimum that lets the functions
leave the file; a reactive layer (if ever wanted) is a separate, later decision.
