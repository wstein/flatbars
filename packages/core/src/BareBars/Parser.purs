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
import BareBars.Syntax (Expr(..), Node(..), Template)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Either (Either(..))
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
parseSeq toks = go []
  where
  go :: Template -> Int -> Either ParseError SeqResult
  go acc i = case Array.index toks i of
    Nothing -> Right { nodes: acc, stop: StopEOF }
    Just t -> case t of
      RContent s -> go (Array.snoc acc (Content s)) (i + 1)
      ROutput tks -> do
        e <- parseExprTokens tks
        go (Array.snoc acc (Output e)) (i + 1)
      RRaw name argTks body -> do
        args <- parseArgTokens argTks
        go (Array.snoc acc (RawBlock name args body)) (i + 1)
      RClose name -> Right { nodes: acc, stop: StopClose name (i + 1) }
      ROpen name argTks -> buildBlock acc name argTks (i + 1)

  buildBlock :: Template -> String -> Array Token -> Int -> Either ParseError SeqResult
  buildBlock acc name argTks i = do
    args <- parseArgTokens argTks
    inner <- parseSeq toks i
    case inner.stop of
      StopEOF -> Left (MismatchedBlock name "<eof>" 0)
      StopClose closed pos
        | closed == name -> go (Array.snoc acc (Block name args inner.nodes)) pos
        | otherwise -> Left (MismatchedBlock name closed 0)

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
