-- | Syntax-highlighting spans, derived from the engine lexer (ADR-014, ADR-017).
-- |
-- | This is the one tokenizer for displaying FlatBars template syntax. Rather
-- | than fork the grammar into a per-front-end regex (the drift ADR-014 records),
-- | consumers call into this module and render the returned spans in their own
-- | idiom (a CodeMirror `ViewPlugin` in the Lab, an overlay in the tutorials, LSP
-- | semantic tokens in `flatbars-lsp`).
-- |
-- | There are two views over the same single pass, distinguished by a span's
-- | `role` (ADR-017's *tag-role × interior-role* token vocabulary):
-- |
-- | * `highlightSpans` — the *tag-role* projection (ADR-014). A `RawTok` becomes
-- |   one whole-tag span tagged by its structural role — the meaning of its head
-- |   (interpolation, block, partial, comment, …). The whole tag reads in that one
-- |   colour. This is what the Lab and the tutorials paint: an interior literal
-- |   carries no meaning of its own beyond "an argument to this tag", so a second
-- |   colour there competes with the tag's role rather than clarifying it.
-- | * `tokenizeSpans` — the full *tag-role + interior-role* token stream. On top of
-- |   the tag spans it carves the interior literals and operators (`string`,
-- |   `number`, `operator`) into their own sub-spans, recovered from the lexer's
-- |   per-token `end` offsets (`FlatBars.Token.PosToken`). This is the richer,
-- |   opt-in vocabulary the editor layer (LSP / TextMate) consumes; ADR-014
-- |   deliberately keeps it *out* of our in-process front-ends.
-- |
-- | The dialect seams the lexer already exposes are threaded straight through —
-- | `LexConfig` (delimiters + set delimiters), the clause-separator names, and the
-- | interior `LexOptions` (so MaxBars operators tokenize as operators while in
-- | RawBars/FullBars the same characters stay path punctuation) — so both views are
-- | per-dialect *by construction*, with no highlighter-side knowledge of any
-- | dialect. This is the same IoC seam the parser uses: the highlighter drives, the
-- | dialect supplies the meaning.
-- |
-- | Tag spans are non-overlapping and in source order, so an overlay presenter can
-- | walk `highlightSpans` linearly (and a CodeMirror `Decoration.set` accepts them
-- | directly). In `tokenizeSpans` an interior span is nested *inside* its tag span
-- | (the layered vocabulary view); a consumer that needs a flat, non-overlapping
-- | tiling — LSP semantic tokens — splits the tag run around its interior spans.
module FlatBars.Highlight
  ( HSpan
  , TSpan
  , HighlightConfig
  , highlightSpans
  , tokenizeSpans
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.String.CodeUnits as SCU
import FlatBars.Lexer (LexConfig, RawTok(..), tokenizeTemplate)
import FlatBars.Span (Span)
import FlatBars.Syntax (Sigil(..))
import FlatBars.Token (LexOptions, Token(..), tokenizeInterior)

-- | A positioned highlight span: UTF-16 offsets `[from, to)` into the source and
-- | a stable `kind` tag the presenter maps to a CSS class. Every span is one
-- | whole tag, coloured by its head role: `expr`, `raw`, `raw-block`,
-- | `block-open`, `block-inverse`, `block-parent`, `block-decl`, `block-close`,
-- | `partial`, `keyword`, `comment`, `set-delimiter`. The `error` kind marks a
-- | structurally-valid tag the *dialect disallows* (an `extras`/`inheritance`-gated
-- | shape — see `HighlightConfig`), so a presenter can flag it the way it would a
-- | lex error.
type HSpan = { from :: Int, to :: Int, kind :: String }

-- | A token-vocabulary span (ADR-017). `from`/`to`/`kind` as `HSpan`, plus a
-- | `role`: `"tag"` for the whole-tag spans `highlightSpans` returns, or
-- | `"interior"` for an interior literal/operator carved inside a tag. The
-- | interior `kind`s are `string`, `number`, and `operator`; the tag `kind`s are
-- | the `HSpan` set above. `highlightSpans` is exactly `tokenizeSpans` filtered to
-- | `role == "tag"`, so the two views share one lexer pass and cannot disagree.
type TSpan = { from :: Int, to :: Int, kind :: String, role :: String }

-- | The dialect seams the highlighter needs — the same ones the parser threads.
-- | `lexConfig` is the template scanner's delimiter config (including
-- | `mustacheDelims` for the `{{=A B=}}` set-delimiter tag); `clauseSeps` is the
-- | dialect's clause-separator names, so `{{else}}` / `{{elif …}}` are coloured as
-- | statements only where the dialect treats them as separators (empty for
-- | MinBars, where `else` is a variable); `lexOptions` is the *interior* lexer's
-- | dialect seam (`infixArith` for MaxBars), so `+`/`-`/`*`/`/` tokenize as
-- | operators in MaxBars and stay path punctuation elsewhere.
-- |
-- | `extras` and `inheritance` are the parser's own dialect gates (the same
-- | fields `ParseOptions` carries): when off, the structurally-valid shapes the
-- | dialect *rejects* are coloured `error` rather than painted as valid. With
-- | `extras = false` (RawBars/MaxBars) that is `{{&x}}` (unescaped), `{{^x}}`
-- | (inverse), and `{{{{…}}}}` (raw block); with `inheritance = false`
-- | (RawBars/MaxBars/FullBars) it is `{{<x}}` / `{{$x}}`. So the highlighter never
-- | paints a shape valid that the same dialect would reject at parse.
type HighlightConfig =
  { lexConfig :: LexConfig
  , clauseSeps :: Array String
  , lexOptions :: LexOptions
  , extras :: Boolean
  , inheritance :: Boolean
  }

-- | The full token vocabulary (ADR-017): tag spans plus interior literal/operator
-- | spans. A lex error degrades to no spans (plain text) rather than guessing
-- | where the engine would have stopped — the highlighter never disagrees with the
-- | lexer.
tokenizeSpans :: HighlightConfig -> String -> Array TSpan
tokenizeSpans cfg src = case tokenizeTemplate cfg.lexConfig src of
  Left _ -> []
  Right toks -> Array.concatMap spansOf toks
  where
  spansOf :: RawTok -> Array TSpan
  spansOf = case _ of
    RContent _ -> []
    ROutput sp base txt -> tag sp "raw" <> interior base txt
    -- `{{&x}}` (unescaped) is a Handlebars-extra: disallowed when `extras` is off
    -- (RawBars/MaxBars), exactly as the parser gates it.
    RAmp sp base txt
      | cfg.extras -> tag sp "raw" <> interior base txt
      | otherwise -> tag sp "error"
    ROpen sp sig base txt -> openSpans sp sig base txt
    RClose sp base txt -> tag sp "block-close" <> interior base txt
    -- The interior's head word distinguishes a partial and a clause keyword from a
    -- plain interpolation. A partial's leading `>` is the tag's meaning, not an
    -- operator, so its interior is not carved; a keyword's head word lexes as an
    -- identifier (no interior span), so carving the rest (e.g. `elif x > 0`) is safe.
    RSep sp base txt
      | isPartialHead txt -> tag sp "partial"
      | Array.elem (headWord txt) cfg.clauseSeps -> tag sp "keyword" <> interior base txt
      | otherwise -> tag sp "expr" <> interior base txt
    -- `{{{{…}}}}` raw blocks are a Handlebars-extra: disallowed when `extras` is off.
    RRaw sp _ _ _
      | cfg.extras -> tag sp "raw-block"
      | otherwise -> tag sp "error"
    RComment sp _ _ -> tag sp "comment"
    RLongComment sp -> tag sp "comment"
    RSetDelim sp -> tag sp "set-delimiter"

  -- Block openers, gated like the parser: `{{#x}}` (Section) is always core;
  -- `{{^x}}` (Inverse) needs `extras`; `{{<x}}` (Parent) / `{{$x}}` (BlockDef)
  -- need `inheritance`. A disallowed opener is coloured `error` and its interior is
  -- not carved (the whole tag reads as the error).
  openSpans :: Span -> Sigil -> Int -> String -> Array TSpan
  openSpans sp sig base txt = case sig of
    Section -> tag sp "block-open" <> interior base txt
    -- the partial-block `{{#>}}` and inline-decorator `{{#*}}` openers carve like a
    -- plain block opener (the `>`/`*` is part of the opener tag span, not interior).
    PartialBlock -> tag sp "block-open" <> interior base txt
    Decorator -> tag sp "block-open" <> interior base txt
    Inverse
      | cfg.extras -> tag sp "block-inverse" <> interior base txt
      | otherwise -> tag sp "error"
    Parent
      | cfg.inheritance -> tag sp "block-parent" <> interior base txt
      | otherwise -> tag sp "error"
    BlockDef
      | cfg.inheritance -> tag sp "block-decl" <> interior base txt
      | otherwise -> tag sp "error"

  -- The interior-role spans: re-lex the tag interior (with the dialect's
  -- `LexOptions`) and carve only the literals and operators. Identifiers, paths,
  -- and parens carry no colour of their own — they stay the tag's colour. A lex
  -- error inside the interior yields no interior spans (the tag span still stands).
  interior :: Int -> String -> Array TSpan
  interior base txt = case tokenizeInterior cfg.lexOptions base txt of
    Left _ -> []
    Right toks -> Array.mapMaybe interiorSpan toks

  interiorSpan :: { tok :: Token, at :: Int, end :: Int } -> Maybe TSpan
  interiorSpan pt = case pt.tok of
    TStr _ -> Just (carve pt "string")
    TNum _ -> Just (carve pt "number")
    TOp _ -> Just (carve pt "operator")
    _ -> Nothing

  carve :: { tok :: Token, at :: Int, end :: Int } -> String -> TSpan
  carve pt kind = { from: pt.at, to: pt.end, kind, role: "interior" }

  tag :: Span -> String -> Array TSpan
  tag sp kind = [ { from: sp.start, to: sp.end, kind, role: "tag" } ]

-- | Tokenize template source into positioned whole-tag highlight spans — the
-- | tag-role projection of `tokenizeSpans` (ADR-014). This is the view the Lab and
-- | the tutorials paint: one colour per tag, by the meaning of its head.
highlightSpans :: HighlightConfig -> String -> Array HSpan
highlightSpans cfg src = Array.mapMaybe tagOnly (tokenizeSpans cfg src)
  where
  tagOnly :: TSpan -> Maybe HSpan
  tagOnly s
    | s.role == "tag" = Just { from: s.from, to: s.to, kind: s.kind }
    | otherwise = Nothing

isSpace :: Char -> Boolean
isSpace c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

-- | The interior with leading whitespace dropped, as a char array.
trimmedChars :: String -> Array Char
trimmedChars = Array.dropWhile isSpace <<< SCU.toCharArray

isPartialHead :: String -> Boolean
isPartialHead s = Array.head (trimmedChars s) == Just '>'

-- | The leading whitespace-delimited word of an interior (mirrors the lexer's own
-- | `sepHead`): `"else"` from `{{else}}`, `"elif"` from `{{elif (gt x 0)}}`.
headWord :: String -> String
headWord s = SCU.fromCharArray (Array.takeWhile (not <<< isSpace) (trimmedChars s))
