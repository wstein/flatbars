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

Each dialect is its own language, registered on its native extensions: **RawBars**
(`.rawbars` / `.rbars`), **MinBars** (`.minbars` / `.mbars`), **ClassicBars**
(`.classicbars` / `.fbars`), **MaxBars** (`.maxbars` / `.xbars` / `.truss`). The server reads the
dialect from the document's language id — pick it from the status bar to mark a
file as a different dialect.

We deliberately do **not** claim `.hbs`/`.handlebars`/`.mustache` — those belong to
the Handlebars/Mustache extensions. To use FlatBars on such a file, add a
`files.associations` entry (e.g. `"*.hbs": "classicbars"`).

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

## Capabilities

The server advertises semantic tokens, diagnostics, hover, completion,
canonicalisation code-action, folding ranges, document symbols (outline / quick
nav), and document formatting (canonical-spacing inside tags). See
`docs/modules/ROOT/pages/adr-0026-editor-capability-matrix.adoc` for the full
matrix and the principled omissions (definition / references / rename, which
would need a cross-template scope graph the engine deliberately doesn't keep).

## Snippets, settings, hybrid templates

`Settings ▸ FlatBars ▸ Default dialect` selects the dialect the server falls back
to when a document's URI extension doesn't pick one. Common block forms
(`if`, `each`, `with`, `let`, `partial`, comment, …) are available as snippets
under every dialect language.

Hybrid templates like `*.java.xbars` get FlatBars tag highlighting layered over
Java's grammar via an injection grammar contributed by this extension. With
`files.associations` set (`"*.java.xbars": "java"`), Java's grammar paints
keywords/strings/comments and FlatBars tags light up on top.

## Status

The extension and its engine-backed server are complete and exercised by a
headless smoke test (`npm test`), an end-to-end `.vsix` integrity gate
(`npm run check:vsix-integrity`, run before publish), and a real-IDE test
(`npm run test:vscode:ide`, in CI) that opens a fixture in a downloaded VS Code
and asserts auto-activation surfaces semantic tokens and diagnostics.
