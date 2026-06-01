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
├── docs/                  Normative specification (Antora component)
│   └── modules/ROOT/      pages/*.adoc · nav.adoc · assets/images
├── site/                  Hand-written marketing landing page (index.html)
├── packages/
│   ├── core/              `flatbars` — the engine-agnostic framework (lexer · parser · driver · walk)
│   ├── fullbars/          `fullbars` — the reference engine (value policy · prelude · lowering)
│   ├── json/              `flatbars-json` — JSON ⇆ `Value` adapter (kept out of the framework)
│   └── cli/               `flatbars-cli` — render templates + run the example/conformance corpus
├── examples/              Foldered core-template fixtures (golden cases for the compiler conformance harness)
│   └── vendored/          Vendored upstream corpus (mustache/spec) for `flatbars examples verify`
└── reference/
    └── web/               FlatBars Lab — the JS/WASM polyglot playground (Stem · RawBars · MinBars · FullBars · MaxBars)
```

The specification (`docs/`) is the contract. The PureScript packages target it;
`docs/modules/ROOT/pages/host-api.adoc` defines the host API the `core` package
exposes.

The `examples/*/` folders (each `meta.json` + `template.hbs` + `data.json`) are
golden cases for the compiler conformance harness (`npm run test:compile`); the
vendored upstream corpus under `lab/examples/vendored/` drives `flatbars examples
verify`. The FlatBars Lab's own demo templates live under `lab/examples/`.

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
npm run docs           # build the Antora documentation site (requires antora)
# FlatBars Lab: serve lab/ over HTTP and open index.html
#   (defaults to the FullBars engine — no build needed; the Stem engine also
#    needs its wasm: run lab/build.sh, requires the Rust wasm toolchain)
```

See each package's own `README` for details.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
