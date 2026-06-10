# FlatBars

> **bare rods** — a template-engine *construction kit*.

FlatBars is not a template engine. It is the **substrate you build one on**: the
Handlebars/Mustache surface you already know (`{{{ }}}`, blocks, raw blocks,
comments, whitespace control) sitting on top of a **deliberately tiny core**
where almost nothing is built in. No built-in helpers, no escaping policy, no
control flow, no path semantics — every one of those is a *helper you supply*.

This repository is a **PureScript** monorepo hosting the reference
implementation and a CLI, alongside the normative specification and the
**FlatBars Lab** — a JavaScript/WASM polyglot playground (`lab`).

## Layout

```
.
├── spec/                  Normative specification (Astro Starlight site, MDX)
│   └── src/content/docs/  concepts · spec/* · engine/* · adr/* · appendix/*
├── site/                  Hand-written marketing landing page (index.html)
├── packages/
│   ├── core/              `flatbars` — the engine-agnostic framework (lexer · parser · driver · walk)
│   ├── classicbars/          `classicbars` — the reference engine (value policy · prelude · lowering)
│   ├── json/              `flatbars-json` — JSON ⇆ `Value` adapter (kept out of the framework)
│   └── cli/               `flatbars-cli` — render templates + run the example/conformance corpus
├── examples/              Foldered core-template fixtures (golden cases for the compiler conformance harness)
│   └── vendored/          Vendored upstream corpus (mustache/spec) for `flatbars examples verify`
├── conformance/
│   ├── handlebars/        Differential Handlebars conformance — ClassicBars matches real handlebars@4.7.9 on 98% (49/50)
│   └── mustache/          MinBars vs the full official mustache/spec — 100% (184/184) of every module it implements
└── reference/
    └── web/               FlatBars Lab — the JS/WASM polyglot playground (Stem · RawBars · MinBars · ClassicBars · MaxBars)
```

The specification (`spec/`) is the contract. The PureScript packages target it;
`spec/src/content/docs/engine/host-api.mdx` defines the host API the `core` package
exposes.

The `examples/*/` folders (each `meta.json` + `template.hbs` + `data.json`) are
golden cases for the compiler conformance harness (`npm run test:compile`); the
vendored upstream corpus under `lab/examples/vendored/` drives `flatbars examples
verify`. The FlatBars Lab's own demo templates live under `lab/examples/`.

**Conformance proofs.** `conformance/` measures the surface engines against the upstream
suites so the claims can't over-state. Both are gated in `npm test`:

- `conformance/handlebars/` — **ClassicBars vs Handlebars**, *differential*: every case rendered
  through the real `handlebars` npm package (a dev-only oracle) **and** ClassicBars, asserted
  byte-identical. Currently **98% (49/50)** (user block helpers landed — ADR-020); `npm run check:hbs-conformance`.
- `conformance/mustache/` — **MinBars vs the full official `mustache/spec`** (every module,
  optional `~` ones included). Each fixture carries its own `expected`, so the spec is the
  oracle. **100% (184/184) of every module MinBars implements** — all required modules plus the
  optional `dynamic-names` and `inheritance`. In-data lambdas live outside the value by design (a
  `Value` is pure data): value-producing lambdas are **precalculated before rendering** and section
  lambdas are **helpers** — no host code runs from template data. `npm run check:mustache-conformance`.

Both READMEs document the method and how lambdas are handled.

## Prerequisites

The PureScript toolchain is provisioned per-project via npm — you do **not** need
a global `purs`/`spago`:

```sh
npm install            # installs purescript + spago (+ esbuild for the flatbars-js bundle)
```

## Common tasks

```sh
npm run build          # compile every package in the workspace
npm test               # run the full suite (per-package tests + conformance gates)
npm run cli -- --help  # run the CLI
npm run build:spec     # build the Astro Starlight spec site (spec/)
# FlatBars Lab: serve lab/ over HTTP and open index.html
#   (defaults to the ClassicBars engine — no build needed; the Stem engine also
#    needs its wasm: run lab/build.sh, requires the Rust wasm toolchain)
```

See each package's own `README` for details.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
