# `barebars-playground` — web playground

A [Halogen](https://purescript-halogen.github.io/purescript-halogen/) single-page
app that lexes, parses, validates, and renders BareBars **core** templates
entirely in the browser. The `barebars` library is compiled to JavaScript and
bundled in — nothing is sent to a server, so the playground works **online and
offline** (open `dist/index.html` straight from disk).

## Features

- **Template editor** and **JSON data editor**, live.
- **Output pane** with four views:
  - **Rendered** — a sandboxed `<iframe>` preview of the HTML output.
  - **HTML** — the raw rendered source.
  - **AST** — the parsed *skeleton* AST (`BareBars.parse`).
  - **Validation** — the schema-validation report (`BareBars.validate` against
    `preludeSchema`), the engine's second pass.
- **Examples** — greeting, list/`each`, clause-based conditionals, object
  iteration, and a `with` table.
- A **status bar** showing parse state, data validity, and the live issue count.

## Develop

```sh
# from the repo root (installs the toolchain once)
npm install

# build + serve at http://localhost:8080
npm run playground

# just build the static bundle into packages/playground/dist/
npm run playground:build
```

## Smoke test

A headless end-to-end check builds the bundle, serves `dist/` over HTTP, and
drives it with `puppeteer-core` against a locally installed **Brave**, asserting
the Halogen app mounted (brand, the four output tabs, the preview iframe, and a
clean validation view):

```sh
npm --workspace packages/playground run smoke
# or point at another Chromium-family browser:
BRAVE_PATH=/path/to/browser npm --workspace packages/playground run smoke
```

`dist/` (the bundle `app.js` + `index.html`) is generated and git-ignored. To
deploy, build and publish the `dist/` directory as static files — or just open
`dist/index.html` locally.

## Notes

- Templates use **core syntax**; control flow uses `{{else}}` separators
  (`{{#if c}}…{{else}}…{{/if}}`). The full surface dialect (`{{ x }}` auto-escape,
  dotted paths) is a future extension of the desugaring walk (`FlatBars.Lower`);
  the **Real AST** tab already shows that walk's output for the supported core.
- The richer JS/WASM reference playground lives in [`reference/web/`](../../reference/web/);
  this package is the PureScript equivalent built on the reference engine, FlatBars.
