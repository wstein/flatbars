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
core model; `host-api.adoc` defines the API `core` exposes.

## Toolchain & commands

The PureScript toolchain (`purs`/`spago`) is provisioned per-project via npm —
do **not** assume a global install.

```sh
npm install            # installs purescript + spago + esbuild
npm run build          # spago build — compile every package
npm test               # full suite: per-package spago tests + catalog + isolation + compile & mustache conformance + Lab unit tests
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
  spans, errors. No engine, no helpers, no validation.
- **`kernel`** — the shared engine machinery, dialect-agnostic: `Engine` (IoC
  interpret driver), `Env`/`RefEnv`, `Helper` (arity combinators), `Lower`
  (structural → typed "real" AST), `Prelude` (the reference helpers + schema),
  `Render` (`runResolved`: parse → resolve `@truthiness` → seed → run), `Value`,
  `Walk`.
- **`fullbars`** — the reference engine + its surface dialect (`{{ }}`
  auto-escape, dotted paths, `@data`, `as |x|`). Re-exports kernel modules and
  adds surface desugar/compile/render.
- **The dialect ladder: RawBars ⊂ FullBars ⊂ MaxBars.** All three share one
  engine, prelude, value policy, and compiler — they differ only in *surface
  syntax*, swapped in through the `ParseOptions.parseExpr` seam:
  - **`rawbars`** — core skeleton syntax directly, no surface sugar.
  - **`fullbars`** — adds the Handlebars-style surface desugar.
  - **`maxbars`** — FullBars plus infix operators and pipes (`MaxBars.Expr`),
    desugaring to the same core `Expr`.
- **`compile`** (`flatbars-compile`) — the dialect-agnostic emit driver →
  `export default function (data, rt)`. **`fullbars-compile`** layers the
  surface compiler on top. Emitted JS runs against
  `packages/compile/runtime/flatbars-runtime.mjs`.
- **`json`** (`flatbars-json`) — JSON ⇆ `Value` adapter, deliberately kept out
  of `core` (JSON-ness is a host concern, not a framework dependency).
- **`js`** (`flatbars-js`) — JS/FFI surface bundling the dialects for JS hosts
  (bundled to `lab/vendor/flatbars-engine.mjs` for the FlatBars Lab).
  That bundle is a **committed artifact**: regenerate it after any engine change,
  or the Lab runs stale — `spago bundle -p flatbars-js --module FullBars.JS
  --bundle-type module --platform browser --outfile
  lab/vendor/flatbars-engine.mjs` (needs `esbuild` on PATH). The bundle URL is
  imported with a `?v=N` cache-buster (in `lab/index.html`, `lab/flatbars.mjs`,
  `lab/minbars.mjs`) — **bump that `N` whenever you regenerate the bundle**, or
  browsers serve a cached old copy (the cause of "the Lab runs an old engine"
  even though `check:bundle` is green).
- **`cli`** (`flatbars-cli`) — render templates, and the `examples verify`
  conformance gate.
- **`linter`** — cross-dialect lowering (MaxBars → RawBars source), incl.
  truthiness materialization via directive-carry.

The web playground is **`lab`** (the FlatBars Lab — plain HTML/JS/WASM,
not a PureScript package). The old Halogen `packages/playground` was removed.

The **`tutorials`** site (Astro + Preact, also not a PureScript package) is the
learner-facing front end: every surface now has a comprehensive runnable
reference — **MinBars/Mustache** (`/minbars`, the recommended start) leads, with
**RawBars** (`/rawbars`, the meaning-free core, live compiled-JS pane),
**FullBars** (`/fullbars`, Handlebars-faithful), and **MaxBars** (`/maxbars`, the
full expression layer: infix operators, pipes, bare loop vars) alongside. (The
old one-example `[surface].astro` lesson page is gone — the dedicated references
supersede it.) Runnable examples are gate-validated
(`check:tutorial-links`, which also asserts the compile flagship emits JS) and the
Mustache conformance table is generated from the vendored spec suite
(`gen:conformance`); see `tutorials/README.md`.

### Conventions worth knowing

- **One source of truth for the prelude.** `FullBars.Catalog` renders the
  helper catalog; the docs partial and the `check:catalog` gate are generated
  from `FullBars.preludeSchema`. Change the prelude → run `npm run gen:catalog`.
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
