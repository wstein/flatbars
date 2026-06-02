# FlatBars Syntax Highlighting — Tier-1 Implementation Plan

Status: implementation plan (ADR-014 Tier 1) — ready to build · Companions: ADR-014 (highlighting derives from the lexer), ADR-001 (structural parser + walker), ADR-015 (set delimiters) · Scope: **all four dialects** (RawBars / FullBars / MaxBars / MinBars) across **both front-ends** (FlatBars Lab + tutorials), template **and** data highlighting.

---

## 1. Problem (the audit)

Highlighting is reinvented per surface, with no shared source. The real inventory:

**FlatBars-template highlighting — two *separate* hand-written regexes that drift from each other and from the engine:**

1. **Tutorials** — `tutorials/src/lib/highlight.mjs` `highlightTemplate` (`TAG_RE`). Source of Exhibits A & B (long-comment / triple boundaries); cannot do MaxBars operators; cannot do set delimiters (a stateless regex can't track the delimiter pair — there is an in-source caveat saying so).
2. **Lab** — `lab/index.html` `handlebarsHighlighting` (a `ViewPlugin` over `HB_TAG_RE` + `hbMarkFor`, ~L1821). A *different* regex; `hbMarkFor` doesn't even classify `{{<p}}` / `{{$b}}` inheritance (they fall through to "expr"), and like (1) it has no set delimiters and no dialect awareness.

**Data (YAML) highlighting — two different, both-imperfect approaches:**

3. **Tutorials** — `highlightYaml` / `hlYamlValue` (a line-by-line regex). Cannot handle multi-line YAML: block scalars (`|` / `>`), flow collections spanning lines, nested structures, anchors/aliases, multi-document. This is the "not even YAML is correct" report.
4. **Lab** — the *real* CodeMirror `lang-yaml` grammar **plus** a hand-written `yamlDecorator` regex (~L1866) bolted on to colour bool/null/number scalar values.

**Lab-internal editor DSLs — four more hand-written CM `StreamLanguage` modes:** `jsonataLang`, `jsLang`, `bytecodeLang`, `st4SourceLang` (transform / controller / bytecode / ST4 views). Not FlatBars-syntax drift; out of this plan's scope (§9).

So a single FlatBars template is tokenized by **two** regexes, and YAML by **two** mechanisms — at least four independent definitions of two languages, none derived from an authority. That is the recurring-bug engine.

### 1.1 Why set delimiters is the decisive driver

`{{=<% %>=}}` rewrites the active delimiter pair mid-document (ADR-015): after it, `{{` is literal and `<% %>` are tags. Tokenization becomes **stateful** — the `{open, close}` is a value that changes at a tag. A stateless regex (tutorials *and* Lab) cannot express this and will mis-highlight after a switch. The **only** tokenizer that already tracks the live pair is the engine lexer (`FlatBars.Lexer`, `mustacheDelims` mode, shipped in ADR-015). Therefore engine-derived highlighting is not just less drift — it is the only design that is *correct* on set delimiters.

## 2. Decision — one tokenizer per language, one presenter

* **FlatBars syntax → the engine lexer.** Expose `highlightSpans(template, dialect) → Span[]` from `flatbars-js` (a thin `FlatBars.Highlight` core module over the lexer, on the `FullBars.JS` facade). This replaces **both** template regexes (#1, #2), is correct on set delimiters (stateful, because the lexer carries the live delimiter pair) and on every dialect's tag boundaries and roles (the `LexConfig` seam), and is gated against the engine. Clause separators (`{{else}}` / `{{elif …}}`) are classified per-dialect from the **same** `standaloneSeps` the parser threads into `trimStandalone` — IoC, not a hardcoded keyword list, so MinBars (no `else`) never mis-paints a variable named `else`.
* **Host data (YAML/HTML) → a real grammar — the same one on both surfaces.** CodeMirror's `lang-yaml` / `lang-html`. The Lab already has them; the tutorials get them by **adopting CodeMirror 6** (today they hand-roll YAML only because they use a `<textarea>`+overlay). This replaces #3 and lets #4's decorator be dropped.
* **One presenter.** A shared CM6 extension renders engine spans as decorations. Adopting CM6 in the tutorials means *both* surfaces use the same extension — there is no second presenter to keep in step.

Net deletions: tutorials `highlightTemplate` **and** `highlightYaml` (the whole `highlight.mjs` regex layer), the Lab's `handlebarsHighlighting` regex `ViewPlugin`, and the Lab's `yamlDecorator`.

## 3. The engine API — `highlightSpans`

A pure, synchronous tokenizer in `FlatBars.Highlight` (core), exposed on `packages/js/src/FullBars/JS.purs` (so the resident bundle gains it with no new dependency). Named `highlightSpans`, not `tokenizeTemplate` — the core lexer already owns `FlatBars.Lexer.tokenizeTemplate` (the `RawTok` scanner this builds on).

```
highlightSpans(template: string, dialect: Dialect): Span[]

type Dialect = "rawbars" | "fullbars" | "maxbars" | "minbars"
type Span    = { from: number, to: number, kind: Kind }          // UTF-16 offsets into `template`
```

- **Total / never-throws.** On a lex error, return spans for everything classified plus a trailing `{ kind: "error" }` span — highlighting degrades, never blanks. (The lexer's `ParseError` already carries a span.)
- **Pure & fast.** No async, no per-token FFI. The bundle is resident and the lexer already runs every render; one extra lex of a small string is negligible.
- **Offsets, not markup.** Non-overlapping, ordered; gaps are literal text. Each host renders in its own idiom (here: CM decorations).

### 3.1 `Kind` enumeration (from the lexer's own vocabulary)

Each tag produces exactly **one whole-tag span** tagged by its structural role (the `RawTok` constructor + sigil). Content runs produce no span — they stay default text.

| Kind | Lexer source | Example |
|---|---|---|
| `expr` | bare interpolation head (`RSep`, non-clause) | `{{name}}` |
| `keyword` | `RSep` whose head is in the dialect's `clauseSeps` | `{{else}}`, `{{elif x}}` |
| `partial` | `RSep` with `>` / `>*` head | `{{> p}}`, `{{>* p}}` |
| `raw` | `ROutput` / `RAmp` (`&`) | `{{{x}}}`, `{{&x}}` |
| `block-open` | `ROpen Section` (`#`) | `{{#a}}` |
| `block-inverse` | `ROpen Inverse` (`^`) | `{{^a}}` |
| `block-parent` | `ROpen Parent` (`<`) | `{{<layout}}` |
| `block-decl` | `ROpen BlockDef` (`$`) | `{{$title}}` |
| `block-close` | `RClose` (`/`) | `{{/a}}` |
| `comment` | `RComment` (`{{! }}`, `{{!-- --}}`, `{{~!--`) | `{{!-- … --}}` |
| `set-delimiter` | `RSetDelim` (ADR-015) | `{{=<% %>=}}` |
| `raw-block` | `RRaw` (whole block) | `{{{{raw}}}} … {{{{/raw}}}}` |
| `error` | lex error | unterminated tag (degrades to `[]`, see §3) |

`keyword` is the user-facing payoff of deriving from the engine: `{{else}}`/`{{elif …}}` paint as statements (same palette slot as the block kinds), and *which* words count is the dialect's `clauseSeps` — `["else","elif"]` for the kernel dialects (RawBars/FullBars/MaxBars), `[]` for MinBars. A regex would have to hardcode the list and would mis-paint `else` in a Mustache template.

### 3.2 Implementation — one layer now, interior tokens deferred

1. Run the outer `FlatBars.Lexer.tokenizeTemplate` (with the dialect's `LexConfig` — including `mustacheDelims` for set delimiters) → `RawTok`s, each carrying a `Span`. `RSetDelim` and a custom-delimited tag both arrive here already correctly delimited, **because the lexer carries the live pair** — this is the set-delimiters payoff.
2. Map each `RawTok` to one whole-tag `HSpan` by its role (table above); for `RSep`, dispatch on `>` head (partial) → `clauseSeps` membership (keyword) → otherwise `expr`. Content runs map to nothing.
3. `LexConfig` + `clauseSeps` are the two dialect seams, supplied by the facade from each dialect's existing settings (`RawBars`/`MaxBars`/`MinBars` set `mustacheDelims = true`; FullBars default-off) — **no new dialect logic**.

**Interior token kinds are deferred** (`path`/`string`/`number`/`operator` *inside* a MaxBars tag). They can't be derived from the current interior lexer: `FlatBars.Token.PosToken` carries only a token *start* (`at`) and, for numbers/strings, the *parsed value* rather than source text, so an exact end offset isn't recoverable. Surfacing them needs `PosToken` to gain an end offset — an invasive change to `FlatBars.Token` and every parser consumer — so it is tracked in §10, not phase 1. Whole-tag coloring is *correct* (it matches/exceeds today's whole-tag regex coloring and fixes every structural bug); interior granularity is an enhancement, not a correctness gap.

## 4. The shared CM6 presenter — `lab/cm-flatbars.mjs`

A new shared module (sibling to `lab/open-in-lab.mjs`, importable by both surfaces) exporting a CodeMirror 6 extension:

```
flatbarsHighlight(dialect): Extension     // a ViewPlugin: highlightSpans(doc, dialect) → Decoration.set
flatbarsHighlightTheme: Extension         // maps kinds → the --stem-* palette
```

- The `ViewPlugin` scans the document (templates are small; full-doc scan avoids the cross-line `{{!-- … --}}` issue the Lab already documents), calls `highlightSpans`, and emits one `Decoration.mark({ class })` per span. On `docChanged`, recompute.
- The **kind → class** map lives here, once, reusing the committed `--stem-*` palette (`lab-tokens.css`); new kinds (`set-delimiter`/`error`, and the per-sigil block kinds) get palette entries in light + dark so both surfaces look identical:

```
expr→stem-expr  raw|raw-block→stem-raw
block-open|block-inverse|block-close|keyword→stem-block   block-parent|block-decl|partial→stem-partial
comment|set-delimiter→stem-comment  error→stem-error
```

`keyword` (the `{{else}}`/`{{elif}}` clause separators) shares `stem-block`, so it reads as a statement alongside `{{#…}}` — the user-requested behavior, derived from the dialect rather than hardcoded.

Because both hosts use this one extension, "the kind→class map" and "the presenter" are a single artifact — there is nothing to keep in sync between Lab and tutorials.

## 5. Tutorials — adopt CodeMirror 6

The tutorials' `OpenInLab.jsx` `CodeEditor` is a `<textarea>` + a highlight-`<pre>` overlay driven by the regex highlighters. Replace it with a **CodeMirror 6 `EditorView`** per editor (mounted in a Preact `useEffect`, `client:visible` as today):

- **template / partial editors** → `[flatbarsHighlight("minbars"), flatbarsHighlightTheme, …editing]` (the shared engine extension).
- **data editor** → `[yaml(), …editing]` (real `@codemirror/lang-yaml` — fixes the multi-line YAML bug, deletes `highlightYaml`).
- The existing wiring is preserved: an `updateListener` feeds edits back to state (live re-render through the bundled engine, the dock "Open in Lab" link). The output pane stays a plain dark `<pre>` (rendered text, no editor).
- **Deletes** `tutorials/src/lib/highlight.mjs` entirely (both `highlightTemplate` and `highlightYaml`); the static spec-only block (lambdas) is highlighted by a read-only CM instance with the FlatBars extension, or kept as a static engine-tokenized render at build time.

**Dependencies / weight.** Add `@codemirror/{state,view,language,lang-yaml,lang-html,commands}` to the tutorials (Vite bundles them; ~150–250 KB gz). Tradeoff: the tutorials already ship the 369 KB engine bundle and host live editors, so CM6 is proportionate, and it is the only way to get a *real* YAML grammar there. *Fallback if the weight is rejected:* keep the textarea+overlay but feed it engine `tokenizeTemplate` spans for the template (delete `highlightTemplate`) and accept best-effort YAML — but this keeps a second presenter and a weak YAML story, so CM6 adoption is recommended.

## 6. Lab — rewire to the shared extension

- Replace `handlebarsHighlighting` / `HB_TAG_RE` / `hbMarkFor` (~L1815–1864) with `flatbarsHighlight(activeDialect)` from `cm-flatbars.mjs`. The dialect comes from the active engine selector — so the Lab finally highlights MaxBars operators and set delimiters correctly, and stops mis-tagging `{{<}}`/`{{$}}`.
- Drop `yamlDecorator` (~L1866): real `lang-yaml` already colours structure; if the bool/null/number value tint is still wanted, fold it into a tiny lang-yaml extension rather than a bespoke regex. (Lab keeps `lang-yaml`/`lang-html`/`lang-markdown` as-is.)
- The four DSL `StreamLanguage`s (`jsonataLang`/`jsLang`/`bytecodeLang`/`st4SourceLang`) are untouched (§9).

## 7. Conformance gate (mandatory)

Upgrade `scripts/gen-highlight.mjs` (`check:highlight`) from "snapshot the regex output" to **engine-derived**: the golden source becomes `tokenizeTemplate(src, { dialect })`, and the gate asserts the shared presenter reproduces the engine's spans. The corpus **must** include:

- **set-delimiters** cases (default switch, switch-back, a tag *after* a switch — the case every regex fails);
- **per-dialect** cases (MaxBars operators/pipes; RawBars bare; MinBars sigils);
- the existing Exhibit A/B + per-construct cases (carried forward as the acceptance set).

A lexer change not reflected in highlighting then fails the build — highlighting joins the "measured, not asserted" gates (`examples:verify`, `test:compile`, `check:catalog`).

## 8. Phasing (each step shippable + gated)

1. **Expose `highlightSpans`** on `FullBars.JS` — a `FlatBars.Highlight` core module mapping `RawTok`s to whole-tag spans + a per-dialect clause-keyword classification (+ a `flatbars` unit test against golden spans); regenerate the bundle (`spago bundle …`, `check:bundle`). **[done]**
2. **`lab/cm-flatbars.mjs`** — the shared extension + theme + kind→class map; new `--stem-*` palette tokens in `lab-tokens.css`.
3. **Lab rewire** — swap in `flatbarsHighlight`; delete `HB_TAG_RE`/`hbMarkFor`/`yamlDecorator`. (Visible win: MaxBars + set delimiters highlight in the Lab.)
4. **Tutorials CM6 adoption** — `CodeEditor` → CM6; template = shared extension, data = `lang-yaml`; delete `highlight.mjs`.
5. **Flip `check:highlight`** to engine-derived; add the set-delimiters + per-dialect corpus.

Steps 1–2 are pure additions; 3 and 4 are independent surface swaps; 5 locks it. The regexes stay until their surface is swapped, so nothing regresses mid-flight.

## 9. Non-goals

- **The Lab's DSL modes** (`jsonataLang`/`jsLang`/`bytecodeLang`/`st4SourceLang`) — not FlatBars syntax; `jsLang` could later become `@codemirror/lang-javascript`, the rest are pragmatic small modes. Out of scope.
- **A portable grammar for external ecosystems** (GitHub/VS Code TextMate, tree-sitter) — a *separate* effort: a **generated** grammar emitted from the engine's opener table + `LexOptions`, gated against the engine, documented to degrade gracefully on set delimiters (a static grammar can't track the pair). Own ADR when pursued; see the debate.
- **Incremental tokenization** (visible-range only) — a Lab optimisation deferred until a large-document need appears; full-doc scan is fine for both surfaces today.

## 10. Future developments

- **Interior token kinds:** colour `path`/`string`/`number`/`operator`/`pipe` *inside* a tag (so MaxBars `a | f`, `a ?? b`, `n + 1` read with operators distinct from paths). The engine already *tokenizes* them correctly (`tokenizeInterior maxOptions` lexes `+ - * / % ??` as `TOp`, `|` as a pipe); the blocker is that `FlatBars.Token.PosToken` records only a token *start* and stores parsed values (not source text) for numbers/strings, so an exact end offset isn't recoverable. Add an end offset to `PosToken` (touches `FlatBars.Token` and every parser consumer), then layer interior spans under each whole-tag span. Enhancement, not a correctness gap.
- **Semantic layer:** with engine spans in hand, distinguish *known* vs *unknown* helper heads via `preludeSchema` (the linter's `Linter.Aliases` already computes this) and surface lexer `ParseError` spans as editor squiggles (the Lab already imports `lintGutter`/`linter`).
- **WASM lexer:** compile a slice of `FlatBars.Lexer` to WASM to back a tree-sitter external scanner — making even the external/portable grammar set-delimiter-correct, still from one source.

## 11. Open questions

- Whether `tokenizeTemplate` emits separate `delimiter` spans for the `{{`/`}}` punctuation, or folds them into the head kind — a palette decision, not a grammar one.
- Whether the tutorials' static lambda spec-block is highlighted by a read-only CM instance or a build-time engine-tokenized render (both work; the latter avoids a CM instance for a non-editable block).
