# `editors/` — third-party editor support (ADR-017)

Highlighting FlatBars in real editors by **running the engine lexer**, never by
approximating it. See `docs/modules/ROOT/pages/adr-0017-editor-support-lsp.adoc`.

| Path | What it is |
| --- | --- |
| `token-vocabulary.json` | **The single source of truth.** Each engine token `kind` → its `role` (`tag`/`interior`), LSP semantic-token `type`/`modifiers`, and TextMate `tmScopes`. The three consumers below all derive from it. |
| `flatbars.tmLanguage.json` | The hand-authored TextMate **fallback** grammar — the *floor*. Colours the default-delimiter forms for no-LSP contexts (diffs, `bat`, first paint, JetBrains Community). Best-effort and non-authoritative: it gives up (leaves plain) on set delimiters, MaxBars operators, and dialect-error shapes rather than mis-colouring. |
| `lsp/` | **`flatbars-lsp`** — the authoritative semantic-tokens server (the *ceiling*). Embeds the committed `flatbars-js` bundle and answers `textDocument/semanticTokens/full` from `tokenize`. Stateful by construction, so set delimiters and dialects are correct. |
| `vscode/` | The VS Code extension: contributes the fallback grammar and spawns `flatbars-lsp`. `dist/` is a git-ignored build product (`npm run build`). |
| `jetbrains/` | The JetBrains plugin (Gradle/Kotlin): bundles the fallback grammar via a `TextMateBundleProvider` (all IDEs) and, on Ultimate (`-PwithLsp`), spawns `flatbars-lsp` through the platform LSP API. `build/` and the synced resources are git-ignored. |

## How they stay in sync (gates, all in `npm test`)

- **`check:highlight`** pins what the engine emits — both `highlightSpans` (tag
  role) and `tokenize` (the full vocabulary) — over a corpus.
- **`check:tmgrammar`** tokenizes a default-delimiter corpus through *both* the
  engine and the real `vscode-textmate` engine and asserts they agree (no
  mis-colour; floor coverage). The grammar is the floor; the engine is the ceiling.
- **`test:lsp`** unit-tests the pure token logic and drives the real stdio server
  over LSP (`initialize` → `didOpen` → `semanticTokens/full`).
- **`test:vscode`** drives the *bundled* server over LSP and runs `vsce package`
  to build a `.vsix` (manifest + grammar valid). Live-editor rendering and the
  Marketplace are out of scope here.
- **`test:jetbrains`** drives the *bundled* server over LSP and checks the
  descriptors + canonical grammar — no JVM needed. The full `gradle buildPlugin`
  (TextMate layer) compiles/packages against the real IntelliJ SDK in CI; the
  Ultimate-only LSP layer (`-PwithLsp`) needs that API on the classpath.

## Changing things

- New/renamed token kind → edit `token-vocabulary.json`, update the engine
  (`FlatBars.Highlight`) and the grammar, then `npm run gen:bundle` (+ bump the
  cache-buster) and `npm run gen:highlight`.
- After any engine change, `npm run gen:bundle` keeps `flatbars-lsp` and the
  extension on current source (they embed the committed bundle).

## Tracked follow-ups

Diagnostics / hover / completion (need the recovering parser — ADR-017 open
question), Marketplace/JetBrains-Marketplace publishing, and a `tree-sitter`
fallback for Zed/Neovim/GitHub (as *another* gated fallback, never the engine's
parser).
