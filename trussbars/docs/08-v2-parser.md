# Trussbars v2 — The Rust Parser/Desugar (scoping)

> **Status:** Scoping · **Audience:** the v2 proc-macro author. Companion to the
> diagnostics spike (`docs/07`). This is the part `docs/07` under-scoped: v2's
> dominant task is **parsing**, not emitting.

## 1. Why this is the elephant

The v1 emitter (`MaxBars/Rust.purs`) is *only* the emit step. It reuses the proven
**PureScript** MaxBars front-end:

```
parseWith maxOptions  →  desugarSurfaceWith maxLoopVars  →  [emit, the v1 part]
```

A v2 proc-macro runs **in Rust, at compile time** — it cannot call the PureScript
parser. So v2 must own a Rust **parse + desugar** for the Trussbars surface. The
*emit* logic is already specified (`Rust.purs` is the reference, pinned byte-for-byte
by the 56-case corpus); the parse + desugar is net-new Rust.

**What is unchanged:** the runtime crates (`trussbars-core`/`std`/`derive`) — both
v1 and v2 emit the same calls into them (surface-independent, proven by `docs/05`).
So v2 = *new parser* + *ported desugar* + *transcribed emit*, against an unchanged
runtime.

## 2. What the parser must produce

The **same desugared AST the v1 emitter consumes** — `Node`/`Expr` (core skeleton)
*after* `desugarSurfaceWith`. The acceptance test is mechanical: **v2's
parse+desugar+emit must reproduce the conformance corpus byte-for-byte** (56/56),
because that corpus pins the v1 pipeline's output. Any divergence in the parser
shows up there.

The surface to parse is exactly the **ratified freeze** (`docs/06 §1`):

- **Lexing** — the brace forms `{{ }}` (escaped), `{{{ }}}` (raw), `{{{{ }}}}` (raw
  block), `{{! }}` / `{{!-- --}}` (comment), and literal content between them. *No*
  set-delimiters (`{{=A B=}}` is MinBars-only). Byte-span on every token.
- **Expressions** — paths (`a.b.c`), the operators with precedence (`* / %`, `+ -`,
  `== != < > <= >=`, `&& ||`, `??`, `?:`, `? :` ternary), pipes (`x | f arg`),
  subexpression parens, list literals `[a, b]`, string/number/`true`/`false`/`null`
  literals, and applications (`f a b`).
- **Blocks** — Liquid `each` binding (`{{#each item [i] in coll}}`, `label NAME`),
  `if`/`unless`/`elif`/`else`, `with`, `let` (`{{#let a=(e) b=(e)}}`), inline
  partials (`{{#inline}}` + `{{> n [ctx]}}`), block partials (`{{#partial}}` +
  `{{yield}}`), raw blocks.

## 3. The desugar the emit step depends on

`desugarSurfaceWith` does the rewrites the emitter's `node`/`expr` assume. v2 must
replicate them (port the rules, not the code):

- **Paths → `lookup` chains** rooted at a scope binding or `this`
  (`{{a.b}}` → `lookup (this) "a" "b"`; a block-param head roots there).
- **Liquid `each` → the core block** with `@param` markers for the bindings
  (the emitter reads them via `splitBlockArgs`).
- **`{{#let}}` → nested single-binding lets** with each alias added to scope, so a
  bare `{{a}}` roots at the alias (the v1 emitter relies on exactly this — one
  `name=value` `@hash` per block).
- **Hash args → `@hash`/`dict`**; **block params → trailing string markers**
  (`splitBlockArgs.positional`/`.params`/`.label`/`.hash`).
- **Escaped output wrap** (`{{ x }}` → `escapeHtml (…)`).
- **Operator/pipe desugar** to `App`-head calls the emitter matches
  (`a + b` → `App "add" [a, b]`, `x | f arg` → `App "f" [x, arg]`).

These are documented in `FullBars/Surface.purs`; that module is the desugar spec.

## 4. Options

| | Approach | Pros | Cons |
| --- | --- | --- | --- |
| **A** | **Port** the PureScript lexer/parser/desugar to Rust verbatim | maximal fidelity; the corpus will confirm it | ports the *whole* MaxBars surface (more than the Trussbars subset); PS idioms don't map cleanly |
| **B** | **Fresh recursive-descent parser** for the Trussbars *subset* + port only the desugar rules | smaller (subset, not full MaxBars); tuned for byte-span diagnostics (`docs/07`); idiomatic Rust | must re-derive the grammar; risk of subtle divergence (caught by the corpus) |
| **C** | Parser-combinator lib (`winnow`/`nom`) for the subset | fast to write; good error spans | a dependency in the proc-macro; combinator perf at macro time |

## 5. Recommendation

**Option B — a fresh recursive-descent parser for the Trussbars subset, plus a
direct port of the desugar *rules*.** Rationale:

- v2 only needs the **frozen v1 surface** (a subset of MaxBars), so re-deriving that
  grammar is bounded — and smaller than porting the general MaxBars front-end (A).
- The diagnostics plan (`docs/07`) needs **byte-spans threaded through every node**;
  a purpose-built parser carries them natively, where a verbatim port would fight
  the PS span model.
- **Zero parser dependencies** keeps the proc-macro lean (vs C) and matches the
  "small, auditable substrate" ethos.
- **The corpus is the safety net:** parse+desugar+emit must hit 56/56. Build the
  parser test-first against it; divergence is mechanically visible.

Hand-written recursive descent for `{{ }}`-style templates is well-trodden (the
PureScript lexer is itself a brace-aware scan); the expression grammar is the only
non-trivial part (precedence-climbing for the operators).

## 6. Build order (v2)

1. **Lexer — ✅ DONE** (`crates/trussbars-template`, `src/lex.rs`). Brace-aware scan
   (depth-tracked, string-skipping, so dict/list literals need no space before
   `}}`) → `Lexeme`s with byte-`Span`s that tile the source exactly. Handles
   `{{ }}` / `{{{ }}}` / `{{# }}` / `{{/ }}` / `{{> }}` / `{{! }}` / `{{!-- --}}` and
   four-brace raw blocks (verbatim body). Gate: round-trips all 57 corpus templates
   (`tests/corpus.rs`, fixture from `extract-corpus.mjs`) + 10 unit tests.
2. **Expression parser — ✅ DONE** (`src/parse_expr.rs`, `src/ast.rs`). An interior
   tokenizer + a precedence-climbing parser (ternary → pipe → `??` → `?:` → `||` →
   `&&` → cmp → `+ - ..` → `* / %` → unary → application → atoms) producing the
   desugared core `Expr` (App/Lit): operators/pipes → `App`, paths → `lookup`
   chains rooted via a `Scope`, list/dict literals, negatives, true/false/null.
   Gate: 9 unit tests pinning the AST.
3. **Block parser + desugar — ✅ DONE** (`src/parse.rs`). The `Lexeme` stream → a
   structured, desugared `Node` tree: if/unless (negated)/`else if`-chain, the
   Liquid `each item [i] in coll [label]` binding, `with`, sequential `let` hash,
   inline/partial/`{{yield}}`, raw blocks; `Scope` threaded so a binding/alias roots
   its paths at itself. Gate: 10 unit tests + **the whole 57-template corpus parses**
   (`tests/corpus.rs::parser_accepts_the_whole_corpus`).
4. **Emit — ✅ DONE** (`src/emit.rs`, `src/bin/truss-emit.rs`). A faithful
   transcription of `MaxBars/Rust.purs` onto the structured `Node`/`Expr` tree:
   inline-partial hoisting, the render-fn wrapper + `SizeHint` capacity seed, the
   value-helper pack (`emit_helper`/`emit_kind`), `lookup`/loop-chain paths with the
   `parent`/`root` `Option` threading, each (with the G2 frame elision + enumerate
   drop), if/elif/else, with (+ `find`), sequential `let`, partials/`yield`, the
   collection filters (`where`/`reject`/`some`/`every`/`find`). Gate: the
   conformance harness `--v2` flag emits through this Rust pipeline instead of the
   v1 PureScript emitter and asserts the SAME golden — **56/56 byte-identical**, 1
   excluded (`neg-dict`, deferred), 0 drift. (`dict` literals stay a v2 follow-up.)
5. **Diagnostics** — `compile_error!` (class A) + `quote_spanned!` (class B) +
   the trybuild gate (`docs/07 §4`).

The order means the corpus is green incrementally, and the emit step is the *least*
risky (it's a transcription of a pinned reference).

## 7. Scope honesty

This is the bulk of v2. The emit + diagnostics (`docs/07`) are comparatively small
once the parser produces the right AST. Estimate the parser at the majority of the
v2 effort, and treat the corpus as its definition of done.
