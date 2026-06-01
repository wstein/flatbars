# BareBars

> **bare rods** — a template-engine *construction kit*.

BareBars is not a template engine. It is the **substrate you build one on**: the
Handlebars/Mustache surface you already know (`{{{ }}}`, blocks, raw blocks,
comments, whitespace control) sitting on top of a **deliberately tiny core**
where almost nothing is built in. No built-in helpers, no escaping policy, no
control flow, no path semantics — every one of those is a *helper you supply*.

This repository is a **PureScript** monorepo hosting the reference
implementation and a CLI, alongside the normative specification and the
**FlatBars Lab** — a JavaScript/WASM polyglot playground (`reference/web`).

## Layout

```
.
├── docs/                  Normative specification (Antora component)
│   └── modules/ROOT/      pages/*.adoc · nav.adoc · assets/images
├── site/                  Hand-written marketing landing page (index.html)
├── packages/
│   ├── core/              `barebars` — the engine-agnostic framework (lexer · parser · driver · walk)
│   ├── fullbars/          `fullbars` — the reference engine (value policy · prelude · lowering)
│   ├── json/              `barebars-json` — JSON ⇆ `Value` adapter (kept out of the framework)
│   └── cli/               `barebars-cli` — render templates + run the example/conformance corpus
├── examples/              Foldered core-template fixtures (golden cases for the compiler conformance harness)
│   └── vendored/          Vendored upstream corpus (mustache/spec) for `barebars examples verify`
└── reference/
    └── web/               FlatBars Lab — the JS/WASM polyglot playground (Stem · RawBars · MinBars · FullBars · MaxBars)
```

The specification (`docs/`) is the contract. The PureScript packages target it;
`docs/modules/ROOT/pages/host-api.adoc` defines the host API the `core` package
exposes.

The `examples/*/` folders (each `meta.json` + `template.hbs` + `data.json`) are
golden cases for the compiler conformance harness (`npm run test:compile`); the
vendored upstream corpus under `reference/web/examples/vendored/` drives `barebars examples
verify`. The FlatBars Lab's own demo templates live under `reference/web/examples/`.

## Prerequisites

The PureScript toolchain is provisioned per-project via npm — you do **not** need
a global `purs`/`spago`:

```sh
npm install            # installs purescript + spago (+ esbuild for the barebars-js bundle)
```

## Common tasks

```sh
npm run build          # compile every package in the workspace
npm test               # run the full suite (per-package tests + conformance gates)
npm run cli -- --help  # run the CLI
npm run docs           # build the Antora documentation site (requires antora)
# FlatBars Lab: serve reference/web/ over HTTP and open index.html
```

See each package's own `README` for details.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
