# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FlatBars is a template-engine **construction kit**, not a template engine. The
core is a meaning-free parser; everything you expect from Handlebars/Mustache
(helpers, escaping, control flow, path semantics) is supplied by an *engine*
built on top. This is a PureScript monorepo holding the reference
implementation and a CLI, plus the normative spec in `spec/` and the FlatBars Lab
(a JS/WASM polyglot playground in `lab`, served as static files).

The spec in `spec/` is the contract; the PureScript packages target it. It is an
Astro Starlight site (MDX) — `spec/src/content/docs/concepts.mdx` is the fastest
way to understand the core model; `engine/host-api.mdx` defines the API `core`
exposes. `npm run build:spec` builds it (Pagefind offline search +
`starlight-links-validator`); the palette comes from the shared design system via
`customCss` (the shared tokens + IBM Plex + violet accent + logo). The spec joins
the umbrella chrome through Starlight component overrides
(`spec/src/components/`): `Header.astro` replaces the native top bar with the
shared `<flatbars-topbar>` (Pagefind `<Search/>` rides in its `tools` slot, the
mobile menu toggle is kept), `ThemeProvider.astro` is the umbrella single-key
anti-flash seed, and `ThemeSelect.astro` is empty (the element is the sole theme
control). The sidebar, TOC and search are otherwise unchanged. The spec was
migrated from Antora/AsciiDoc to Starlight in ADR-031; the `.mdx` are the
maintained source (the one-time converter is gone), and the helper catalog is
generated into `spec/src/partials/helper-catalog.mdx` from `ClassicBars.Catalog`.

## Toolchain & commands

The PureScript toolchain (`purs`/`spago`) is provisioned per-project via npm —
do **not** assume a global install.

```sh
npm install            # installs purescript + spago + esbuild
npm run build          # spago build — compile every package
npm test               # full suite: format:check + per-package spago tests + catalog + isolation + compile & (handlebars/mustache) conformance + Lab unit tests + editor gates (highlight/tmgrammar/vocab/lsp/vscode/jetbrains/manifests/plugin-version/operations-paint/jetbrains-bundle)
npm run cli -- --help  # run the CLI (spago run -p flatbars-cli)
npm run lint           # spago build --pedantic-packages (catches unused/missing deps)
npm run format         # purs-tidy format-in-place; format:check to verify only
```

**Spec site (`spec/`, Astro Starlight — ADR-031).** The normative spec is a
standalone Starlight app deployed at `/flatbars/spec/` (the tutorials link into it
via `PUBLIC_SPEC_BASE`). The `.mdx` under `spec/src/content/docs/**` are the
maintained source — edit them directly. Build/verify:

```sh
npm run build:spec     # astro build: MDX validity + Pagefind + starlight-links-validator
( cd spec && npm install && npm run dev )   # local preview
```

Conventions: every ADR page must be linked from `spec/src/sidebar.ts`
(`check:adr-nav`); the helper catalog is generated into
`spec/src/partials/helper-catalog.mdx` by `npm run gen:catalog` from the one
`ClassicBars.Catalog` source (`check:catalog`); the token palette is copied into
`spec/src/styles/` by `gen:tokens` (`check:tokens`); `check:glossary` reads the
spec MDX. Spec deps live in `spec/package.json` (not the root install). The one
PlantUML diagram became an ASCII flow; richer Mermaid diagrams are a follow-up.

Run one package's PureScript tests directly (faster than `npm test`):

```sh
spago test -p maxbars        # or flatbars / classicbars / kernel / rawbars / flatbars-json / classicbars-compile / flatbars-js
```

There is no finer-grained-than-package test runner; each package's tests run
through a single `Test.<Pkg>.Main`.

Two Node-based gates beyond the spago tests (both require `spago build` first,
which they invoke):

```sh
npm run test:compile   # conformance harness: asserts the INTERPRETER and the COMPILED JS
                       # produce byte-identical output for every case
npm run check:catalog  # fails if docs' helper-catalog partial is stale vs ClassicBars.preludeSchema
npm run gen:catalog    # regenerate that partial after changing the prelude
```

These Node scripts import from `output/` (the spago build product), so they
always test current source — rebuild before running them.

Differential conformance proofs live under `conformance/` (both gated in `npm
test`, both write a committed `report.json` so the score can't silently drift):

```sh
npm run gen:hbs-conformance       # ClassicBars vs the REAL handlebars npm pkg (dev-only oracle),
npm run check:hbs-conformance     # asserting byte-identical; currently 49/50 (98%)
npm run gen:mustache-conformance  # MinBars vs the FULL official mustache/spec (every module),
npm run check:mustache-conformance # 184/184 (100%) of the modules MinBars implements
```

`conformance/handlebars/` renders a categorised corpus through real Handlebars
*and* ClassicBars; `conformance/mustache/` runs the whole vendored `mustache/spec`
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
npm run check:provenance      # tiling gate (in `npm test`): the source map (ADR-035) tiles
                              # the output for every core/ClassicBars/MaxBars example
npm run test:lab:browser      # OPT-IN real-browser smoke (NOT in `npm test`): drives Brave via
                              # puppeteer-core to confirm the three-way provenance linking paints
                              # (needs a Chromium-family browser; set FLATBARS_BROWSER to override)
```

The `tutorials` site has its own gates (all in `npm test`, no `spago build`
needed — they import the committed lab bundle):

```sh
npm run check:tutorial-links    # render every tutorial example through the real engine + build its
                                # Open-in-Lab link; also fails on an orphaned (defined-but-unshown) example
npm run check:tutorial-tooling  # the linter/analyser references aren't renders: run each example through
                                # the bundle's analyze/lint/migrate and assert the finding/report/source; also
                                # builds + decodes each /lint Open-in-Lab deep-link (lint→Lint panel `dk`,
                                # migrate→Migrated view `v`) + orphan guard
npm run check:jsonata           # the Data-shaping (JSONata) guide: every cell + the flagship round-trip
npm run gen:conformance         # regenerate tutorials/src/conformance.json from the vendored mustache/spec suite
npm run check:conformance       # fail if that file is stale (so the reference can't over-claim conformance)
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
   `kernel` + `classicbars`.

Key core facts (see `concepts.mdx`): everything is a helper application
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
  truthiness rule → run), `Provenance` (`runResolvedMapped`: the same driver run
  in a `WriterT` to emit a tiling output→source map — source maps, ADR-035),
  `Inspect` (`inspectResolvedLenient`: the same driver snapshotting the render
  context at a target span — the Context Inspector, ADR-035), `Value`, `Walk`.
- **`classicbars`** — the reference engine + its surface dialect (`{{ }}`
  auto-escape, dotted paths, `@data`, `as |x|`). Re-exports kernel modules and
  adds surface desugar/compile/render.
- **The dialect ladder: RawBars ⊂ ClassicBars ⊂ MaxBars** (the `⊂` is surface-superset
  *modulo documented exceptions* — MaxBars is the flagship that reuses ClassicBars's engine
  wholesale and borrows most, not all, of its surface; see the ADR-005 amendment).
  All three share one
  engine, prelude, and compiler, differing mainly in *surface syntax* (swapped in
  through the `ParseOptions.parseExpr` seam). They *diverge* in one value-policy
  axis — truthiness (ADR-022): ClassicBars uses `handlebars`, RawBars/MaxBars use
  `nonEmpty` (`false null "" [] {}` falsy; `0` truthy), MinBars uses `mustache`
  (the *language-agnostic* spec rule — `0`/`""`/`{}` truthy, as in Ruby/Python
  Mustache). Note `mustache.js` (the JS implementation) instead treats `0`/`""` as
  falsy, which is the `handlebars` rule; MinBars exposes that as an opt-in compat
  mode — `renderMinbarsCompat`/`compileMinbarsCompat` (JS facade), `renderMinCompat`
  (engine), `flatbars --mustache-js` (CLI). The spec rule stays the default, and
  the interpreter≡compiler agreement on the compat rule is gated by the
  `minbars-compat` cases in `test:compile`. Analyse mode labels the spec rule
  `mustache-spec` (not bare `mustache`) so its findings never imply a `mustache.js`
  flip that does not apply (ADR-022 S1/S2).
  A second `LexConfig` knob diverges too — **`mustacheDelims`** (set-delimiter
  support, `{{=A B=}}`): **MinBars only** (ADR-015 amendment). ClassicBars / RawBars /
  MaxBars all set `mustacheDelims = false`, and the LSP layers
  `dialectDiagnostics` on top so an attempted set-delim in one of those dialects
  surfaces as an actionable "use MinBars" message instead of a raw parse failure
  (rule inventory pinned by `check:dialect-diagnostics`).
  A `LexOptions` knob diverges the same way — **`rangeOperator`** (the `..` range
  operator, sugar for the `range` helper): **MaxBars only**. A glued `..` lexes as
  `TOp ".."` (so `1..n`/`a..b` carve into `a`/`..`/`b`), while a single `.` stays an
  identifier char (dotted paths untouched). It is MaxBars-exclusive because the
  other dialects keep `..` for the Handlebars `../` parent-path, already gone in
  MaxBars (ADR-021); `MaxBars.Expr` adds the parser rung between comparison and
  additive.
  A third `LexOptions` knob — **`collectionLiterals`** (the `[…]` list / `{k: v}`
  dict literals): **MaxBars only**. `[ ] { } ,` tokenize as their own punctuation, so
  `MaxBars.Expr` parses a leading `[`/`{` atom into a `list`/`dict` prelude call
  (pure sugar — no new engine/compiler machinery). A *mid-identifier* `[seg]` (the
  `a.[k]` path-bracket) is untouched; only a leading `[` opens a list. Off elsewhere,
  so `{`/`,` stay a lex error and `[…]` a path there. The same flag makes the
  *structural* scanner (`tokenizeTemplate`) brace-aware — it balances `{ }` and skips
  strings when finding a tag close — so a dict abutting `}}` needs no space
  (`{{#with {a: 1}}}`); comments and set-delim tags stay un-brace-aware by design.
  `check:parity` (in `npm test`) machine-checks that RawBars ≡ MaxBars — the exact
  `nonEmpty` falsy set and byte-identical rendering over a shared core corpus —
  modulo documented surface exceptions (the ADR-021 loop-variable model; the
  `{{#*inline}}` decorator).
  Truthiness is a `Value -> Boolean` callback the engine plugs in (no falsy-set
  data, no per-file `@truthiness`):
  - **`rawbars`** — the *desugared core surface*: core skeleton syntax directly, no surface sugar
    (it still runs the engine — it is the form the richer surfaces desugar to, *not* the meaning-free
    core, which is the `core`/`flatbars` parser package).
  - **`classicbars`** — adds the Handlebars-style surface desugar.
  - **`maxbars`** — the flagship surface: reuses ClassicBars's engine by dependency and
    adds infix operators and pipes (`MaxBars.Expr`), desugaring to the same core
    `Expr`. Borrows most of ClassicBars's surface, not quite all (a few ClassicBars-only
    constructs diverge — see `engine/maxbars.mdx`).
- **`compile`** (`flatbars-compile`) — the dialect-agnostic emit driver →
  `export default function (data, rt)`. **`classicbars-compile`** layers the
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
  writing to `packages/js/…`, not here.) Every local Lab module is imported with a
  `?v=<sha8>` **content hash**, not a hand-bumped number: `scripts/hash-lab.mjs`
  walks the module graph from `lab/index.html` leaf-first and rewrites each local
  `?v=` (imports, the worker string ref, `<script src>`) to the sha256-prefix of the
  imported module's *already-rewritten* content — so a leaf change (e.g. the engine
  bundle, `dom.mjs`) propagates its new hash up through every importer automatically,
  and a stale cache is structurally impossible. After any change under `lab/` run
  **`npm run gen:lab-hashes`** to re-stamp the hashes; `check:lab-hashes` (in `npm
  test`) fails if any `?v=` is stale. This replaced the old hand-bumped `?v=N` +
  `lab/cachebust.lock.json` scheme — there is no version number to forget anymore.
- **`cli`** (`flatbars-cli`) — render templates, and the `examples verify`
  conformance gate.
- **`linter`** — cross-dialect lowering (MaxBars → RawBars source).

The web playground is **`lab`** (the FlatBars Lab — plain HTML/JS/WASM,
not a PureScript package). The old Halogen `packages/playground` was removed.

The **`tutorials`** site (Astro + Preact, also not a PureScript package) is the
learner-facing front end: every surface now has a comprehensive runnable
reference — **MinBars/Mustache** (`/minbars`, the recommended start) leads, with
**RawBars** (`/rawbars`, the desugared core surface, live compiled-JS pane),
**ClassicBars** (`/classicbars`, Handlebars-faithful), and **MaxBars** (`/maxbars`, the
flagship: infix operators, pipes, bare loop vars) alongside. Beyond the dialects,
two *tooling* guides: **Truthiness portability** (`/analyse`, analyse mode —
Lab-first, the ambiguous-value findings + JSONata fix) and **Linting & migration**
(`/lint`, the CLI/CI guide to `flatbars lint` + `flatbars migrate`), plus **Data
shaping** (`/transform`, JSONata). (The old one-example `[surface].astro` lesson
page is gone — the dedicated references supersede it.) Runnable examples are
gate-validated (`check:tutorial-links`, which also asserts the compile flagship
emits JS; the tooling pages by `check:tutorial-tooling`, which runs each example
through the bundle's `analyze`/`lint`/`migrate`) and the Mustache conformance
table is generated from the vendored spec suite (`gen:conformance`); see
`tutorials/README.md`.

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
projected by `ClassicBars.Catalog.operations`, gated by `check:operations` like the
catalog — and gates both on being inside a tag via `tokenize`. Hover shows the
ADR-019 kind, arity, and a one-line prose doc from the required `OperationDef.doc`
field (the single source; run `npm run gen:operations` after a prelude change). A
`codeAction` quick-fix rewrites a deprecated alias or non-canonical scoped variable
to its canonical form (`index`→`index0`, `partial-block`→`yield`, dialect-scoped),
reading the same `operations.json` `canonical` field (from `Kernel.Prelude.scopedCanonical`
+ the aliases). The `flatbars lint` CLI surfaces the same canonicalization findings.

The 2026-06-04 round added per-tag-class refinement and four new LSP capabilities
(see ADR-026): every brace cluster is `punctuation.section.embedded.*` with the
sigil split out as `keyword.control.*` (ERB-canonical); LSP `shrinkToInner` trims
braces off tag-level semantic-token spans; `paintOperations` highlights helper
names from `operations.json` (vocabulary-driven via `operationPosition: head | always-head | any | none`);
the server now also advertises `foldingRange`, `documentSymbol`, and `formatting`.
Marketplace metadata, plugin icons, snippets, JetBrains live templates / file
template / Tools-menu actions / Community-edition banner all ship; the JetBrains
plugin codegens `FlatBarsLanguages.kt` from `editors/shared/sync.mjs` LANGUAGES.
Three new drift gates joined `npm test`: `check:editors-manifests` (vocab → vscode
package.json + Kotlin extension set), `check:plugin-version` (single source for
the 0.1.0 stamp), `check:operations-paint` (catalog ↔ painter parity, 90 ops + 2
keywords + 5 negatives), `check:jetbrains-bundle` (TextMate-bundle integrity);
plus `check:vsix-integrity` for end-to-end .vsix shape (run before publish).

### Conventions worth knowing

- **One source of truth for the prelude.** `ClassicBars.Catalog` renders the
  helper catalog; the docs partial and the `check:catalog` gate are generated
  from `ClassicBars.preludeSchema`. Change the prelude → run `npm run gen:catalog`.
- **One source of truth for the design tokens.** `scripts/gen-tokens.mjs` single-
  sources two token sets from `shared/` into fenced regions of the same consumers,
  so the three front-ends can't drift on either: the seven-family `--c-*` syntax
  palette (`shared/flatbars-tokens.css` → `@palette`) and the chrome design system
  (`shared/flatbars-chrome.css` → `@chrome`: palette, IBM Plex, violet accent,
  light/dark — what the shared topbar reads). Both fences live in
  `tutorials/src/styles/lab-tokens.css` (Astro bundles it) and `lab/index.html`
  (the static Lab inlines it); the Starlight spec loads verbatim copies
  (`spec/src/styles/flatbars-tokens.css`, `spec/src/styles/flatbars-chrome.css`)
  via `customCss`. Change a colour in the relevant shared source → run
  `npm run gen:tokens`; `check:tokens` (in `npm test`) fails on drift. Every
  value clears WCAG AA (4.5:1) on its tint, the page bg, and as a solid chip —
  machine-checked by `npm run check:contrast` (also in `npm test`); documented
  sub-AA exceptions live in that script's `EXCEPTIONS` map. Three more guards keep
  the design system single-sourced end to end: `check:no-raw-colors` forbids hard-
  coded colours outside the shared sources + generated fences (a ratchet: the
  chrome-clean files are pinned at 0, the residual content/editor palettes have a
  shrinking budget); `check:fonts` pins the one IBM Plex stylesheet URL
  (`shared/fonts.mjs`, imported by the Astro apps, hard-copied in the Lab) so the
  weights can't drift; and the Starlight spec maps its whole `--sl-color-*` ramp
  (white→fg … black→bg, the grays → the `--bg-*`/`--fg-*` scale) onto the shared
  base in `spec/src/styles/spec.css`, so it derives every surface from it. Shared
  UI component primitives beyond the topbar live in `shared/flatbars-ui.css`
  (token-driven `.fb-*`; adopt incrementally, the `/tutorials/` overview is the
  first consumer).
- **One source of truth for the editor token vocabulary (ADR-017).**
  `editors/token-vocabulary.json` maps each engine token `kind` to its `role`
  (`tag`/`interior`), its LSP semantic-token type/modifiers, and its TextMate
  scopes. The engine `tokenize` (the kinds), the `flatbars-lsp` legend, and the
  TextMate grammar all derive from it. Three gates keep it honest, all in `npm
  test`: `check:highlight` pins what the engine emits (`spans` + `tokens`),
  `check:tmgrammar` pins that the fallback grammar agrees with the engine, per
  dialect, on tag boundaries only (in-tag literals are no longer gated here — the
  LSP corrects them as semantic tokens over the silent floor; the grammar may be
  richer — enrichment is allowed), and `check:vocab` pins the contract's joints (ADR-017): engine kinds ≡
  vocabulary kinds (witnessed by the `check:highlight` corpus), the sparse
  `lspEmitKinds` set, the LSP legend derivation, and that every vocabulary
  `tmScope` still exists in the grammar. Change a `kind` → update the vocabulary
  and rerun `npm run gen:highlight`. The bundle carries `tokenize`, so an engine
  change needs `npm run gen:bundle` + a cache-buster bump like any other.
- **One topbar + one theme contract across the umbrella.** The chrome is the
  shared, zero-dependency `<flatbars-topbar>` custom element
  (`shared/flatbars-topbar.mjs`) — the SAME element the tutorials app, the
  Starlight spec, and the static Lab all mount, so the wordmark, the context
  switcher (Home · Tutorials · Spec · Lab), and the Theme control never drift
  between surfaces. It hydrates controls only (no first paint), reads its links
  from a `base` attribute, and reads the chrome tokens through its shadow boundary.
  Those chrome tokens (palette, IBM Plex, violet accent, light/dark) are the single
  source `shared/flatbars-chrome.css`, generated by `npm run gen:tokens` into the
  `@chrome` fence of each consumer (the tutorials' `lab-tokens.css`, the Lab's
  inline `<style>`, and a verbatim copy the spec loads via `customCss`) — exactly
  like the `@palette` region, and pinned by `check:tokens`. It is the companion to
  `shared/flatbars-tokens.css` (the `--c-*` syntax palette). Theme is one
  `[data-theme]` on `<html>` persisted to the single `flatbars-theme` key, seeded
  before first paint by `shared/theme-seed.js` (inlined in each `<head>`). Two
  gates pin this, both in `npm test`: `check:topbar` (the element owns the
  canonical `<b class="flat">Flat</b>Bars` lockup + its `start`/`tools` host
  slots, and every migrated surface mounts it) and `check:theme-seed` (every
  inline seed copy is byte-identical). The element's pure helpers are unit-tested
  via `test:shared`. The tutorials `Topbar.astro` mounts the element and slots in
  the docs colour-Legend (`tools`) and the sidebar nav-toggle (`start`).
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
- ADR-001 (`spec/src/content/docs/adr/adr-0001-structural-parser-and-walker.mdx`)
  records the structural-parser-plus-walker decision that the whole design rests
  on.
- **Decide author-facing surface syntax in the ADR *before* the implementation
  PR.** The MaxBars `each` loop binding changed twice in one cycle (`as |x|` →
  `as x` → `x in xs`), each a breaking commit + a full corpus/test/tutorial
  re-migration + ADR amendments — because the spelling wasn't settled on paper
  first. When adding a surface construct, write (and freeze) its exact spelling in
  the relevant ADR, then implement once. When a surface *form is removed*, reject
  the old form with a located, actionable error (`checkSurfaceStrict` — ClassicBars
  `{{#let}}`, MaxBars `{{#each … as …}}`); never let it silently no-op. The MaxBars
  binding triad (`each … in`, `with … as`, `let name=value`) is now committed
  surface — see the ADR-021 amendment and `engine/maxbars.mdx`.
