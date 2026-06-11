-- | **MaxBars syntax-highlighting spans** — the highlighter twin of `MaxBars.Lexer`
-- | / `MaxBars.Parser` (ADR-041). It derives spans by running the *owned* MaxBars
-- | lexer (`MaxBars.Lexer.tokenize`), so MaxBars highlighting no longer routes
-- | through the shared `FlatBars.Highlight` / `FlatBars.Lexer` at all — the last
-- | shared-front-end tie is gone.
-- |
-- | Same two views and the same `HSpan`/`TSpan` vocabulary as `FlatBars.Highlight`
-- | (reused as the single source of those record types), so the JS facade can
-- | dispatch maxbars here and keep one output shape:
-- |
-- | * `highlightSpans` — the tag-role projection (one whole-tag span per tag).
-- | * `tokenizeSpans` — tag spans plus the interior literal/operator sub-spans.
-- |
-- | The dialect seams the shared highlighter took as a `HighlightConfig` are **baked
-- | in** (there is one frozen MaxBars config): `extras = false` (so `{{&}}`/`{{^}}`
-- | colour `error`), `inheritance = false` (`{{<`/`{{$` → `error`), `rawBlockHash`
-- | on / `rawBlockHbs` off, the `else`/`elif`/`when` clause markers, and statement
-- | tags on (so a `{% set %}` head colours as a keyword). Output-only `{{ }}`
-- | (`bracesOutputOnly`) and the `{# … #}` comment form come from the lexer itself.
module MaxBars.Highlight
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
import MaxBars.Lexer (RawTok(..), tokenize)

-- | MaxBars' clause-separator head names: a `{{else}}` / `{{elif …}}` / `{{when …}}`
-- | bare tag colours as a `keyword`, the rest as a plain `expr` interpolation.
maxClauseSeps :: Array String
maxClauseSeps = [ "else", "elif", "when" ]

-- | The full token vocabulary (ADR-017): tag spans plus interior literal/operator
-- | spans, over the owned MaxBars lexer. A lex error degrades to no spans (plain
-- | text) rather than guessing where the engine would have stopped.
tokenizeSpans :: String -> Array TSpan
tokenizeSpans src = case tokenize src of
  Left _ -> []
  Right toks -> Array.concatMap spansOf toks
  where
  spansOf :: RawTok -> Array TSpan
  spansOf = case _ of
    RContent _ _ -> []
    -- `{{&x}}` (unescaped output) is a Handlebars-extra MaxBars rejects (`extras`
    -- off) — coloured `error`, exactly as `MaxBars.Parser` rejects it.
    RAmp sp _ _ _ -> tag sp "error"
    ROpen sp sig _ _ int -> openSpans sp sig int
    RClose sp _ _ int -> tag sp "block-close" <> carveInterior int
    -- A bare tag: a `>`-headed partial, a clause keyword (`else`/`elif`/`when`), the
    -- statement-tag binding `{% set … %}`, or a plain interpolation. The head word
    -- lexes as an identifier (no interior span), so carving the rest is safe.
    RSep sp _ txt int
      | isPartialHead txt -> tag sp "partial"
      | Array.elem (headWord txt) maxClauseSeps -> tag sp "keyword" <> carveInterior int
      | headWord txt == "set" -> tag sp "keyword" <> carveInterior int
      | otherwise -> tag sp "expr" <> carveInterior int
    -- MaxBars uses the FlatBars `{{{{#name}}}}` raw-block spelling (`rawBlockHash`);
    -- the bare Handlebars `{{{{name}}}}` is rejected → `error`.
    RRaw sp hash _ _ _ _
      | hash -> tag sp "raw-block"
      | otherwise -> tag sp "error"
    RComment sp _ _ -> tag sp "comment"
    -- An unterminated construct (recovering lexer): paint the orphan region as the
    -- `unterminated` kind so a half-typed tag shows an error instead of dropping all
    -- highlighting. (`{{{ … }}}` raw output is one of these — `bracesOutputOnly`.)
    RError sp _ -> tag sp "unterminated"

  -- Block openers. `{{#x}}` (Section) is core; the `{{#>}}`/`{{#*}}` openers paint
  -- like a plain block opener (the `>`/`*` is part of the opener tag span). `{{^x}}`
  -- (Inverse) needs `extras`, `{{<`/`{{$` (Parent/BlockDef) need `inheritance` —
  -- both off for MaxBars, so those shapes colour `error`.
  openSpans :: Span -> Sigil -> Interior -> Array TSpan
  openSpans sp sig int = case sig of
    Section -> tag sp "block-open" <> carveInterior int
    PartialBlock -> tag sp "block-open" <> carveInterior int
    Decorator -> tag sp "block-open" <> carveInterior int
    Inverse -> tag sp "error"
    Parent -> tag sp "error"
    BlockDef -> tag sp "error"

  -- The interior-role spans: from the *pre-lexed* interior, carve only the literals
  -- and operators. Identifiers, paths, and parens carry no colour of their own.
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

-- | The tag-role projection of `tokenizeSpans` — one colour per tag, by the meaning
-- | of its head. The view the Lab and tutorials paint.
highlightSpans :: String -> Array HSpan
highlightSpans src = Array.mapMaybe tagOnly (tokenizeSpans src)
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
