<!-- SPDX-License-Identifier: Apache-2.0 -->

# flatbars-lexer-lab — a standalone lexer spike

> **Status: SPIKE.** Not wired into the engine. Depends on no `flatbars*`
> package; nothing in the workspace depends on it. Built to evaluate a
> `purescript-parsing`-based, stateful, CST-style tokenizer against the
> hand-written [`FlatBars.Lexer`](../core/src/FlatBars/Lexer.purs) before any
> adoption decision.

## What it does

`FlatBars.Lab.Lexer.tokenize :: LexConfig -> String -> Either ParseError (Array LexToken)`
breaks a template into a **delimiter-level** token stream:

- **Delimiters** as distinct lexemes — `{{` (`Open`), `{{{` (`OpenTriple`),
  `}}` (`CloseTag`), `}}}` (`CloseTriple`), plus coarse raw-block fences.
- **Sigils** (`#`, `^`, `/`, `>`, `&`, `$`, `<`, `#*`, `#>`) as their own
  lexemes, separate from the head identifier.
- **Structural punctuation** `[ ] ( )` broken out (a deliberate divergence from
  `FlatBars.Token`, which folds `[…]` into a path ident).
- **Literals** — single/double-quoted strings (with `\n \t \r \\ \" \'`
  escapes) and numbers (including negative and fractional).
- **Operators** — `&& || == != <= >= < > ! |`, plus `?? + - * / %` under
  `infixArith`. Meaning-free; a dialect assigns meaning.
- **Whole-tag forms** — `{{! … }}` / `{{!-- … --}}` comments, `{{=A B=}}`
  set-delimiters, raw blocks.

### Three design commitments

1. **Trivia is leading-only.** The host-text *ocean* between tags (`Text`) and
   the whitespace *inside* a tag (`Whitespace`) are `Trivia`, never tokens.
   Each run attaches as the **leading** trivia of the lexeme that follows it.
   There is no trailing-trivia channel.
2. **EOF carries the tail.** The last token is a synthetic `Eof`; the trailing
   ocean is its leading trivia. No source byte is dropped (lossless), matching
   `language-cst-parser`'s `TokenEOF pos comments`.
3. **State is the delimiter pair.** `{{=A B=}}` mutates the active `open`/`close`
   pair via `State LexState`, so `<% x %>` after a switch lexes correctly. This
   is what makes the lexer *stateful* rather than a context-free scan.

### LSP feed

Every lexeme carries a `Span` whose endpoints are full `SourcePos` values
(`{index, line, column}`), so an LSP can build a `Range` without re-scanning for
line starts. `semanticTokenType` maps a lexeme to its ADR-017 token-vocabulary
type; `lspEmits` is the sparse correction set (operator/string/number/set-
delimiter) the LSP would actually paint over the TextMate floor.

## Mini-spec (token grammar)

```ebnf
tokens   := chunk* EOF
chunk    := tag | ocean
ocean    := ( '\' open | run-until-open )+          -- leading Text trivia (sliced once)
tag      := setDelim | rawBlock | longComment | shortComment | triple | double
              | simple(open,close)                  -- when delimiters are custom
double   := '{{'  '~'? sigil? interior '~'? '}}'
triple   := '{{{' interior '}}}'
simple   := open  sigil? interior close
interior := ( ws | '[' | ']' | '(' | ')' | string | number | operator | ident )*
setDelim := open '=' word ws word '=' close         -- mutates (open,close)
ident    := identChar+   (identChar per FlatBars.Token, gated by infixArith)
```

## Test matrix

`spago test -p flatbars-lexer-lab` — 23 cases. Core (1–15): double/triple,
sigils, brackets, parens, string + number literals, operator gating, comments
(long/short), trim, ocean→leading-trivia + EOF tail, inner-whitespace trivia,
**stateful set-delimiter**, escaped opener, raw block, empty input, LSP
classification, unterminated-tag error. Adversarial (16–23): empty interior,
stray inner brace (error), CRLF in ocean, tab between set-delimiter words,
spaced raw-block head, empty short comment, fractional literal, and a
**line/column span** assertion.

## Known limitations (deferred on purpose)

| # | Limitation | Why deferred |
| - | - | - |
| L1 | **No error recovery** — first lexical error is fatal (`Left`). | ADR-023 wants a *recovering* parser; `purescript-parsing` does not recover. Adoption blocker, tracked (P2). |
| L2 | **Coarse raw-block fences** — one lexeme per fence, not `{{{{`/name/`}}}}`. | Edge form; keeps the spike small. |
| L3 | **Dangling path dot** — `items.[0]` → `Ident "items."`, `[`, `0`, `]`. | Brackets-as-tokens divergence; the parser owns reassembly. |
| L4 | **~4× slower than the incumbent's full two-pass pipeline on tag-bearing input** (≈par on pure text). | Per-tag combinator cost (CPS monad, `try`, per-record allocation) plus a finer-grained stream. Acceptable for typical files; weigh for huge tag-dense batch paths. |

## Benchmark

`node packages/lexer-lab/bench.mjs` (after `spago build`). Throughput is
dominated by **tag density**, not byte count. The fair comparison is the spike's
single pass against the incumbent's **full** pipeline — its level-1 structural
scan *plus* the level-2 interior lexer (`FlatBars.Token.tokenizeInterior`),
which does the same total work. Three ~50 KiB profiles, Node v26:

| profile | incumbent L1 | incumbent full (L1+L2) | spike (1 pass) | spike vs full |
| - | - | - | - | - |
| ocean (no tags) | 32.5 MB/s | 34.8 MB/s | 27.2 MB/s | 1.3× slower |
| prose (~1 tag/90 B) | 10.6 MB/s | 9.9 MB/s | 2.5 MB/s | ~4× slower |
| dense (~1 tag/6 B) | 1.7 MB/s | 1.5 MB/s | 0.4 MB/s | ~4× slower |

Takeaways:

- **Neither lexer is "slow" on realistic input.** The incumbent's full pipeline
  does prose at ~10 MB/s (50 KB in ~5 ms); the spike at 2.5 MB/s (~20 ms) — both
  fine for an LSP. The 6 MB/s figure in an earlier draft came from a
  pathologically tag-dense corpus.
- **The incumbent's second pass is nearly free** (prose 10.6 → 9.9 MB/s): the
  interior lexer is another tight index-loop, so the two-phase design costs
  almost nothing over the level-1 scan alone.
- **The spike matches the incumbent on pure text** (native-`indexOf` ocean scan)
  and is ~4× slower only on tag-bearing input — pure per-tag combinator overhead.
  (The `incumbent-full` figure is, if anything, conservative: it glues the two
  passes in JS, which the real PureScript `parse` path does not.)

## Done in this iteration

- **P1** — ocean scanned in one slice, via a **native `String.indexOf`**
  (`consumeWith`) rather than `anyTill`'s per-code-point loop: pure-ocean
  throughput went 1.3 → 27 MB/s, matching the incumbent.
- **P3** — spans carry full `SourcePos` (`index` + `line` + `column`).
- **P4** — eight adversarial cases added (16–23).
- **Benchmark** — `bench.mjs` (three density profiles); along the way it caught
  and fixed an O(n²) in `assemble` (`Array.snoc`-in-fold → reversed-`List`).

## Next steps

1. **Benchmark** against `FlatBars.Lexer` on a 50 KB corpus (gate adoption on it).
2. **P2** — error recovery (sentinel re-sync at the next opener, emitting an
   `Error` lexeme that also feeds ADR-017's `error` kind) to meet ADR-023.
3. Decide the bracket/path-segment model with the parser team (L3).
4. If adopted, replace the coarse raw fences and add a `tokenize`-parity gate.
