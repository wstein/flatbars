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

- **Total / never-throws.** The outer lexer is all-or-nothing (`Either`), so on a lex error `highlightSpans` returns `[]` — highlighting degrades to plain text rather than guessing where the engine would have stopped (it never disagrees with the lexer). The `error` kind is reserved for a future error-tolerant path; presenters may keep the last good span set to avoid flicker while typing.
- **Pure & fast.** No async, no per-token FFI. The bundle is resident and the lexer already runs every render; one extra lex of a small string is negligible.
- **Offsets, not markup.** Non-overlapping, ordered; gaps are literal text. Each host renders in its own idiom (here: CM decorations).

### 3.1 `Kind` enumeration (from the lexer's own vocabulary)

Each tag produces a span tagged by its structural role (the `RawTok` constructor + sigil), **tiled** with its interior tokens — operators, strings and numbers get their own span; identifiers, parens, delimiters and whitespace stay the tag's colour, so a simple `{{name}}` is one chunk. Content runs produce no span — they stay default text.

**Tag-role kinds** (from the `RawTok` constructor):

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
| `comment` | `RComment` (`{{! }}`) and `RLongComment` (`{{!-- --}}`, `{{~!--`) | `{{!-- … --}}` |
| `set-delimiter` | `RSetDelim` (ADR-015) | `{{=<% %>=}}` |
| `raw-block` | `RRaw` (whole block) | `{{{{raw}}}} … {{{{/raw}}}}` |
| `error` | lex error | unterminated tag (degrades to `[]`, see §3) |

**Interior-role kinds** (from `tokenizeInterior`, ADR-017): `operator` (`TOp` — MaxBars `+ - * / % ?? \| && \|\| == …`), `string` (`TStr`), `number` (`TNum`). Identifiers/paths (`TIdent`) and parens stay the tag's head colour.

`keyword` is the user-facing payoff of deriving from the engine: `{{else}}`/`{{elif …}}` paint as statements (same palette slot as the block kinds), and *which* words count is the dialect's `clauseSeps` — `["else","elif"]` for the kernel dialects (RawBars/FullBars/MaxBars), `[]` for MinBars. A regex would have to hardcode the list and would mis-paint `else` in a Mustache template.

### 3.2 Implementation — tag tiling with interior tokens

1. Run the outer `FlatBars.Lexer.tokenizeTemplate` (with the dialect's `LexConfig` — including `mustacheDelims` for set delimiters) → `RawTok`s, each carrying a `Span`. `RSetDelim` and a custom-delimited tag both arrive here already correctly delimited, **because the lexer carries the live pair** — this is the set-delimiters payoff.
2. Map each `RawTok` to its head-role kind; for `RSep`, dispatch on `>` head (partial) → `clauseSeps` membership (keyword) → otherwise `expr`. For tags with an expression interior (`ROutput`/`RAmp`/`ROpen`/`RClose`/non-partial `RSep`), run `tokenizeInterior (lexOptionsFor dialect)` and **tile** the tag span with the head kind, punching the notable interior tokens (`TOp`/`TStr`/`TNum`) as `operator`/`string`/`number` using their `PosToken` `at`/`end` offsets (ADR-017). Comments, the set-delimiter tag, and raw blocks (literal body) stay one whole-tag span. Content runs map to nothing.
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

## 5. Tutorials — engine-derived overlay (CM6 adoption deferred)

The tutorials' `OpenInLab.jsx` `CodeEditor` is a `<textarea>` + a highlight-`<pre>` overlay. The **template regex is replaced by the engine**: `highlightTemplate(src, dialect)` (in `tutorials/src/lib/highlight.mjs`) now wraps the bundle's `highlightSpans` and emits one `<span class="stem-…">` per span (kind→`stem-*` map mirroring `cm-flatbars.mjs`). The card threads its `engine` prop as the dialect, so the preview is correct on set delimiters, every dialect's tag boundaries, and the clause keywords — and the static lambda block in `minbars.astro` is highlighted the same way (`dialect: "minbars"`). **[done]**

**Why the overlay, not full CM6 (this iteration).** A CM6 `EditorView` mounts *client-side*; neither `astro build` nor `check:tutorial-links` exercises the browser, so a CM6 island can't be verified here, and it carries a real ~150–250 KB gz dependency. The engine-derived overlay achieves ADR-014's actual goal — template syntax derives from the lexer, the regex is gone, the gate is engine-derived — while staying buildable and verified. It is **not** debt: no FlatBars-syntax regex remains.

**`highlightYaml` is kept** (host-*data* line highlighter, unchanged): it is not FlatBars syntax. Adopting a real `lang-yaml` there is the remaining CM6 work — see §10.

## 6. Lab — rewire to the shared extension

- **[done]** Replaced `handlebarsHighlighting` / `HB_TAG_RE` / `hbMarkFor` with `flatbarsHighlight({ ViewPlugin, Decoration }, highlightSpans, ENGINE)` from `cm-flatbars.mjs` (the `ENGINE` global is the active dialect, fixed per page load since switching reloads). The Lab now highlights set delimiters and the inheritance sigils `{{<}}`/`{{$}}` correctly. The `error` kind gained a defensive `.cm-hb-error` style (the palette is inline in `index.html`, not a separate stylesheet).
- **`yamlDecorator` is kept** (data-side scalar tint for `true`/`false`/`null`/numbers): it is host-*data* colouring over a real `lang-yaml` grammar, not a fork of FlatBars *syntax*, so it is outside ADR-014's grammar-unification scope. Consolidating data-format highlighting is a separate concern.
- The four DSL `StreamLanguage`s (`jsonataLang`/`jsLang`/`bytecodeLang`/`st4SourceLang`) are untouched (§9).

## 7. Conformance gate (mandatory)

Upgrade `scripts/gen-highlight.mjs` (`check:highlight`) from "snapshot the regex output" to **engine-derived**: the golden source becomes `tokenizeTemplate(src, { dialect })`, and the gate asserts the shared presenter reproduces the engine's spans. The corpus **must** include:

- **set-delimiters** cases (default switch, switch-back, a tag *after* a switch — the case every regex fails);
- **per-dialect** cases (MaxBars operators/pipes; RawBars bare; MinBars sigils);
- the existing Exhibit A/B + per-construct cases (carried forward as the acceptance set).

A lexer change not reflected in highlighting then fails the build — highlighting joins the "measured, not asserted" gates (`examples:verify`, `test:compile`, `check:catalog`).

## 8. Phasing (each step shippable + gated)

1. **Expose `highlightSpans`** on `FullBars.JS` — a `FlatBars.Highlight` core module mapping `RawTok`s to whole-tag spans + a per-dialect clause-keyword classification (+ a `flatbars` unit test against golden spans); regenerate the bundle (`spago bundle …`, `check:bundle`). **[done]**
2. **`lab/cm-flatbars.mjs`** — the shared extension + kind→class map (reusing the Lab's existing `--stem-*` palette classes, injected CM via DI); unit-tested against the real bundle. **[done]**
3. **Lab rewire** — swapped in `flatbarsHighlight`; deleted `HB_TAG_RE`/`hbMarkFor`/`handlebarsHighlighting`. `yamlDecorator` kept (data-side, §6). Visible win: set delimiters + inheritance sigils highlight correctly. **[done]**
4. **Tutorials template highlighting** — `highlightTemplate` rewritten over `highlightSpans` (dialect from the card's `engine`); the template regex is gone. Full CM6 adoption (real `lang-yaml`, single presenter) deferred — see §5 and §10. **[done]**
5. **Flipped `check:highlight`** to engine-derived: the golden is now `highlightSpans(src, dialect)` from the bundle (21 cases incl. Exhibits A/B, set-delimiter switch + switch-back, clause keywords, per-dialect tag boundaries). The stopgap `highlight.mjs` dependency and YAML cases are gone. **[done]**

Steps 1–3 + 5 are done; step 4 (tutorials CM6) remains. The tutorials' regex stays until its surface is swapped, so nothing regresses mid-flight.

## 9. Non-goals

- **The Lab's DSL modes** (`jsonataLang`/`jsLang`/`bytecodeLang`/`st4SourceLang`) — not FlatBars syntax; `jsLang` could later become `@codemirror/lang-javascript`, the rest are pragmatic small modes. Out of scope.
- **A portable grammar for external ecosystems** (GitHub/VS Code TextMate, tree-sitter) — a *separate* effort: a **generated** grammar emitted from the engine's opener table + `LexOptions`, gated against the engine, documented to degrade gracefully on set delimiters (a static grammar can't track the pair). Own ADR when pursued; see the debate.
- **Incremental tokenization** (visible-range only) — a Lab optimisation deferred until a large-document need appears; full-doc scan is fine for both surfaces today.

## 10. Future developments

- **Interior token kinds** — *done* (ADR-017). `FlatBars.Token.PosToken` gained an `end` offset, so `highlightSpans` tiles each tag with its interior `operator`/`string`/`number` tokens (MaxBars `a | f`, `a ?? b`, `n + 1` read with operators distinct from paths) while identifiers stay the tag's colour. The `end` field is additive — the parsers read only `tok`/`at`, so render/compile are byte-identical.
- **Tutorials CM6 adoption:** swap the `OpenInLab` textarea+overlay for a CodeMirror 6 `EditorView` per editor — template = the shared `flatbarsHighlight` extension (one presenter with the Lab), data = real `@codemirror/lang-yaml` (retiring `highlightYaml`). Deferred this iteration for the ~150–250 KB gz dependency and because a client-mounted island isn't verifiable in the current gates; the engine-derived overlay already removes the FlatBars-syntax regex.
- **Semantic layer:** with engine spans in hand, distinguish *known* vs *unknown* helper heads via `preludeSchema` (the linter's `Linter.Aliases` already computes this) and surface lexer `ParseError` spans as editor squiggles (the Lab already imports `lintGutter`/`linter`).
- **WASM lexer:** compile a slice of `FlatBars.Lexer` to WASM to back a tree-sitter external scanner — making even the external/portable grammar set-delimiter-correct, still from one source.

## 11. Open questions

- Whether `tokenizeTemplate` emits separate `delimiter` spans for the `{{`/`}}` punctuation, or folds them into the head kind — a palette decision, not a grammar one.
- Whether the tutorials' static lambda spec-block is highlighted by a read-only CM instance or a build-time engine-tokenized render (both work; the latter avoids a CM instance for a non-editable block).
