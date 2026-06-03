-- | Syntax-highlighting spans, derived from the engine lexer (ADR-014).
-- |
-- | This is the one tokenizer for displaying FlatBars template syntax. Rather
-- | than fork the grammar into a per-front-end regex (the drift ADR-014 records),
-- | front-ends call `highlightSpans` and render the returned spans in their own
-- | idiom (a CodeMirror `ViewPlugin` in the Lab, an overlay in the tutorials).
-- |
-- | A `RawTok` becomes one whole-tag span tagged by its structural role — the
-- | meaning of its head (interpolation, block, partial, comment, …). The whole
-- | tag reads in that one colour: an interior literal or operator carries no
-- | meaning of its own to colour, so it stays the tag's colour rather than
-- | competing with the role. Content runs produce nothing (they stay default
-- | text). The dialect seams the lexer already exposes are threaded straight
-- | through — `LexConfig` (delimiters + set delimiters) and the clause-separator
-- | names — so highlighting is per-dialect *by construction*, with no
-- | highlighter-side knowledge of any dialect. This is the same IoC seam the
-- | parser uses: the highlighter drives, the dialect supplies the meaning.
-- |
-- | Spans are non-overlapping and in source order, so an overlay presenter can
-- | walk them linearly (and a CodeMirror `Decoration.set` accepts them directly).
module FlatBars.Highlight
  ( HSpan
  , HighlightConfig
  , highlightSpans
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.String.CodeUnits as SCU
import FlatBars.Lexer (LexConfig, RawTok(..), tokenizeTemplate)
import FlatBars.Span (Span)
import FlatBars.Syntax (Sigil(..))

-- | A positioned highlight span: UTF-16 offsets `[from, to)` into the source and
-- | a stable `kind` tag the presenter maps to a CSS class. Every span is one
-- | whole tag, coloured by its head role: `expr`, `raw`, `raw-block`,
-- | `block-open`, `block-inverse`, `block-parent`, `block-decl`, `block-close`,
-- | `partial`, `keyword`, `comment`, `set-delimiter`. The `error` kind marks a
-- | structurally-valid tag the *dialect disallows* (an `extras`/`inheritance`-gated
-- | shape — see `HighlightConfig`), so a presenter can flag it the way it would a
-- | lex error.
type HSpan = { from :: Int, to :: Int, kind :: String }

-- | The dialect seams the highlighter needs — the same ones the parser threads.
-- | `lexConfig` is the template scanner's delimiter config (including
-- | `mustacheDelims` for the `{{=A B=}}` set-delimiter tag); `clauseSeps` is the
-- | dialect's clause-separator names, so `{{else}}` / `{{elif …}}` are coloured as
-- | statements only where the dialect treats them as separators (empty for
-- | MinBars, where `else` is a variable).
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
  , extras :: Boolean
  , inheritance :: Boolean
  }

-- | Tokenize template source into positioned highlight spans. A lex error
-- | degrades to no spans (plain text) rather than guessing where the engine would
-- | have stopped — the highlighter never disagrees with the lexer.
highlightSpans :: HighlightConfig -> String -> Array HSpan
highlightSpans cfg src = case tokenizeTemplate cfg.lexConfig src of
  Left _ -> []
  Right toks -> Array.concatMap spanOf toks
  where
  spanOf :: RawTok -> Array HSpan
  spanOf = case _ of
    RContent _ -> []
    ROutput sp _ _ -> [ whole sp "raw" ]
    -- `{{&x}}` (unescaped) is a Handlebars-extra: disallowed when `extras` is off
    -- (RawBars/MaxBars), exactly as the parser gates it.
    RAmp sp _ _
      | cfg.extras -> [ whole sp "raw" ]
      | otherwise -> [ whole sp "error" ]
    ROpen sp sig _ _ -> openSpans sp sig
    RClose sp _ _ -> [ whole sp "block-close" ]
    -- The interior is read only as TEXT here (its head word), to tell a partial
    -- and a clause keyword from a plain interpolation — never re-tokenized for
    -- colour: the whole tag is one span of its head role.
    RSep sp _ interior
      | isPartialHead interior -> [ whole sp "partial" ]
      | Array.elem (headWord interior) cfg.clauseSeps -> [ whole sp "keyword" ]
      | otherwise -> [ whole sp "expr" ]
    -- `{{{{…}}}}` raw blocks are a Handlebars-extra: disallowed when `extras` is off.
    RRaw sp _ _ _
      | cfg.extras -> [ whole sp "raw-block" ]
      | otherwise -> [ whole sp "error" ]
    RComment sp _ _ -> [ whole sp "comment" ]
    RLongComment sp -> [ whole sp "comment" ]
    RSetDelim sp -> [ whole sp "set-delimiter" ]

  -- Block openers, gated like the parser: `{{#x}}` (Section) is always core;
  -- `{{^x}}` (Inverse) needs `extras`; `{{<x}}` (Parent) / `{{$x}}` (BlockDef)
  -- need `inheritance`. A disallowed opener is coloured `error`.
  openSpans :: Span -> Sigil -> Array HSpan
  openSpans sp sig = case sig of
    Section -> [ whole sp "block-open" ]
    Inverse
      | cfg.extras -> [ whole sp "block-inverse" ]
      | otherwise -> [ whole sp "error" ]
    Parent
      | cfg.inheritance -> [ whole sp "block-parent" ]
      | otherwise -> [ whole sp "error" ]
    BlockDef
      | cfg.inheritance -> [ whole sp "block-decl" ]
      | otherwise -> [ whole sp "error" ]

  whole :: Span -> String -> HSpan
  whole sp kind = { from: sp.start, to: sp.end, kind }

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
