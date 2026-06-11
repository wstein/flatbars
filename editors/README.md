# `editors/` — third-party editor support (ADR-017)

Highlighting FlatBars in real editors by **running the engine lexer**, never by
approximating it. See `docs/modules/ROOT/pages/adr-0017-editor-support-lsp.adoc`.

| Path | What it is |
| --- | --- |
| `token-vocabulary.json` | **The single source of truth.** Each engine token `kind` → its `role` (`tag`/`interior`), LSP semantic-token `type`/`modifiers`, and TextMate `tmScopes`. The three consumers below all derive from it. |
| `flatbars.tmLanguage.json` | The TextMate **fallback** grammar — the *floor*. The well-known Handlebars grammar, re-identified as `source.flatbars` and extended for all four dialects (inverse, Mustache inheritance, set delimiters, MaxBars operators), keeping its standard scope names so themes colour FlatBars familiarly. Colours **only template syntax + a leading YAML front-matter block** — host text is left plain (a FlatBars template's output need not be HTML). Best-effort and non-authoritative: stateless, ClassicBars-flavoured, and it cannot follow a set-delimiter *switch* — the LSP corrects those. |
| `lsp/` | **`flatbars-lsp`** — the authoritative server (the *ceiling*). Embeds the committed `flatbars-js` bundle and answers `semanticTokens/full` from `tokenize`, `publishDiagnostics` from the recovering parser (ADR-023), `hover`/`completion` from `editors/operations.json` (the prelude schema projected by `ClassicBars.Catalog.operations`, incl. each operation's one-line `OperationDef.doc`), and a `codeAction` quick-fix that rewrites a deprecated alias / non-canonical scoped variable to its canonical form (`index`→`index0`, dialect-scoped). Stateful by construction, so set delimiters and dialects are correct. |
| `vscode/` | The VS Code extension — **Trussbars-only** (one language, the `.truss` extension; tokenized with the MaxBars engine surface). Contributes the fallback grammar and spawns `flatbars-lsp`. `dist/` is a git-ignored build product (`npm run build`). |
| `jetbrains/` | The JetBrains plugin (Gradle/Kotlin) — **Trussbars-only** (the `.truss` language). Bundles the fallback grammar via a `TextMateBundleProvider` (all IDEs) and, on Ultimate (`-PwithLsp`), spawns `flatbars-lsp` through the platform LSP API. `build/` and the synced resources are git-ignored. |

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
- **`test:lsp`** unit-tests the pure token + hover/completion/code-action logic and
  drives the real stdio server over LSP (`semanticTokens/full`, `hover`,
  `completion`, `codeAction`, `publishDiagnostics`).
- **`check:operations`** (in `npm test`, needs a build like `check:catalog`) keeps
  `editors/operations.json` in step with `ClassicBars.preludeSchema` — the hover /
  completion / code-action data the server reads (incl. each operation's
  `canonical` rewrite target).
- **`test:vscode`** drives the *bundled* server over LSP, asserts the
  auto-activation precondition (`engines.vscode >= 1.74` so VS Code generates the
  `onLanguage` events, and `contributes.languages` ≡ the shared dialect set), and
  runs `vsce package` to build a `.vsix` (manifest + grammar valid).
- **`test:vscode:ide`** (CI / on demand, not in `npm test`) downloads a real VS
  Code and, in the Extension Host, opens a `.maxbars` fixture and asserts the
  extension auto-activates and that a semantic token **and** a published diagnostic
  actually surface — the end-to-end ceiling the offline smoke test can't reach.
  Heavy (a VS Code download + a windowed run); the Marketplace is still out of scope.
- **`test:jetbrains`** drives the *bundled* server over LSP (semantic tokens **and**
  the `index` → `index0` code-action quick-fix, proving the JetBrains-shipped server
  delivers the same capabilities the VS Code one does) and checks the descriptors +
  canonical grammar — no JVM needed. The platform LSP client consumes those
  capabilities by default (IDEA 2023.3+); that consumption is exercised by the
  `-PwithLsp` CI build, not offline.
- **`.github/workflows/editors.yml`** (CI, path-filtered to the editor surface)
  runs the node gates + the real-IDE VS Code test (under `xvfb`), and a separate
  job that provisions JDK 17 + Gradle (no wrapper in-repo) and runs
  `gradle buildPlugin -PwithLsp` — compiling the TextMate floor *and* the
  Ultimate-only LSP layer against the downloaded IntelliJ IDEA Ultimate SDK.

## Bold tag emphasis (the "isle in the ocean")

Every FlatBars tag — both brace clusters (`{{` `{{{` `{{{{` `{{&` … `}}` `}}}`
`}}}}`) **and** everything between them — renders **bold**, so template logic
stands out from the host text it's embedded in. This is a *theming* decision:
a TextMate grammar assigns scopes, never font weight, so we never touch the
grammar — we ship overridable defaults derived from `token-vocabulary.json`.

- **VS Code — bold everywhere, all themes.** `editors/scripts/sync-manifests.mjs`
  codegens a `contributes.configurationDefaults` block into the extension manifest,
  in two layers (a semantic token overrides the TextMate scope under it, so both
  are needed):
  - `editor.tokenColorCustomizations.textMateRules` — bolds the `*.flatbars`
    scopes (the *floor*, and tags **injected into host files**). These scopes are
    unique to FlatBars, so the global rule is safe.
  - `editor.semanticTokenColorCustomizations` — bolds every semantic type, scoped
    to the four dialect languages (`[classicbars]` …) so we never bold a shared type
    like `variable` outside a FlatBars document (the *ceiling*).

  Both are **defaults** — override in your `settings.json`, e.g. to turn it off:

  ```jsonc
  "editor.semanticTokenColorCustomizations": { "[classicbars]": { "rules": { "variable": { "fontStyle": "" } } } }
  ```

  `check:editors-manifests` diffs the whole manifest, so the bold block can't drift
  from the vocabulary.

- **JetBrains — bold on the LSP ceiling (Ultimate 2024.2+).** The descriptor's
  `lspCustomization` installs `FlatBarsSemanticTokensSupport`, which maps each
  semantic-token type to a `FLATBARS_*` text-attribute key; `FlatBarsBold.xml`
  (registered via `additionalTextAttributes`) overlays `FONT_TYPE = bold` while the
  foreground inherits from each key's fallback, keeping it theme-agnostic. The
  offline `test:jetbrains` pins the wiring and the key-set ↔ vocabulary parity;
  real bold is verified by the `-PwithLsp` build in `editors.yml`.
  - **Community / TextMate floor: theme-controlled, not forced.** JetBrains paints
    TextMate scopes from the *active color scheme* and exposes no plugin-side hook
    to force a font weight on a scope, so bold there is the user's scheme choice
    (no `configurationDefaults` equivalent). This is a platform limitation, the
    same class as the Ultimate-only LSP ceiling.

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

Marketplace/JetBrains-Marketplace publishing, a
`tree-sitter` fallback for Zed/Neovim/GitHub (as *another* gated fallback, never
the engine's parser), and an **opt-in brace-close convenience**: brace
auto-closing is deliberately OFF (FlatBars has `{{ }}` / `{{{ }}}` / `{{{{ }}}}`
widths, so a declarative `{{` pair over-inserts on a run of `{`), so the
convenience would return as a `{{ $0 }}` snippet/completion or a VS-Code-only
"grow the pair" type-handler — never as a declarative auto-closing pair.
