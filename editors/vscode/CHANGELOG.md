# Change Log

All notable changes to the FlatBars VS Code extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-06-04

First public release.

### Added

- Per-dialect language registration (`rawbars`, `minbars`, `fullbars`,
  `maxbars`) with both long-form (`.rawbars`) and short-form (`.rbars`)
  native extensions.
- Engine-backed `flatbars-lsp` server, bundled into the extension as a
  self-contained CJS file with no runtime `node_modules` dependency.
  Advertises `semanticTokens/full`, `publishDiagnostics`,
  `textDocument/hover`, `textDocument/completion`,
  `textDocument/codeAction`, `textDocument/foldingRange`,
  `textDocument/documentSymbol`, and `textDocument/formatting`. See
  [ADR-026](../docs/modules/ROOT/pages/adr-0026-editor-capability-matrix.adoc)
  for the full matrix.
- TextMate grammar (`source.flatbars`) modeled on the canonical ERB shape,
  so themes that paint `punctuation.section.embedded.*` and
  `keyword.control.*` colour FlatBars braces and control sigils
  identically to ERB/PHP/Vue.
- LSP-side helper-name painting via a new `operation` semantic-token kind
  sourced from the prelude catalogue (`operations.json`).
- Hybrid-template injection grammar — `*.<host>.<flatbars-ext>` files open
  with the host language and have FlatBars tag highlighting layered on top
  via 26 default `injectTo` targets.
- Canonicalisation code-action quick-fix (e.g. `index` → `index0`,
  `partial-block` → `yield`); same source feeds `flatbars lint` and the
  `Linter.Aliases` lint.
- Snippets for common block forms (`if`, `each`, `with`, `let`, `partial`,
  comment).
- Settings: `flatbars.defaultDialect` selectable via Settings UI (RawBars /
  MinBars / FullBars / MaxBars).

[0.1.0]: https://github.com/wstein/flatbars/releases/tag/v0.1.0
