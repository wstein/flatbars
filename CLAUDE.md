# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

BareBars is a template-engine **construction kit**, not a template engine. The
core is a meaning-free parser; everything you expect from Handlebars/Mustache
(helpers, escaping, control flow, path semantics) is supplied by an *engine*
built on top. This is a PureScript monorepo holding the reference
implementation and a CLI, plus the normative spec in `docs/` and the FlatBars Lab
(a JS/WASM polyglot playground in `reference/web`, served as static files).

The spec in `docs/` is the contract; the PureScript packages target it.
`docs/modules/ROOT/pages/concepts.adoc` is the fastest way to understand the
core model; `host-api.adoc` defines the API `core` exposes.

## Toolchain & commands

The PureScript toolchain (`purs`/`spago`) is provisioned per-project via npm —
do **not** assume a global install.

```sh
npm install            # installs purescript + spago + esbuild
npm run build          # spago build — compile every package
npm test               # full suite: per-package spago tests + catalog + isolation + compile & mustache conformance
npm run cli -- --help  # run the CLI (spago run -p barebars-cli)
npm run lint           # spago build --pedantic-packages (catches unused/missing deps)
npm run format         # purs-tidy format-in-place; format:check to verify only
```

Run one package's PureScript tests directly (faster than `npm test`):

```sh
spago test -p maxbars        # or barebars / fullbars / kernel / rawbars / barebars-json / fullbars-compile / barebars-js
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

Mustache conformance for MinBars (both run from real `mustache/spec` fixtures):

```sh
npm run examples:verify       # STRICT gate (in `npm test`): render each vendored fixture via
                              # MinBars and assert actual == expected; exit ≠ 0 on any miss
node scripts/vendor-mustache.mjs   # re-vendor examples/vendored/mustache/ at the pinned commit
npm run test:minbars-spec     # LENIENT measurement: per-module pass counts; always exits 0
```

`examples:verify` is the `barebars examples verify` CLI subcommand (see
`example-loader-spec.md`). Note the overlap with `test:minbars-spec`: both render
`mustache/spec` through MinBars but from **two separate vendored corpora**
(`examples/vendored/mustache/` vs `packages/minbars/test/spec/`). Consolidating to
one corpus is a tracked follow-up (the spec's `verify` is intended to supersede the
measurement harness).

## Architecture

### The IoC pattern (read this first)

The whole system is one idea applied four times: **the core walks the
structural tree and calls into pluggable rules; "don't call BareBars, BareBars
calls you."** The four instances:

| Operation | Driver (meaning-free) | Plug-in (the meaning) |
| --- | --- | --- |
| **interpret** | `Kernel.Engine` traversal | `Engine` (helper meanings) |
| **desugar** | a `foldTemplate` | rewrite rules (`Kernel.Lower`) |
| **validate** | `Kernel.Walk` | a `Schema` |
| **compile** | `BareBars.Compile` emit driver | an `Emit` record (per dialect) |

The interpret driver is polymorphic in the result monad `m`
(`MonadThrow Error m` — `Either Error` for pure, `ExceptT Error Aff` for async)
and in the environment type `env`. The reference engine picks `RefEnv` (a stack
of helper frames + current context).

### Two phases

1. **Parse → skeleton AST.** `core` (`barebars`) is purely structural: lexer,
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

- **`core` (`barebars`)** — the framework: lexer, parser, skeleton AST, `Value`,
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
- **`compile`** (`barebars-compile`) — the dialect-agnostic emit driver →
  `export default function (data, rt)`. **`fullbars-compile`** layers the
  surface compiler on top. Emitted JS runs against
  `packages/compile/runtime/barebars-runtime.mjs`.
- **`json`** (`barebars-json`) — JSON ⇆ `Value` adapter, deliberately kept out
  of `core` (JSON-ness is a host concern, not a framework dependency).
- **`js`** (`barebars-js`) — JS/FFI surface bundling the dialects for JS hosts
  (bundled to `reference/web/vendor/barebars-engine.mjs` for the FlatBars Lab).
- **`cli`** (`barebars-cli`) — render templates, and the `examples verify`
  conformance gate.
- **`linter`** — cross-dialect lowering (MaxBars → RawBars source), incl.
  truthiness materialization via directive-carry.

The web playground is **`reference/web`** (the FlatBars Lab — plain HTML/JS/WASM,
not a PureScript package). The old Halogen `packages/playground` was removed.

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
  interpreter and the compiled JS and asserts they match. `examples/vendored/`
  is the separate upstream corpus for `examples verify` (see below).
- **Mustache conformance.** `npm run examples:verify` (in `npm test`) renders the
  vendored `mustache/spec` fixtures through MinBars and asserts `== expected`;
  re-vendor with `node scripts/vendor-mustache.mjs`.
- ADR-001 (`docs/modules/ROOT/pages/adr-0001-structural-parser-and-walker.adoc`)
  records the structural-parser-plus-walker decision that the whole design rests
  on.
