<!-- SPDX-License-Identifier: Apache-2.0 -->

# flatbars-lexer-lab — standalone lexer spikes

> **Status: SPIKE.** Not wired into the engine. Depends on no `flatbars*`
> package; nothing in the workspace depends on it. Built to evaluate a
> stateful, CST-style tokenizer against the hand-written
> [`FlatBars.Lexer`](../core/src/FlatBars/Lexer.purs) before any adoption
> decision.

This package holds **two** spikes that share one token model
(`Lexeme`/`Trivia`/`Span`/`LexToken`), so they can be compared head-to-head and
a parity test can assert they agree token-for-token:

- **`FlatBars.Lab.Lexer`** — built on `purescript-parsing` (combinators).
- **`FlatBars.Lab.LexerHand`** — a hand-written tail-recursive index scan.

The headline finding (see Benchmark): the **hand-written** lexer is *faster than
the incumbent on every profile* while producing the richer CST-style stream
(trivia + line/column spans); the **combinator** version is ~4–5× slower. The
token model isn't the cost — the combinator machinery is.

## What they do

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

`spago test -p flatbars-lexer-lab` runs both spikes. The parsing spike has 23
cases (1–15 core: double/triple, sigils, brackets, parens, string + number
literals, operator gating, comments, trim, ocean→leading-trivia + EOF tail,
inner-whitespace trivia, **stateful set-delimiter**, escaped opener, raw block,
empty input, LSP classification, unterminated-tag error; 16–23 adversarial:
empty interior, stray inner brace, CRLF, tab in set-delimiter, spaced raw head,
empty comment, fractional literal, line/column span). The hand spike adds smoke
checks plus a **parity battery**: ~40 inputs run through *both* lexers, asserting
identical `Array LexToken` (lexeme + span + leading trivia) or that both reject —
so the hand lexer inherits the parsing spike's correctness for free.

## Known limitations (deferred on purpose)

| # | Limitation | Why deferred |
| - | - | - |
| L1 | **Strict `tokenize` is fatal** (`Left` on first error). | The hand lexer adds `tokenizeRecovering` (never fails; emits `Invalid` tokens) — see *Wiring to the LSP*. Strict mode stays for the parity test; the parsing spike is still strict-only. |
| L2 | **Coarse raw-block fences** — one lexeme per fence, not `{{{{`/name/`}}}}`. | Edge form; keeps the spikes small. |
| L3 | **Dangling path dot** — `items.[0]` → `Ident "items."`, `[`, `0`, `]`. | Brackets-as-tokens divergence; the parser owns reassembly. |
| L4 | **Parsing spike ~4–5× slower** than the incumbent on tag-bearing input. | Combinator cost (CPS monad, `try`, allocation). *Resolved by the hand spike*, which is faster than the incumbent on every profile — see Benchmark. |
| L5 | **ASCII-only parity** — `index` is code-unit in the hand spike but code-point in `parsing`'s `Position`. | They diverge on non-BMP input; the parity test (and all corpora) are ASCII. |

## Benchmark

`node packages/lexer-lab/bench.mjs` (after `spago build`). Throughput is
dominated by **tag density**, not byte count. All three do the **same work** (full interior tokenization): `incumbent-full` is
the level-1 structural scan *plus* the level-2 interior lexer
(`FlatBars.Token.tokenizeInterior`); the two spikes are single-pass. Three
~50 KiB profiles, Node v26:

| profile | incumbent-full | parsing-spike | hand-spike |
| - | - | - | - |
| ocean (no tags) | 34.8 MB/s | 27.7 MB/s | **39.9 MB/s** |
| prose (~1 tag/90 B) | 10.0 MB/s | 2.5 MB/s | **12.6 MB/s** |
| dense (~1 tag/6 B) | 1.6 MB/s | 0.4 MB/s | **1.8 MB/s** |

Takeaways:

- **The hand-written lexer wins on every profile** — and emits the *richer* CST
  stream (trivia + line/column spans + finer tokens). It even beats the incumbent
  on pure ocean (39.9 vs 34.8) because its fused scan uses `Array.unsafeIndex`
  (no per-char `Maybe`), where the incumbent's `Array.index` allocates a `Just`
  per character — enough to pay for the line/column tracking it adds.
- **The combinator version is ~4–5× slower on tag-bearing input** (prose 2.5 MB/s).
  Same token model, same rules — so the cost is the `purescript-parsing`
  machinery (CPS monad, `try`, per-record allocation), not the design.
- **The incumbent's second pass is nearly free** (prose 10.9 → 10.0 MB/s): the
  interior lexer is another tight index-loop, so its two-phase split costs almost
  nothing over the level-1 scan.
- The ocean scan went 21.5 → 39.9 MB/s once a redundant second traversal was
  removed: the original walked each run twice (find-stopper, then advance
  line/column) and ran `Maybe`-allocating `matchAt` per character. The fused
  single pass tracks position inline and only calls `matchAt` when a character
  could begin the opener.

## Lab 2 — the hand-written lexer

`FlatBars.Lab.LexerHand.tokenize` reproduces the parsing spike's exact output
(token-for-token, asserted by the parity test) via a tail-recursive index scan
over a `Char` array — `Array.unsafeIndex` on the hot path, escape-free ocean
taken in one slice, a reversed-`List` accumulator, and `parsing`'s exact
line/column rules. It is the answer to L4: dropping the combinator machinery
recovers the throughput (prose 2.5 → 12.6 MB/s, *faster* than the incumbent) with
no change to the token model.

## Wiring to the LSP (forgiveness)

`lsp.mjs` turns the hand lexer's tokens into the `textDocument/semanticTokens/full`
wire shape — the same contract the shipping server
([editors/lsp](../../editors/lsp/src/tokens.mjs)) honours: the legend is derived
from the shared [token-vocabulary.json](../../editors/token-vocabulary.json), and
the output is delta-encoded `[deltaLine, deltaStartChar, length, type, modifiers]`
5-tuples. Because every `LexToken` already carries a line/column `Span`, the
conversion is a direct map — no flatten-back-to-lines pass. Like the production
server it emits **sparse corrections** (`lspEmits`: operator/string/number/set-
delimiter), leaving the structural braces to the TextMate floor.

**Forgiveness (ADR-023).** An editor must keep highlighting while you type, so the
wiring drives `FlatBars.Lab.LexerHand.tokenizeRecovering`, which never fails: a
malformed opener (a half-typed `{{ oops`) becomes an `Invalid` lexeme — emitted
with the ADR-017 `error` kind's `invalid` modifier — and lexing resyncs just past
it, so everything around the error still gets tokens. `node
packages/lexer-lab/lsp.test.mjs` demos the classification table, the wire `data`,
and the recovery (it asserts a half-typed template still yields tokens).

## Done in this iteration

- **Lab 2** — the hand-written lexer + a parity battery proving it equals the
  parsing spike; it is faster than the incumbent's full pipeline on every density
  profile (after a fused single-pass ocean scan: 21.5 → 39.9 MB/s on pure text).
- **Forgiveness + LSP** — `tokenizeRecovering` (emits `Invalid`, never fails) and
  `lsp.mjs`, which feeds the hand lexer's tokens to LSP semantic tokens; a
  half-typed template still highlights.
- **P1** — ocean scanned in one slice, via a **native `String.indexOf`**
  (`consumeWith`) rather than `anyTill`'s per-code-point loop: pure-ocean
  throughput went 1.3 → 27 MB/s, matching the incumbent.
- **P3** — spans carry full `SourcePos` (`index` + `line` + `column`).
- **P4** — eight adversarial cases added (16–23).
- **Benchmark** — `bench.mjs` (three lexers × three density profiles); it caught
  and fixed an O(n²) in `assemble` (`Array.snoc`-in-fold → reversed-`List`).

## Next steps

1. **Pick the hand-written lexer** as the adoption basis — it carries the
   CST-style token model at the incumbent's speed; the parsing spike stays as the
   readable executable reference the parity test pins it against.
2. ~~**P2** — error recovery~~ ✓ done (`tokenizeRecovering`). Follow-up: recover
   *inside* a tag (bad interior char) too, not just at the opener, and carry an
   error message on `Invalid` for diagnostics.
3. Decide the bracket/path-segment model with the parser team (L3).
4. If adopted, replace the coarse raw fences and add a `tokenize`-parity gate
   against `FlatBars.Lexer` (boundaries + literals), and lift line/column into a
   shared `Types` module so both spikes import one source of truth.
