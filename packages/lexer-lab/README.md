<!-- SPDX-License-Identifier: Apache-2.0 -->

# flatbars-lexer-lab — standalone lexer spikes

> **Status: SPIKE.** Not wired into the engine. Depends on no `flatbars*`
> package; nothing in the workspace depends on it. Built to evaluate a
> stateful, CST-style tokenizer against the hand-written
> [`FlatBars.Lexer`](../core/src/FlatBars/Lexer.purs) before any adoption
> decision.

This package holds **two** spikes over **one** shared token model, so they can
be compared head-to-head and a parity test can assert they agree token-for-token:

- **`FlatBars.Lab.Lexer.Types`** — the single source of truth: the
  lexeme/trivia/span types, their classification (`semanticTokenType`/`lspEmits`),
  the lexical character classes, and the pieces→tokens `assemble` fold. Both
  lexers import it, so they cannot drift.
- **`FlatBars.Lab.Lexer`** — built on `purescript-parsing` (combinators);
  re-exports the `Types` model.
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
- **Segmented paths** (L3): `[ ] ( )` are tokens, and so are the path separators
  `.` (`Dot`) and `/` (`Slash`) — a path like `items.[0]` lexes as
  `Ident "items", Dot, LBracket, Num 0, RBracket` (no dangling dot), `../x` as
  `Dot, Dot, Slash, Ident "x"`. A deliberate divergence from `FlatBars.Token`,
  which keeps a whole path in one ident; here every element is individually
  addressable. Under `infixArith`, `/` is the division `Op` instead.
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
| L3 | ~~Dangling path dot~~ ✓ resolved — paths are segmented (`.`→`Dot`, `/`→`Slash`); see *What they do*. | — |
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
wiring drives `FlatBars.Lab.LexerHand.tokenizeRecovering`, which never fails.
Recovery is **in-tag**, not just opener-level: an unterminated tag keeps every
interior token it already lexed (so `{{ price * 2` still highlights the `*` and
`2`), and only a genuinely unparseable tail becomes an `Invalid` lexeme — emitted
with the ADR-017 `error` kind's `invalid` modifier — with lexing resyncing at the
next close or opener. (A malformed comment/raw fence still falls back to marking
its opener `Invalid`.)

**Diagnostics from the same pass.** Each `Invalid` token carries a message (the
reader's — "unterminated comment", "unexpected input in tag", …), and
`lsp.mjs:diagnostics(text)` turns them into the LSP `publishDiagnostics` shape
(0-based range + Error severity). So one recovering lex feeds *both* the
semantic-token and the diagnostic channels — the ADR-023 split (one recovering
parser, two LSP outputs). `node packages/lexer-lab/lsp.test.mjs` demos the
classification table, the wire `data`, the recovery, and the diagnostics.

## Parser (migration evaluation)

Two parser tracks over the hand lexer, both parity-checked against the engine:

- **`FlatBars.Lab.Parser`** (phase 1) — a *native* tree-builder over `LexToken`
  that produces the engine's `Syntax` AST directly. Each tag's interior is sliced
  from source and parsed by the engine's `tokenizeInterior` + `FlatBars.Expr`, so
  the `Expr` is exact and path reassembly (L3) is free. `ParserParity` asserts
  span-erased AST equality with `FlatBars.parse` on a 23-case corpus.
- **`FlatBars.Lab.RawTok`** (phases 2–3) — the migration-realistic path: adapt the
  hand lexer's tokens into the engine's `RawTok` stream (reproducing `~`
  whitespace control), then reuse the engine's `trimStandalone` + `buildFromTokens`
  unchanged. `RawTokParity` asserts `toRawToks src == tokenizeTemplate src`
  byte-for-byte across a broad corpus (`~`, raw blocks, short/long comments,
  nesting, escapes), plus an end-to-end `parse` vs `FlatBars.parse` check on
  standalone-whitespace templates (`{{#if}}/{{else}}`, indentation, comments).

### End-to-end parse benchmark

`bench.mjs` also times the full parse to the `Syntax` AST — incumbent
`FlatBars.parse` vs the migration path (hand lexer → RawTok adapter → the *same*
`trimStandalone` + `buildFromTokens`). Same AST out; this is the cost of the swap
(node v26, ~50 KiB profiles):

| profile | incumbent `FlatBars.parse` | lab (hand → RawTok → parser) |
| - | - | - |
| ocean | 35.0 MB/s | **39.1 MB/s** (0.90× time) |
| prose | 8.2 MB/s | **8.8 MB/s** (0.93× time) |
| dense | 1.3 MB/s | 0.8 MB/s (1.60× time) |

So end-to-end the migration path is **faster than the incumbent on realistic
input** (its faster lexer front more than pays for the adapter), and slower only
on the pathological all-tags corpus — where the hand lexer's finer stream (≈3.4×
more tokens) plus the adapter's re-walk cost more than the incumbent's coarse
single-pass `tokenizeTemplate`. The shared `buildFromTokens` dominates both.

The takeaway: **swap the lexer, keep the proven parser.** Because the RawTok
streams match exactly, standalone whitespace, header directives, raw blocks, and
recovering parse are all inherited for free.

### Dialect gates

The lab `LexConfig` now carries the lexer-level dialect knobs: `infixArith`
(MaxBars operators in the fine interior) and **`mustacheDelims`** (ADR-015).
With `mustacheDelims` off (FullBars/RawBars/MaxBars, the default), `{{=A B=}}`
is an ordinary separator; on (MinBars), all three lab lexers recognise it as a
set-delimiter, and the structural scanner additionally handles the reduced
custom-delimiter grammar that follows a switch (`<% … %>`, `[[ … ]]`). This
closes the one divergence the parity tests had found (the hand lexer used to
recognise set-delimiters unconditionally). `RawTokParity` checks both off (the
default corpus) and on (a `mustacheDelims`-true corpus). The remaining
parser-level gates (`extras`/`inheritance`/raw-block variants) are not lexer
concerns — they come from the engine `ParseOptions` the RawTok path reuses.

## Done in this iteration

- **Lab 2** — the hand-written lexer + a parity battery proving it equals the
  parsing spike; it is faster than the incumbent's full pipeline on every density
  profile (after a fused single-pass ocean scan: 21.5 → 39.9 MB/s on pure text).
- **Forgiveness + LSP** — `tokenizeRecovering` (in-tag recovery: keeps an
  unterminated tag's interior tokens, marks only the bad tail `Invalid`) and
  `lsp.mjs`, which feeds the hand lexer's tokens to LSP semantic tokens; a
  half-typed template still highlights. Also fixed a delimiter-persistence bug
  (a custom pair was dropped after one tag) caught by a two-custom-tag parity
  case.
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
2. ~~**P2** — error recovery~~ ✓ done (`tokenizeRecovering`, in-tag) + diagnostics
   (`Invalid` carries a message; `lsp.mjs:diagnostics` emits `publishDiagnostics`).
3. ~~Decide the bracket/path-segment model (L3)~~ ✓ done — segmented paths
   (`.`→`Dot`, `/`→`Slash`, brackets as tokens), both lexers, parity-checked.
4. If adopted, replace the coarse raw fences and add a `tokenize`-parity gate
   against `FlatBars.Lexer` (boundaries + literals), and lift line/column into a
   shared `Types` module so both spikes import one source of truth.
