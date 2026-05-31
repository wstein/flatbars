-- | The syntactic grammar. See `docs/modules/ROOT/pages/grammar.adoc`.
-- |
-- | `parse` turns source text into a core `Template`. It runs the template
-- | scanner (`Lexer.tokenizeTemplate`), then builds the tree from the flat token
-- | stream, parsing each tag's *interior* text into `Expr`s with `BareBars.Expr`
-- | (a `purescript-parsing` grammar). There is no separate expression token
-- | stream: a tag carries its interior text and the scanner's job ends at
-- | delimiting it.
module BareBars.Parser
  ( parse
  ) where

import Prelude

import BareBars.Error (ParseError(..))
import BareBars.Expr (parseExpr)
import BareBars.Lexer (RawTok(..), tokenizeTemplate)
import BareBars.Span (Span)
import BareBars.Syntax (Expr(..), Node(..), Template)
import Data.Array as Array
import Data.Either (Either(..))
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..))
import Data.String (trim)

parse :: String -> Either ParseError Template
parse src = do
  toks <- tokenizeTemplate src
  res <- parseSeq toks 0
  case res.stop of
    StopEOF -> Right res.nodes
    StopClose name _ -> Left (MismatchedBlock "<none>" name 0)

--------------------------------------------------------------------------------
-- Tag-interior expression parsing
--------------------------------------------------------------------------------

-- | The single `Expr` filling an output tag. A blank interior is `EmptyOutput`
-- | at the tag's offset (not the interior's), matching the diagnostics tests.
outputExpr :: Span -> Int -> String -> Either ParseError Expr
outputExpr span base s
  | trim s == "" = Left (EmptyOutput span.start)
  | otherwise = parseExpr base s

-- | A *headed* tag (`{{# name args}}`, `{{name args}}`, `{{/name}}`, raw): its
-- | interior is one application whose head names the helper/block/separator.
headed :: Span -> Int -> String -> Either ParseError { name :: String, args :: Array Expr }
headed span base s
  | trim s == "" = Left (HeadNotIdent span.start)
  | otherwise = case parseExpr base s of
      Left e -> Left e
      Right (App name args) -> Right { name, args }
      Right _ -> Left (HeadNotIdent span.start)

--------------------------------------------------------------------------------
-- Tree building over the flat RawTok stream
--------------------------------------------------------------------------------

data Stop
  = StopEOF
  | StopClose String Int -- closed name, index after {{/name}}

type SeqResult = { nodes :: Template, stop :: Stop }

-- | Parse a run of nodes starting at index `i`, stopping at end of input or at
-- | a close `{{/name}}`. A block captures a single body; multi-branch control
-- | flow is expressed as nested clause blocks the engine interprets.
parseSeq :: Array RawTok -> Int -> Either ParseError SeqResult
parseSeq toks = go Nil
  where
  -- Siblings accumulate in a *reversed* `List` (O(1) prepend); the finished
  -- run is reversed into an `Array` once. Building the `Template` with
  -- `Array.snoc` per node would be O(n²).
  done :: List Node -> Stop -> SeqResult
  done acc stop = { nodes: Array.fromFoldable (List.reverse acc), stop }

  -- The linear sibling scan. Every recursive `go` call is kept in *tail*
  -- position (explicit `case`, never `do`) so PureScript loops it — otherwise a
  -- bind-wrapped recursive call defeats the tail-call optimization for the whole
  -- function and a long node sequence overflows the stack. (Block *nesting* still
  -- recurses through `parseSeq`, but that depth is bounded by how deep blocks
  -- nest, not by sequence length.)
  go :: List Node -> Int -> Either ParseError SeqResult
  go acc i = case Array.index toks i of
    Nothing -> Right (done acc StopEOF)
    Just t -> case t of
      RContent s -> go (Content s : acc) (i + 1)
      ROutput span base s -> case outputExpr span base s of
        Left e -> Left e
        Right e -> go (Output span e : acc) (i + 1)
      RRaw span base s body -> case headed span base s of
        Left e -> Left e
        Right h -> go (RawBlock span h.name h.args body : acc) (i + 1)
      RSep span base s -> case headed span base s of
        Left e -> Left e
        Right h -> go (Sep span h.name h.args : acc) (i + 1)
      RClose _ base s -> case headed { start: base, end: base } base s of
        Left e -> Left e
        Right h -> Right (done acc (StopClose h.name (i + 1)))
      ROpen span base s -> buildBlock acc span base s (i + 1)

  buildBlock :: List Node -> Span -> Int -> String -> Int -> Either ParseError SeqResult
  buildBlock acc span base s i = case headed span base s of
    Left e -> Left e
    Right h -> case parseSeq toks i of
      Left e -> Left e
      Right inner -> case inner.stop of
        -- point the diagnostic at the *opener* (its span start), not offset 0.
        StopEOF -> Left (MismatchedBlock h.name "<eof>" span.start)
        StopClose closed pos
          | closed == h.name -> go (Block span h.name h.args inner.nodes : acc) pos
          | otherwise -> Left (MismatchedBlock h.name closed span.start)
