# FlatBars for VS Code

Syntax support for FlatBars templates (and the Handlebars / Mustache surfaces it
covers), implementing the two-layer model of ADR-017
(`docs/modules/ROOT/pages/adr-0017-editor-support-lsp.adoc`):

- **A TextMate grammar (the floor).** Colours the default-delimiter forms
  (`{{ }}`, `{{{ }}}`, sections, partials, comments, …) immediately — at first
  paint, and as the only colour in no-LSP contexts. It is best-effort and
  non-authoritative: it leaves set-delimiter regions and MaxBars operators plain
  rather than mis-colouring them.
- **`flatbars-lsp` semantic tokens (the ceiling).** The extension spawns the
  engine-backed language server, whose tokens **override** the grammar and correct
  the stateful regions a grammar structurally cannot track. The engine always wins
  where it runs.

The server is the committed `flatbars-js` engine bundle run as a language server —
there is no second grammar to drift, which is the whole point of ADR-017.

## Dialect

Each dialect is its own language, registered on its native extension: **RawBars**
(`.rawbars`), **MinBars** (`.minbars`), **FullBars** (`.fullbars`), **MaxBars**
(`.maxbars`), plus the **FlatBars** umbrella (`.flatbars`). The server reads the
dialect from the document's language — so you can also pick it from the status bar
(e.g. mark a file "MaxBars"). The `flatbars` umbrella resolves via
`flatbars.defaultDialect` (FullBars by default).

We deliberately do **not** claim `.hbs`/`.handlebars`/`.mustache` — those belong to
the Handlebars/Mustache extensions. To use FlatBars on such a file, add a
`files.associations` entry (e.g. `"*.hbs": "fullbars"`).

## Building

`npm run package` (from this directory) bundles the grammar, the self-contained
server, and the client into `dist/`, then builds a `.vsix`. The bundled server has
no runtime `node_modules` dependency — `vscode-languageserver`, the engine, and the
inlined token vocabulary are all esbuilt into one file.

## Debugging

Open the repo root in VS Code and pick a config from **Run and Debug** (the
root `.vscode/launch.json`):

- **Run FlatBars Extension** — builds (`sync-assets`) and opens an Extension
  Development Host with the extension loaded; open a `.hbs`/`.mustache`/`.maxbars`
  file to see it work, and set breakpoints in `src/extension.js`.
- **Attach to flatbars-lsp** — attaches to the language server, which the debug
  build launches with `--inspect=6009`, so you can step through the server.
- **Extension + Server** (compound) — both at once.

The build emits source maps (kept out of the shipped `.vsix` by `.vscodeignore`).

## Status

The Marketplace listing is a tracked follow-up; the extension and its
engine-backed server are complete and exercised by a headless smoke test
(`npm test`) plus a real-IDE test (`npm run test:vscode:ide`, in CI) that opens a
fixture in a downloaded VS Code and asserts auto-activation surfaces semantic
tokens and diagnostics.
