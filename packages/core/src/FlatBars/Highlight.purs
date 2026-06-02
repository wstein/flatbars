-- | Syntax-highlighting spans, derived from the engine lexer (ADR-014).
-- |
-- | This is the one tokenizer for displaying FlatBars template syntax. Rather
-- | than fork the grammar into a per-front-end regex (the drift ADR-014 records),
-- | front-ends call `highlightSpans` and render the returned spans in their own
-- | idiom (a CodeMirror `ViewPlugin` in the Lab, an overlay in the tutorials).
-- |
-- | The function is a thin map over `FlatBars.Lexer.tokenizeTemplate`: each
-- | `RawTok` becomes exactly one whole-tag `HSpan` tagged by its structural role,
-- | and content runs produce nothing (they stay default text). The two dialect
-- | seams the lexer already exposes are threaded straight through — `LexConfig`
-- | (delimiters + `mustacheDelims` for set delimiters) and the clause-separator
-- | names (`{{else}}` / `{{elif …}}`) — so highlighting is per-dialect *by
-- | construction*, with no highlighter-side knowledge of any dialect. This is the
-- | same IoC seam the parser uses: the highlighter drives, the dialect supplies
-- | the meaning.
-- |
-- | Interior token kinds (operators vs paths *within* a MaxBars tag) are not
-- | emitted yet: `FlatBars.Token.PosToken` records only a token start, so an exact
-- | end offset isn't recoverable. Whole-tag colouring is correct in the interim;
-- | see `highlighting-spec.md` §10.
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
-- | a stable `kind` tag the presenter maps to a CSS class. See the `kindOf`
-- | clauses below for the full vocabulary.
type HSpan = { from :: Int, to :: Int, kind :: String }

-- | The two dialect seams the highlighter needs — the same ones the parser
-- | threads. `lexConfig` is the template scanner's delimiter config (including
-- | `mustacheDelims` for the `{{=A B=}}` set-delimiter tag); `clauseSeps` is the
-- | dialect's clause-separator names, so `{{else}}` / `{{elif …}}` are coloured
-- | as statements only where the dialect treats them as separators (empty for
-- | MinBars, where `else` is an ordinary variable).
type HighlightConfig =
  { lexConfig :: LexConfig
  , clauseSeps :: Array String
  }

-- | Tokenize template source into positioned highlight spans. Every tag yields
-- | one whole-tag span tagged by its role; content runs yield nothing. A lex
-- | error degrades to no spans (plain text) rather than guessing where the
-- | engine would have stopped — the highlighter never disagrees with the lexer.
highlightSpans :: HighlightConfig -> String -> Array HSpan
highlightSpans cfg src = case tokenizeTemplate cfg.lexConfig src of
  Left _ -> []
  Right toks -> Array.mapMaybe spanOf toks
  where
  spanOf :: RawTok -> Maybe HSpan
  spanOf = case _ of
    RContent _ -> Nothing
    ROutput sp _ _ -> at sp "raw"
    RAmp sp _ _ -> at sp "raw"
    ROpen sp sig _ _ -> at sp (sigilKind sig)
    RClose sp _ _ -> at sp "block-close"
    RSep sp _ interior -> at sp (sepKind interior)
    RRaw sp _ _ _ -> at sp "raw-block"
    RComment sp _ _ -> at sp "comment"
    RSetDelim sp -> at sp "set-delimiter"

  at :: Span -> String -> Maybe HSpan
  at sp kind = Just { from: sp.start, to: sp.end, kind }

  -- A bare `{{ … }}`: a partial (`>` head), a dialect clause keyword
  -- (`{{else}}` / `{{elif …}}`, when its head is one the dialect treats as a
  -- separator — the same `clauseSeps` the standalone-whitespace pass consults),
  -- or a plain interpolation. Order matters: a partial head is never a clause.
  sepKind :: String -> String
  sepKind interior
    | isPartialHead interior = "partial"
    | Array.elem (headWord interior) cfg.clauseSeps = "keyword"
    | otherwise = "expr"

sigilKind :: Sigil -> String
sigilKind = case _ of
  Section -> "block-open"
  Inverse -> "block-inverse"
  Parent -> "block-parent"
  BlockDef -> "block-decl"

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
