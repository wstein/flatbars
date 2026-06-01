# FlatBars Syntax Highlighting — Specification & Implementation Plan

Status: draft for review · Companions: ADR-014 (highlighting derives from the lexer), ADR-001 (structural parser + walker) · Scope: **all dialects** (RawBars / FullBars / MaxBars / MinBars) across **both front-ends** (FlatBars Lab + tutorials)

---

## 1. Problem

FlatBars currently ships **three** tokenizers for one surface language:

1. **The engine lexer** — `packages/core/src/FlatBars/Lexer.purs` (outer: delimits `{{ }}` / `{{{ }}}` / `{{!-- --}}` / `{{{{ }}}}` raw blocks, with spans) + `packages/core/src/FlatBars/Token.purs` `tokenizeInterior` (interior tokens, **dialect-scoped** via `LexOptions { infixArith }`). This is the authoritative, meaning-free grammar ADR-001 rests on.
2. **The Lab's CodeMirror 6 `StreamLanguage`** — hand-written, painting `.cm-hb-block/expr/partial/raw`.
3. **The tutorials' regex highlighter** — `tutorials/src/lib/highlight.mjs` (the current stopgap).

(2) and (3) approximate (1) and **drift**. Two shipped bugs (ADR-014, Exhibits A & B): the regex disagreed with the engine about where a `{{!-- … --}}` comment begins and ends — the highlighter *lied about what the engine parses*. A regex also cannot tokenize **MaxBars** at all (operator chars `+ - * / % ?? | & !` vs path chars are disambiguated only by the dialect-scoped `LexOptions`).

**Goal.** One grammar (the engine lexer), exposed once, consumed by both front-ends; per-dialect by construction; pinned by a drift gate. Retire (2) and (3).

## 2. The API — `tokenizeTemplate`

Expose a pure, synchronous tokenizer from **`packages/js/src`** (the `flatbars-js` surface bundled to `lab/vendor/flatbars-engine.mjs`), so the **same bundle the Lab and tutorials already load** gains highlighting with no new dependency.

```
tokenizeTemplate(source: string, opts?: { dialect?: Dialect }): Span[]

type Dialect = "rawbars" | "fullbars" | "maxbars" | "minbars"   // default: "fullbars"
type Span = { from: number, to: number, kind: Kind }            // UTF-16 offsets into `source`
```

- **Total / never-throws.** On a lex error it returns spans for everything it *could* classify and a trailing `{ kind: "error", … }` span (highlighting must degrade, never blank the editor). The lexer already produces `ParseError` with a span; surface it rather than discard it.
- **Pure & fast.** No async, no FFI round-trip per token. The bundle is already resident and the lexer already runs on every render; one extra lex of a small string is negligible (ADR-014 settled the perf objection).
- **Offsets, not markup.** It returns positions, not HTML/DOM — each presenter renders in its own idiom. Spans are non-overlapping and ordered; gaps are literal text.

### 2.1 `Kind` enumeration

Derived from the lexer's own token vocabulary, not invented:

| Kind | Source (lexer) | Example |
|---|---|---|
| `expr` | interpolation head | `{{name}}` |
| `raw` | `ROutput` / `&` head | `{{{x}}}`, `{{&x}}` |
| `block-open` / `block-close` / `inverted` | `#` / `/` / `^` separators | `{{#a}}` `{{/a}}` `{{^a}}` |
| `partial` | `>` / `>*` | `{{> p}}`, `{{>* p}}` |
| `parent` / `block-decl` | inheritance `<` / `$` | `{{<layout}}`, `{{$title}}` |
| `comment` | `RComment` (`{{! }}`, `{{!-- --}}`, `{{~!--`) | `{{!-- … --}}` |
| `raw-block` | `RRaw` delimiters | `{{{{raw}}}} … {{{{/raw}}}}` |
| `delimiter` | the `{{`…`}}` punctuation within a tag | (optional finer grain) |
| `content` | `RContent` | literal text |
| **interior kinds** (from `tokenizeInterior`) | `path`, `string`, `number`, `boolean`, `operator`, `pipe`, `paren`, `hash-key` | MaxBars `a \| f`, `a ?? b`, `n + 1` |
| `error` | `ParseError` span | unterminated tag |

The interior kinds are what make MaxBars correct: `tokenizeInterior maxOptions` already lexes `+ - * / % ??` as `TOp` and `|` as a pipe (`infixArith: true`), so operators colour distinctly with **zero** dialect-specific highlighter code.

### 2.2 Two-layer implementation

`tokenizeTemplate` composes the two existing layers:

1. Run the **outer** `FlatBars.Lexer` over `source` → `RawTok` spans (`ROutput` / `RRaw` / `RComment` / `RContent` / separators), each already carrying a `Span`.
2. For each tag interior, run `tokenizeInterior (lexOptionsFor dialect) base interiorText` → `PosToken`s, offsetting by the interior's base position, and map to interior `Kind`s.
3. Flatten to a sorted, non-overlapping `Span[]`. `lexOptionsFor` reuses the dialect's existing `ParseOptions` (`maxOptions` ⇒ `infixArith: true`; others ⇒ `defaultLexOptions`) — **no new dialect logic**.

## 3. The `kind → class` map (shared, one place)

A single ES module — proposed `lab/highlight-classes.mjs` (sibling to `lab/open-in-lab.mjs`, importable by both the Lab and the tutorials) — maps `Kind → CSS class`, reusing the committed `--stem-*` palette (`lab-tokens.css`):

```
expr→stem-expr  raw|raw-block→stem-raw  block-open|block-close|inverted→stem-block
partial|parent|block-decl→stem-partial  comment→stem-comment
operator|pipe→stem-op  string→stem-str  number→stem-num  path→stem-path  error→stem-error
```

New token kinds (operator/string/number/path/error) get palette entries in `lab-tokens.css` (light + dark) so the Lab and tutorials stay visually identical — the whole point of the shared palette (debate consensus item 6).

## 4. Presenters (front-ends differ; grammar does not)

- **Tutorials** — the highlight-layer overlay (`OpenInLab.jsx`'s `CodeEditor`) calls `tokenizeTemplate` and wraps spans in `<span class>` over the escaped source. Replaces the regex in `tutorials/src/lib/highlight.mjs`.
- **Lab** — a CodeMirror 6 `ViewPlugin` (or a `StreamLanguage` shim) that asks `tokenizeTemplate` for the document/visible range and emits decorations with the same classes. **Retires the hand-written `StreamLanguage`.**
- YAML/HTML/JS in both front-ends keep their existing highlighters (the Lab's `lang-yaml`/`lang-html`; the tutorials' `highlightYaml`) — this spec is about **template** syntax, the only surface FlatBars itself defines.

## 5. Tier 2 — the gate becomes engine-derived

`scripts/gen-highlight.mjs` (already shipped as a regression gate over the regex) evolves: the golden source flips from `highlightTemplate(src)` to `tokenizeTemplate(src, { dialect })`, and `check:highlight` asserts each **presenter** reproduces the engine's spans. The existing corpus (Exhibits A & B + per-construct cases, authored to read correctly) carries forward unchanged as the **acceptance set** — so the migration from regex → engine is verifiable, not a leap of faith. Add MaxBars/RawBars corpus rows once the API lands (operators, pipes, bare core).

## 6. Migration plan

1. Implement `tokenizeTemplate` in `packages/js/src`; unit-test in `flatbars-js` against golden spans.
2. `spago bundle -p flatbars-js --module FullBars.JS --bundle-type module --platform browser --outfile lab/vendor/flatbars-engine.mjs` (the committed artifact; `check:bundle` keeps it honest).
3. Add `lab/highlight-classes.mjs` + the new `--stem-*` palette tokens.
4. Swap the tutorials' `CodeEditor` to spans; delete the regex (`highlight.mjs` keeps only `highlightYaml` + `esc`).
5. Swap the Lab's `StreamLanguage` to the span-driven `ViewPlugin`.
6. Flip `gen-highlight.mjs` to engine-derived; extend the corpus to all four dialects.

Each step is independently shippable; the gate stays green throughout.

## 7. Non-goals / open questions

- **Not** a Lezer/CodeMirror grammar written from scratch — that would be a *fourth* hand-maintained definition (rejected in the debate). Lezer is reconsidered only if **generated** from the engine.
- **Incremental tokenization** (per-line/visible-range) is a Lab-side optimization, deferred until a real large-document need appears; tutorial snippets are tiny.
- **Open:** whether `tokenizeTemplate` returns `delimiter` spans (colour the `{{`/`}}` punctuation separately) or folds them into the head kind — a palette decision, not a grammar one.
- **Open:** semantic layer (known vs unknown helper heads via `preludeSchema`; the linter already computes this in `Linter.Aliases`) — a follow-up that consumes these spans, out of scope here.
