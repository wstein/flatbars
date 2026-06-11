-- | **RawBars syntax-highlighting spans** — the highlighter twin of `RawBars.Lexer`
-- | / `RawBars.Parser` (ADR-041). Derives spans by running the *owned* RawBars lexer,
-- | so RawBars highlighting no longer routes through the shared `FlatBars.Highlight`.
-- | Reuses `FlatBars.Highlight`'s `HSpan`/`TSpan` record types (the single source of
-- | the span vocabulary) so the JS facade can dispatch rawbars here and keep one shape.
-- |
-- | The dialect seams are baked in (one frozen RawBars config): `extras = false` (so
-- | `{{&}}`/`{{^}}` colour `error`), `inheritance = false` (`{{<`/`{{$` → `error`),
-- | `rawBlockHash` on / `rawBlockHbs` off, the `else`/`elif`/`when` clause markers,
-- | statement tags on (a `{% set %}` head colours as a keyword). RawBars keeps the
-- | Handlebars `{{{ }}}` raw output and `{{! }}`/`{{!-- --}}` comments (it is the
-- | desugared-core surface, `bracesOutputOnly` off), so those colour `raw`/`comment`.
module RawBars.Highlight
  ( highlightSpans
  , tokenizeSpans
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.String.CodeUnits as SCU
import FlatBars.Highlight (HSpan, TSpan)
import FlatBars.Span (Span)
import FlatBars.Syntax (Sigil(..))
import FlatBars.Token (Interior, Token(..))
import RawBars.Lexer (RawTok(..), rawLexConfig, tokenizeTemplate)

-- | RawBars' clause-separator head names.
rawClauseSeps :: Array String
rawClauseSeps = [ "else", "elif", "when" ]

-- | The full token vocabulary (ADR-017): tag spans plus interior literal/operator
-- | spans, over the owned RawBars lexer (`keepLongComments` on so `{{!-- --}}` can be
-- | coloured). A lex error degrades to no spans (plain text).
tokenizeSpans :: String -> Array TSpan
tokenizeSpans src = case tokenizeTemplate (rawLexConfig true) src of
  Left _ -> []
  Right toks -> Array.concatMap spansOf toks
  where
  spansOf :: RawTok -> Array TSpan
  spansOf = case _ of
    RContent _ _ -> []
    ROutput sp _ _ int -> tag sp "raw" <> carveInterior int
    -- `{{&x}}` (unescaped output) is a Handlebars-extra RawBars rejects (`extras` off).
    RAmp sp _ _ _ -> tag sp "error"
    ROpen sp sig _ _ int -> openSpans sp sig int
    RClose sp _ _ int -> tag sp "block-close" <> carveInterior int
    RSep sp _ txt int
      | isPartialHead txt -> tag sp "partial"
      | Array.elem (headWord txt) rawClauseSeps -> tag sp "keyword" <> carveInterior int
      | headWord txt == "set" -> tag sp "keyword" <> carveInterior int
      | otherwise -> tag sp "expr" <> carveInterior int
    -- RawBars uses the FlatBars `{{{{#name}}}}` spelling (`rawBlockHash`); the bare
    -- Handlebars `{{{{name}}}}` is rejected → `error`.
    RRaw sp hash _ _ _ _
      | hash -> tag sp "raw-block"
      | otherwise -> tag sp "error"
    RComment sp _ _ -> tag sp "comment"
    RLongComment sp -> tag sp "comment"
    RSetDelim sp -> tag sp "set-delimiter"
    RError sp _ -> tag sp "unterminated"

  -- `{{#x}}` (Section) is core; `{{#>}}`/`{{#*}}` paint like a plain block opener.
  -- `{{^x}}` (Inverse) needs `extras`, `{{<`/`{{$` (Parent/BlockDef) need
  -- `inheritance` — both off for RawBars, so those shapes colour `error`.
  openSpans :: Span -> Sigil -> Interior -> Array TSpan
  openSpans sp sig int = case sig of
    Section -> tag sp "block-open" <> carveInterior int
    PartialBlock -> tag sp "block-open" <> carveInterior int
    Decorator -> tag sp "block-open" <> carveInterior int
    Inverse -> tag sp "error"
    Parent -> tag sp "error"
    BlockDef -> tag sp "error"

  carveInterior :: Interior -> Array TSpan
  carveInterior = case _ of
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

-- | The tag-role projection of `tokenizeSpans` — one colour per tag.
highlightSpans :: String -> Array HSpan
highlightSpans src = Array.mapMaybe tagOnly (tokenizeSpans src)
  where
  tagOnly :: TSpan -> Maybe HSpan
  tagOnly s
    | s.role == "tag" = Just { from: s.from, to: s.to, kind: s.kind }
    | otherwise = Nothing

isSpace :: Char -> Boolean
isSpace c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

trimmedChars :: String -> Array Char
trimmedChars = Array.dropWhile isSpace <<< SCU.toCharArray

isPartialHead :: String -> Boolean
isPartialHead s = Array.head (trimmedChars s) == Just '>'

headWord :: String -> String
headWord s = SCU.fromCharArray (Array.takeWhile (not <<< isSpace) (trimmedChars s))
