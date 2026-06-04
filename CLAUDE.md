# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FlatBars is a template-engine **construction kit**, not a template engine. The
core is a meaning-free parser; everything you expect from Handlebars/Mustache
(helpers, escaping, control flow, path semantics) is supplied by an *engine*
built on top. This is a PureScript monorepo holding the reference
implementation and a CLI, plus the normative spec in `docs/` and the FlatBars Lab
(a JS/WASM polyglot playground in `lab`, served as static files).

The spec in `docs/` is the contract; the PureScript packages target it.
`docs/modules/ROOT/pages/concepts.adoc` is the fastest way to understand the
core model; `host-api.adoc` defines the API `core` exposes. `npm run docs` builds
the spec site (Antora: `antora-playbook.yml` is the site config, `docs/antora.yml`
the component descriptor); the `docs/supplemental-ui/` UI brings it into the
FlatBars design system (the shared tokens + IBM Plex + violet accent + logo). The
build reads content from git HEAD, so a *linked git worktree* can't build it in
place — run it from a normal checkout.

## Toolchain & commands

The PureScript toolchain (`purs`/`spago`) is provisioned per-project via npm —
do **not** assume a global install.

```sh
npm install            # installs purescript + spago + esbuild
npm run build          # spago build — compile every package
npm test               # full suite: format:check + per-package spago tests + catalog + isolation + compile & (handlebars/mustache) conformance + Lab unit tests + editor gates (highlight/tmgrammar/vocab/lsp/vscode/jetbrains)
npm run cli -- --help  # run the CLI (spago run -p flatbars-cli)
npm run lint           # spago build --pedantic-packages (catches unused/missing deps)
npm run format         # purs-tidy format-in-place; format:check to verify only
```

Run one package's PureScript tests directly (faster than `npm test`):

```sh
spago test -p maxbars        # or flatbars / fullbars / kernel / rawbars / flatbars-json / fullbars-compile / flatbars-js
```

There is no finer-grained-than-package test runner; each package's tests run
through a single `Test.<Pkg>.Main`.

Two Node-based gates beyond the spago tests (both require `spago build` first,
which they invoke):

```sh
npm run test:compile   # conformance harness: asserts the INTERPRETER and the COMPILED JS
                       # produce byte-identical output for every case
npm run check:catalog  # fails if docs' helper-catalog partial is stale vs FullBars.preludeSchema
npm run gen:catalog    # regenerate that partial after changing the prelude
```

These Node scripts import from `output/` (the spago build product), so they
always test current source — rebuild before running them.

Differential conformance proofs live under `conformance/` (both gated in `npm
test`, both write a committed `report.json` so the score can't silently drift):

```sh
npm run gen:hbs-conformance       # FullBars vs the REAL handlebars npm pkg (dev-only oracle),
npm run check:hbs-conformance     # asserting byte-identical; currently 49/50 (98%)
npm run gen:mustache-conformance  # MinBars vs the FULL official mustache/spec (every module),
npm run check:mustache-conformance # 184/184 (100%) of the modules MinBars implements
```

`conformance/handlebars/` renders a categorised corpus through real Handlebars
*and* FullBars; `conformance/mustache/` runs the whole vendored `mustache/spec`
(optional `~` modules included) through MinBars against each fixture's own
`expected`. Each dir's `README.md` documents the method and the boundary
(in-data lambdas: value-producing → precompute, body-aware → a block helper —
ADR-020; functions-in-`Value` stays out by design).

Mustache conformance for MinBars (both run from real `mustache/spec` fixtures):

```sh
npm run examples:verify       # STRICT gate (in `npm test`): render each vendored fixture via
                              # MinBars and assert actual == expected; exit ≠ 0 on any miss
node scripts/vendor-mustache.mjs   # re-vendor lab/examples/vendored/mustache/ at the pinned commit
npm run test:minbars-spec     # LENIENT measurement: per-module pass counts; always exits 0
npm run test:lab              # FlatBars Lab pure-Node unit tests (playground_utils, adapter)
```

The `tutorials` site has its own two gates (both in `npm test`, no `spago build`
needed — they import the committed lab bundle):

```sh
npm run check:tutorial-links  # render every tutorial example through the real engine + build its
                              # Open-in-Lab link; also fails on an orphaned (defined-but-unshown) example
npm run gen:conformance       # regenerate tutorials/src/conformance.json from the vendored mustache/spec suite
npm run check:conformance     # fail if that file is stale (so the reference can't over-claim conformance)
```

`examples:verify` is the `flatbars examples verify` CLI subcommand (see
`example-loader-spec.md`). The FlatBars Lab loads the same corpus via the
`?vendored=<id>` deep-link (`lab/index.html`), framing each fixture's
expected-vs-actual verdict. Note the overlap with `test:minbars-spec`: both render
`mustache/spec` through MinBars but from **two separate vendored corpora**
(`lab/examples/vendored/mustache/` vs `packages/minbars/test/spec/`). Consolidating to
one corpus is a tracked follow-up (the spec's `verify` is intended to supersede the
measurement harness).

## Architecture

### The IoC pattern (read this first)

The whole system is one idea applied four times: **the core walks the
structural tree and calls into pluggable rules; "don't call FlatBars, FlatBars
calls you."** The four instances:

| Operation | Driver (meaning-free) | Plug-in (the meaning) |
| --- | --- | --- |
| **interpret** | `Kernel.Engine` traversal | `Engine` (helper meanings) |
| **desugar** | a `foldTemplate` | rewrite rules (`Kernel.Lower`) |
| **validate** | `Kernel.Walk` | a `Schema` |
| **compile** | `FlatBars.Compile` emit driver | an `Emit` record (per dialect) |

The interpret driver is polymorphic in the result monad `m`
(`MonadThrow Error m` — `Either Error` for pure, `ExceptT Error Aff` for async)
and in the environment type `env`. The reference engine picks `RefEnv` (a stack
of helper frames + current context).

### Two phases

1. **Parse → skeleton AST.** `core` (`flatbars`) is purely structural: lexer,
   expression tokenizer, parser, the skeleton `Syntax` AST (`Content`/`Output`/
   `Block` nodes), the literal `Value` type, source spans, parse errors. It
   attaches **no meaning** — it doesn't know what `each` is, doesn't know
   `else`, does no name resolution.
2. **Walk.** An engine supplies the second pass. The reference engine lives in
   `kernel` + `fullbars`.

Key core facts (see `concepts.adoc`): everything is a helper application
(`{{{city}}}` *calls* helper `city` — there are no variables); application is
juxtaposition, parens only group; the head of an application is always a name;
scope is just scoped helpers that blocks install/remove. `{{else}}` is a
name-agnostic `Sep` *separator* the engine splits on, not a keyword.

### Package layers (dependencies point downward)

- **`core` (`flatbars`)** — the framework: lexer, parser, skeleton AST, `Value`,
  spans, errors. No engine, no helpers, no validation. The parser is *recovering*
  (`parseRecovering` → tree + all errors, `NodeError` nodes); the total fail-fast
  `parse` is its projection — one parser, not two (ADR-023).
- **`kernel`** — the shared engine machinery, dialect-agnostic: `Engine` (IoC
  interpret driver), `Env`/`RefEnv`, `Helper` (arity combinators), `Lower`
  (structural → typed "real" AST), `Prelude` (the reference helpers + schema),
  `Hoist` (`hoistInline`: lift `{{#inline}}` definitions into the partial registry —
  a shared pre-pass every dialect runs, not a surface feature),
  `Render` (`runResolved`: parse → seed the prelude env with the engine's fixed
  truthiness rule → run), `Value`, `Walk`.
- **`fullbars`** — the reference engine + its surface dialect (`{{ }}`
  auto-escape, dotted paths, `@data`, `as |x|`). Re-exports kernel modules and
  adds surface desugar/compile/render.
- **The dialect ladder: RawBars ⊂ FullBars ⊂ MaxBars** (the `⊂` is surface-superset
  *modulo documented exceptions* — MaxBars is the flagship that reuses FullBars's engine
  wholesale and borrows most, not all, of its surface; see the ADR-005 amendment).
  All three share one
  engine, prelude, and compiler, differing mainly in *surface syntax* (swapped in
  through the `ParseOptions.parseExpr` seam). They *diverge* in one value-policy
  axis — truthiness (ADR-022): FullBars uses `handlebars`, RawBars/MaxBars use
  `nonEmpty` (`false null "" [] {}` falsy; `0` truthy), MinBars uses `mustache`.
  `check:parity` (in `npm test`) machine-checks that RawBars ≡ MaxBars — the exact
  `nonEmpty` falsy set and byte-identical rendering over a shared core corpus —
  modulo documented surface exceptions (the ADR-021 loop-variable model; the
  `{{#*inline}}` decorator).
  Truthiness is a `Value -> Boolean` callback the engine plugs in (no falsy-set
  data, no per-file `@truthiness`):
  - **`rawbars`** — core skeleton syntax directly, no surface sugar.
  - **`fullbars`** — adds the Handlebars-style surface desugar.
  - **`maxbars`** — the flagship surface: reuses FullBars's engine by dependency and
    adds infix operators and pipes (`MaxBars.Expr`), desugaring to the same core
    `Expr`. Borrows most of FullBars's surface, not quite all (a few FullBars-only
    constructs diverge — see `maxbars.adoc`).
- **`compile`** (`flatbars-compile`) — the dialect-agnostic emit driver →
  `export default function (data, rt)`. **`fullbars-compile`** layers the
  surface compiler on top. Emitted JS runs against
  `packages/compile/runtime/flatbars-runtime.mjs`.
- **`json`** (`flatbars-json`) — JSON ⇆ `Value` adapter, deliberately kept out
  of `core` (JSON-ness is a host concern, not a framework dependency).
- **`js`** (`flatbars-js`) — JS/FFI surface bundling the dialects for JS hosts
  (bundled to `lab/vendor/flatbars-engine.mjs` for the FlatBars Lab).
  That bundle is a **committed artifact**: regenerate it after any engine change
  (or the Lab runs stale) with **`npm run gen:bundle`** — it rebuilds `output/`
  then esbuilds it to `lab/vendor/flatbars-engine.mjs`, the exact product
  `check:bundle` verifies. (Always go through `gen:bundle`, not a bare `esbuild`:
  the formatter reshapes the compiled output, so a bundle made before `npm run
  format` is stale — `gen:bundle` rebuilds first, removing that footgun. Note a
  bare `spago bundle --outfile …` resolves the path *relative to the package dir*,
  writing to `packages/js/…`, not here.) The bundle URL is imported with a `?v=N`
  cache-buster (in `lab/index.html`, `lab/flatbars.mjs`, `lab/minbars.mjs`,
  `lab/helpers-worker.mjs`) — **bump that `N` whenever you regenerate the bundle**,
  or browsers serve a cached old copy (the cause of "the Lab runs an old engine"
  even though `check:bundle` is green).
- **`cli`** (`flatbars-cli`) — render templates, and the `examples verify`
  conformance gate.
- **`linter`** — cross-dialect lowering (MaxBars → RawBars source).

The web playground is **`lab`** (the FlatBars Lab — plain HTML/JS/WASM,
not a PureScript package). The old Halogen `packages/playground` was removed.

The **`tutorials`** site (Astro + Preact, also not a PureScript package) is the
learner-facing front end: every surface now has a comprehensive runnable
reference — **MinBars/Mustache** (`/minbars`, the recommended start) leads, with
**RawBars** (`/rawbars`, the meaning-free core, live compiled-JS pane),
**FullBars** (`/fullbars`, Handlebars-faithful), and **MaxBars** (`/maxbars`, the
flagship: infix operators, pipes, bare loop vars) alongside. (The
old one-example `[surface].astro` lesson page is gone — the dedicated references
supersede it.) Runnable examples are gate-validated
(`check:tutorial-links`, which also asserts the compile flagship emits JS) and the
Mustache conformance table is generated from the vendored spec suite
(`gen:conformance`); see `tutorials/README.md`.

The **`editors`** tree (also not PureScript) is the third-party editor support of
ADR-017 — highlighting in real editors by *running the engine lexer*, never by
approximating it. `editors/token-vocabulary.json` is the single source of truth
its three consumers share (the engine `tokenize` kinds, the LSP semantic-token
legend, the TextMate scopes). `editors/flatbars.tmLanguage.json` is the best-effort
TextMate *fallback* (the floor for no-LSP contexts): the well-known Handlebars
grammar re-identified as `source.flatbars` and extended for all four dialects,
keeping its familiar scope names, drift-bounded by `check:tmgrammar`. `editors/lsp`
(`flatbars-lsp`) is the authoritative language server — it embeds the committed
`flatbars-js` bundle and answers `semanticTokens/full` from `tokenize` plus
`publishDiagnostics` from `diagnostics` (the recovering parser, ADR-023)
(`test:lsp`). `editors/vscode` is the VS Code extension bundling the LSP client +
grammar (`test:vscode`, a headless smoke test that also asserts the auto-activation
precondition; its `dist/` is a git-ignored build product). The end-to-end activation
path — auto-activate on opening a file → semantic tokens + diagnostics surface — is
proven by a real-IDE test (`test:vscode:ide`, `@vscode/test-electron`), too heavy for
`npm test` so it runs in CI. `editors/jetbrains` is the JetBrains plugin
(Gradle/Kotlin): the TextMate grammar via a `TextMateBundleProvider` for all IDEs,
plus the LSP path on Ultimate (`-PwithLsp`; the platform LSP API is Ultimate-only and
absent from the open SDK). `test:jetbrains` is the offline gate (drives the bundled
server, checks descriptors — no JVM). The real-IDE test and the full
`gradle buildPlugin -PwithLsp` (JDK 17 + a provisioned Gradle — no wrapper in-repo)
run in `.github/workflows/editors.yml`, path-filtered to the editor surface (ADR-017
amendment). Both VS Code and JetBrains packagers share one esbuild-pinned bundle step
(`editors/shared/sync.mjs`). Diagnostics shipped (ADR-023's recovering parser), and
so did hover/completion: the server reads `editors/operations.json` — `preludeSchema`
projected by `FullBars.Catalog.operations`, gated by `check:operations` like the
catalog — and gates both on being inside a tag via `tokenize`. Hover shows the
ADR-019 kind, arity, and a one-line prose doc from the required `OperationDef.doc`
field (the single source; run `npm run gen:operations` after a prelude change). A
`codeAction` quick-fix rewrites a deprecated alias or non-canonical scoped variable
to its canonical form (`index`→`index0`, `partial-block`→`yield`, dialect-scoped),
reading the same `operations.json` `canonical` field (from `Kernel.Prelude.scopedCanonical`
+ the aliases). The `flatbars lint` CLI surfaces the same canonicalization findings.
Marketplace publishing is the remaining tracked follow-up.

### Conventions worth knowing

- **One source of truth for the prelude.** `FullBars.Catalog` renders the
  helper catalog; the docs partial and the `check:catalog` gate are generated
  from `FullBars.preludeSchema`. Change the prelude → run `npm run gen:catalog`.
- **One source of truth for the syntax palette.** The seven-family `--c-*`
  palette (a Dracula/Alucard code theme, the one unified design system across
  front-ends) lives in `shared/flatbars-tokens.css`; `scripts/gen-tokens.mjs`
  generates it into the fenced `@palette` regions of
  `tutorials/src/styles/lab-tokens.css` (Astro bundles it) and `lab/index.html`
  (the static Lab inlines it), plus a verbatim copy at
  `docs/supplemental-ui/css/flatbars-tokens.css` (the Antora spec serves it).
  Change a colour → run `npm run gen:tokens`; `check:tokens` (in `npm test`)
  fails on drift. Every
  value clears WCAG AA (4.5:1) on its tint, the page bg, and as a solid chip —
  machine-checked by `npm run check:contrast` (also in `npm test`); documented
  sub-AA exceptions live in that script's `EXCEPTIONS` map.
- **One source of truth for the editor token vocabulary (ADR-017).**
  `editors/token-vocabulary.json` maps each engine token `kind` to its `role`
  (`tag`/`interior`), its LSP semantic-token type/modifiers, and its TextMate
  scopes. The engine `tokenize` (the kinds), the `flatbars-lsp` legend, and the
  TextMate grammar all derive from it. Three gates keep it honest, all in `npm
  test`: `check:highlight` pins what the engine emits (`spans` + `tokens`),
  `check:tmgrammar` pins that the fallback grammar agrees with the engine, per
  dialect, on tag boundaries + literals (the grammar may be richer — enrichment is
  allowed), and `check:vocab` pins the contract's joints (ADR-017): engine kinds ≡
  vocabulary kinds (witnessed by the `check:highlight` corpus), the sparse
  `lspEmitKinds` set, the LSP legend derivation, and that every vocabulary
  `tmScope` still exists in the grammar. Change a `kind` → update the vocabulary
  and rerun `npm run gen:highlight`. The bundle carries `tokenize`, so an engine
  change needs `npm run gen:bundle` + a cache-buster bump like any other.
- **One app shell + one wordmark.** The docs layout and the landing share
  `Topbar.astro` (wordmark · Chips · Theme · Legend · Open-the-Lab); the canonical
  lockup lives in `Wordmark.astro` and the static Lab copies its markup —
  `npm run check:wordmark` (in `npm test`) pins that they match.
- **Compiler ≡ interpreter.** Any compiler change must keep `npm run
  test:compile` green (byte-identical output to the interpreter).
- **`--pedantic-packages`** is enforced via `npm run lint`; declared deps must
  match imports (see the `json` package's `argonaut` umbrella comment for the
  kind of care this needs).
- **`examples/*/` are conformance golden cases, foldered.** Each is `meta.json`
  + `template.hbs` + `data.json`; `test:compile` renders every one through the
  interpreter and the compiled JS and asserts they match. `lab/examples/vendored/`
  is the separate upstream corpus for `examples verify` (see below).
- **Mustache conformance.** `npm run examples:verify` (in `npm test`) renders the
  vendored `mustache/spec` fixtures through MinBars and asserts `== expected`;
  re-vendor with `node scripts/vendor-mustache.mjs`. The same fixtures feed
  `gen:conformance`, which measures them through the shipped lab bundle to
  generate the tutorial's conformance table (`check:bundle` keeps the two in
  step). Change the prelude/engine and re-run `npm run gen:conformance`.
- ADR-001 (`docs/modules/ROOT/pages/adr-0001-structural-parser-and-walker.adoc`)
  records the structural-parser-plus-walker decision that the whole design rests
  on.
