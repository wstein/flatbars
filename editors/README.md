# `editors/` — third-party editor support (ADR-017)

Highlighting FlatBars in real editors by **running the engine lexer**, never by
approximating it. See `docs/modules/ROOT/pages/adr-0017-editor-support-lsp.adoc`.

| Path | What it is |
| --- | --- |
| `token-vocabulary.json` | **The single source of truth.** Each engine token `kind` → its `role` (`tag`/`interior`), LSP semantic-token `type`/`modifiers`, and TextMate `tmScopes`. The three consumers below all derive from it. |
| `flatbars.tmLanguage.json` | The TextMate **fallback** grammar — the *floor*. The well-known Handlebars grammar, re-identified as `source.flatbars` and extended for all four dialects (inverse, Mustache inheritance, set delimiters, MaxBars operators), keeping its standard scope names so themes colour FlatBars familiarly. Colours **only template syntax + a leading YAML front-matter block** — host text is left plain (a FlatBars template's output need not be HTML). Best-effort and non-authoritative: stateless, FullBars-flavoured, and it cannot follow a set-delimiter *switch* — the LSP corrects those. |
| `lsp/` | **`flatbars-lsp`** — the authoritative semantic-tokens server (the *ceiling*). Embeds the committed `flatbars-js` bundle and answers `textDocument/semanticTokens/full` from `tokenize`. Stateful by construction, so set delimiters and dialects are correct. |
| `vscode/` | The VS Code extension: contributes the fallback grammar and spawns `flatbars-lsp`. `dist/` is a git-ignored build product (`npm run build`). |
| `jetbrains/` | The JetBrains plugin (Gradle/Kotlin): bundles the fallback grammar via a `TextMateBundleProvider` (all IDEs) and, on Ultimate (`-PwithLsp`), spawns `flatbars-lsp` through the platform LSP API. `build/` and the synced resources are git-ignored. |

## How they stay in sync (gates, all in `npm test`)

- **`check:highlight`** pins what the engine emits — both `highlightSpans` (tag
  role) and `tokenize` (the full vocabulary) — over a corpus.
- **`check:tmgrammar`** tokenizes a per-dialect corpus through *both* the engine
  and the real `vscode-textmate` engine and asserts they agree on **tag boundaries**
  and **literals** (the grammar is richer than the engine, so extra sub-token
  colouring is allowed enrichment). The grammar is the floor; the engine is the ceiling.
- **`check:vocab`** pins the joints of the "one vocabulary, three consumers"
  contract (ADR-017): engine kinds ≡ `token-vocabulary.json` kinds (witnessed by the
  `check:highlight` corpus, so no second corpus), the pinned sparse `lspEmitKinds`
  set (widening it would re-flatten `{{{x}}}` — guarded here), the LSP legend
  derivation, and that every vocabulary `tmScope` still exists in the grammar.
- **`test:lsp`** unit-tests the pure token logic and drives the real stdio server
  over LSP (`initialize` → `didOpen` → `semanticTokens/full`).
- **`test:vscode`** drives the *bundled* server over LSP, asserts the
  auto-activation precondition (`engines.vscode >= 1.74` so VS Code generates the
  `onLanguage` events, and `contributes.languages` ≡ the shared dialect set), and
  runs `vsce package` to build a `.vsix` (manifest + grammar valid).
- **`test:vscode:ide`** (CI / on demand, not in `npm test`) downloads a real VS
  Code and, in the Extension Host, opens a `.maxbars` fixture and asserts the
  extension auto-activates and that a semantic token **and** a published diagnostic
  actually surface — the end-to-end ceiling the offline smoke test can't reach.
  Heavy (a VS Code download + a windowed run); the Marketplace is still out of scope.
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
- The VS Code and JetBrains packagers share one bundle step and language set —
  `editors/shared/sync.mjs` (pinned to the same esbuild `gen:bundle` uses). Change
  the dialect set or bump esbuild there, in one place.

## Tracked follow-ups

Hover / completion (on the recovering parser's `NodeError` substrate — ADR-023;
diagnostics already ship), Marketplace/JetBrains-Marketplace publishing, a
`tree-sitter` fallback for Zed/Neovim/GitHub (as *another* gated fallback, never
the engine's parser), and an **opt-in brace-close convenience**: brace
auto-closing is deliberately OFF (FlatBars has `{{ }}` / `{{{ }}}` / `{{{{ }}}}`
widths, so a declarative `{{` pair over-inserts on a run of `{`), so the
convenience would return as a `{{ $0 }}` snippet/completion or a VS-Code-only
"grow the pair" type-handler — never as a declarative auto-closing pair.
