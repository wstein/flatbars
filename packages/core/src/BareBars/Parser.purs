-- | The syntactic grammar. See `docs/modules/ROOT/pages/grammar.adoc`.
-- |
-- | `parse` turns source text into a core `Template`. It runs the template
-- | tokenizer (`Lexer.tokenizeTemplate`), then builds the tree from the flat
-- | token stream, parsing each tag's expression tokens into `Expr`s.
module BareBars.Parser
  ( parse
  , parseExprTokens
  ) where

import Prelude

import BareBars.Error (ParseError(..))
import BareBars.Lexer (RawTok(..), Token(..), tokenizeTemplate)
import BareBars.Span (Span)
import BareBars.Syntax (Expr(..), Node(..), Template)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Either (Either(..))
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..))

parse :: String -> Either ParseError Template
parse src = do
  toks <- tokenizeTemplate src
  res <- parseSeq toks 0
  case res.stop of
    StopEOF -> Right res.nodes
    StopClose name _ -> Left (MismatchedBlock "<none>" name 0)

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
      ROutput span tks -> case parseExprTokens tks of
        Left e -> Left e
        Right e -> go (Output span e : acc) (i + 1)
      RRaw span name argTks body -> case parseArgTokens argTks of
        Left e -> Left e
        Right args -> go (RawBlock span name args body : acc) (i + 1)
      RSep span name argTks -> case parseArgTokens argTks of
        Left e -> Left e
        Right args -> go (Sep span name args : acc) (i + 1)
      RClose name -> Right (done acc (StopClose name (i + 1)))
      ROpen span name argTks -> buildBlock acc span name argTks (i + 1)

  buildBlock :: List Node -> Span -> String -> Array Token -> Int -> Either ParseError SeqResult
  buildBlock acc span name argTks i = case parseArgTokens argTks of
    Left e -> Left e
    Right args -> case parseSeq toks i of
      Left e -> Left e
      Right inner -> case inner.stop of
        -- point the diagnostic at the *opener* (its span start), not offset 0.
        StopEOF -> Left (MismatchedBlock name "<eof>" span.start)
        StopClose closed pos
          | closed == name -> go (Block span name args inner.nodes : acc) pos
          | otherwise -> Left (MismatchedBlock name closed span.start)

--------------------------------------------------------------------------------
-- Expression parsing over a token array
--------------------------------------------------------------------------------

type ExprResult = { expr :: Expr, pos :: Int }

-- | Parse the single `Expr` that fills an output tag. The whole interior may be
-- | a multi-argument application (`Ident Arg*` is one `Expr`).
parseExprTokens :: Array Token -> Either ParseError Expr
parseExprTokens tks = do
  res <- pExpr tks 0
  if res.pos == Array.length tks then Right res.expr
  else Left (HeadNotIdent 0)

-- | Parse the argument list that follows a block/raw head identifier; the whole
-- | token array must be consumed.
parseArgTokens :: Array Token -> Either ParseError (Array Expr)
parseArgTokens tks = do
  res <- pArgs tks 0 []
  if res.pos == Array.length tks then Right res.args
  else Left (HeadNotIdent 0)

type ArgsResult = { args :: Array Expr, pos :: Int }

pExpr :: Array Token -> Int -> Either ParseError ExprResult
pExpr tks pos = case Array.index tks pos of
  Just (TIdent name) -> do
    res <- pArgs tks (pos + 1) []
    Right { expr: App name res.args, pos: res.pos }
  Just (TString s) -> Right { expr: Lit (VString s), pos: pos + 1 }
  Just (TNumber n) -> Right { expr: Lit (VNumber n), pos: pos + 1 }
  Just TLParen -> do
    inner <- pExpr tks (pos + 1)
    case Array.index tks inner.pos of
      Just TRParen -> Right { expr: inner.expr, pos: inner.pos + 1 }
      _ -> Left (HeadNotIdent pos)
  Just TRParen -> Left (HeadNotIdent pos)
  Nothing -> Left (EmptyOutput pos)

pArgs :: Array Token -> Int -> Array Expr -> Either ParseError ArgsResult
pArgs tks pos acc = case Array.index tks pos of
  Nothing -> Right { args: acc, pos }
  Just TRParen -> Right { args: acc, pos } -- caller (a group) consumes the ')'
  Just (TString s) -> pArgs tks (pos + 1) (Array.snoc acc (Lit (VString s)))
  Just (TNumber n) -> pArgs tks (pos + 1) (Array.snoc acc (Lit (VNumber n)))
  Just (TIdent name) -> pArgs tks (pos + 1) (Array.snoc acc (App name [])) -- bare ident = nullary
  Just TLParen -> do
    grouped <- pExpr tks pos -- pExpr consumes the matching ')'
    pArgs tks grouped.pos (Array.snoc acc grouped.expr)
