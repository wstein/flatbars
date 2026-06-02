-- | Syntax-highlighting spans, derived from the engine lexer (ADR-014).
-- |
-- | This is the one tokenizer for displaying FlatBars template syntax. Rather
-- | than fork the grammar into a per-front-end regex (the drift ADR-014 records),
-- | front-ends call `highlightSpans` and render the returned spans in their own
-- | idiom (a CodeMirror `ViewPlugin` in the Lab, an overlay in the tutorials).
-- |
-- | A `RawTok` becomes one whole-tag span tagged by its structural role, *tiled*
-- | with its interior tokens: operators, strings and numbers inside a tag get
-- | their own span (so MaxBars `a + b` shows the `+`, and string/number literals
-- | read distinctly), while identifiers, parens, delimiters and whitespace stay
-- | the tag's colour — a simple `{{name}}` is still one solid chunk. Content runs
-- | produce nothing (they stay default text). The dialect seams the lexer already
-- | exposes are threaded straight through — `LexConfig` (delimiters + set
-- | delimiters), `LexOptions` (`infixArith`, so MaxBars operators tokenize), and
-- | the clause-separator names — so highlighting is per-dialect *by construction*,
-- | with no highlighter-side knowledge of any dialect. This is the same IoC seam
-- | the parser uses: the highlighter drives, the dialect supplies the meaning.
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
import FlatBars.Token (LexOptions, PosToken, Token(..), tokenizeInterior)

-- | A positioned highlight span: UTF-16 offsets `[from, to)` into the source and
-- | a stable `kind` tag the presenter maps to a CSS class. Tag-role kinds:
-- | `expr`, `raw`, `raw-block`, `block-open`, `block-inverse`, `block-parent`,
-- | `block-decl`, `block-close`, `partial`, `keyword`, `comment`,
-- | `set-delimiter`. Interior-role kinds: `operator`, `string`, `number`.
type HSpan = { from :: Int, to :: Int, kind :: String }

-- | The dialect seams the highlighter needs — the same ones the parser threads.
-- | `lexConfig` is the template scanner's delimiter config (including
-- | `mustacheDelims` for the `{{=A B=}}` set-delimiter tag); `lexOptions` is the
-- | interior tokenizer config (`infixArith`, so MaxBars `+ - * / % ??` tokenize
-- | as operators); `clauseSeps` is the dialect's clause-separator names, so
-- | `{{else}}` / `{{elif …}}` are coloured as statements only where the dialect
-- | treats them as separators (empty for MinBars, where `else` is a variable).
type HighlightConfig =
  { lexConfig :: LexConfig
  , lexOptions :: LexOptions
  , clauseSeps :: Array String
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
    ROutput sp base interior -> tagSpans sp base interior "raw"
    RAmp sp base interior -> tagSpans sp base interior "raw"
    ROpen sp sig base interior -> tagSpans sp base interior (sigilKind sig)
    RClose sp base interior -> tagSpans sp base interior "block-close"
    RSep sp base interior
      | isPartialHead interior -> [ whole sp "partial" ]
      | Array.elem (headWord interior) cfg.clauseSeps -> tagSpans sp base interior "keyword"
      | otherwise -> tagSpans sp base interior "expr"
    -- Raw blocks carry a literal body (not an expression); comments and the
    -- set-delimiter tag have no expression interior — all stay one whole-tag span.
    RRaw sp _ _ _ -> [ whole sp "raw-block" ]
    RComment sp _ _ -> [ whole sp "comment" ]
    RLongComment sp -> [ whole sp "comment" ]
    RSetDelim sp -> [ whole sp "set-delimiter" ]

  whole :: Span -> String -> HSpan
  whole sp kind = { from: sp.start, to: sp.end, kind }

  -- Tile the tag `[sp.start, sp.end)` with `headKind`, punching interior
  -- operator/string/number tokens with their own kind. If the interior does not
  -- lex (a half-typed tag), keep the whole chunk rather than guessing.
  tagSpans :: Span -> Int -> String -> String -> Array HSpan
  tagSpans sp base interior headKind = case tokenizeInterior cfg.lexOptions base interior of
    Left _ -> [ whole sp headKind ]
    Right toks -> tile sp.start sp.end headKind (Array.mapMaybe notable toks)

-- | The interior tokens that get their own span; everything else (identifiers,
-- | parens, delimiters, whitespace) stays the tag's head colour.
notable :: PosToken -> Maybe HSpan
notable t = case t.tok of
  TOp _ -> punch "operator"
  TStr _ -> punch "string"
  TNum _ -> punch "number"
  _ -> Nothing
  where
  punch kind = Just { from: t.at, to: t.end, kind }

-- | Fill `[start, end)` with `headKind`, emitting each `punch` span in place
-- | (the punches are within the range and already in source order). The head
-- | fills the gaps, so the result tiles the range with no overlap.
tile :: Int -> Int -> String -> Array HSpan -> Array HSpan
tile start end headKind punches =
  let
    step st p =
      { pos: p.to
      , acc: Array.snoc (gap st.pos p.from st.acc) p
      }
    filled = Array.foldl step { pos: start, acc: [] } punches
  in
    gap filled.pos end filled.acc
  where
  gap a b acc
    | b > a = Array.snoc acc { from: a, to: b, kind: headKind }
    | otherwise = acc

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
