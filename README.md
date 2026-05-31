# BareBars

> **bare rods** — a template-engine *construction kit*.

BareBars is not a template engine. It is the **substrate you build one on**: the
Handlebars/Mustache surface you already know (`{{{ }}}`, blocks, raw blocks,
comments, whitespace control) sitting on top of a **deliberately tiny core**
where almost nothing is built in. No built-in helpers, no escaping policy, no
control flow, no path semantics — every one of those is a *helper you supply*.

This repository is a **PureScript** monorepo hosting the reference
implementation, a CLI, and a web playground, alongside the normative
specification and a JavaScript/WASM reference playground.

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
│   ├── cli/               `barebars-cli` — render templates from the command line
│   └── playground/        Halogen web playground (works online and offline as a static bundle)
├── examples/              Runnable fixtures (foldered templates + data, bundled into the playground)
└── reference/
    └── web/               Provided JS/WASM ("stem") reference playground — kept for comparison
```

The specification (`docs/`) is the contract. The PureScript packages target it;
`docs/modules/ROOT/pages/host-api.adoc` defines the host API the `core` package
exposes.

To add a new playground example, create a new folder under `examples/` with
`meta.json`, `template.hbs`, and `data.json`. The playground manifest is
generated from those folders at build time, so no example data should be added
inline to the Halogen source.

## Prerequisites

The PureScript toolchain is provisioned per-project via npm — you do **not** need
a global `purs`/`spago`:

```sh
npm install            # installs purescript + spago (+ esbuild for the playground)
```

## Common tasks

```sh
npm run build          # compile every package in the workspace
npm test               # run the core test suite
npm run cli -- --help  # run the CLI
npm run playground     # build + serve the web playground at http://localhost:8080
npm run docs           # build the Antora documentation site (requires antora)
```

See each package's own `README` for details.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
