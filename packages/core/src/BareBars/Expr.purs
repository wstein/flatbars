-- | The core/prefix expression grammar, as a parser over the interior **token
-- | stream** (`BareBars.Token`). `Expr ::= "(" Expr ")" | Lit | Ident Arg*` — an
-- | application is an identifier head followed by atom arguments; a group is a
-- | parenthesised expression; a literal is a string or number. Operators
-- | (`TOp`) are *not* part of this grammar, so `{{ a && b }}` is a parse error
-- | here — only MaxBars accepts them. Shared by RawBars and FullBars (it is the
-- | default `ParseOptions.parseExpr`); MaxBars supplies its own infix grammar.
module BareBars.Expr
  ( parseExpr
  ) where

import Prelude

import BareBars.Error (ParseError(..))
import BareBars.Syntax (Expr(..))
import BareBars.Token (PosToken, Token(..))
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))

type Step a = { val :: a, pos :: Int }

-- | Parse a tag interior's tokens into one `Expr`, consuming all of them.
parseExpr :: Array PosToken -> Either ParseError Expr
parseExpr toks = case pExpr 0 of
  Left e -> Left e
  Right { val, pos }
    | pos >= len -> Right val
    | otherwise -> Left (LexError "unexpected token" (posAt pos))
  where
  len = Array.length toks
  tk i = _.tok <$> Array.index toks i
  posAt i = case Array.index toks i of
    Just pt -> pt.at
    Nothing -> case Array.last toks of
      Just pt -> pt.at
      Nothing -> 0

  -- a full expression: a group, a literal, or an application.
  pExpr :: Int -> Either ParseError (Step Expr)
  pExpr i = case tk i of
    Just TLParen -> do
      { val, pos } <- pExpr (i + 1)
      case tk pos of
        Just TRParen -> Right { val, pos: pos + 1 }
        _ -> Left (LexError "expected )" (posAt pos))
    Just (TStr s) -> Right { val: Lit (VString s), pos: i + 1 }
    Just (TNum n) -> Right { val: Lit (VNumber n), pos: i + 1 }
    Just (TIdent name) -> do
      { val: args, pos } <- pArgs (i + 1) []
      Right { val: App name args, pos }
    _ -> Left (LexError "expected an expression" (posAt i))

  -- arguments in application position: atoms (group / literal / nullary ident)
  -- until a token that cannot start an argument. A bare `|` is the block-param
  -- bar of an `as |a b|` clause: this grammar carries it through as a nullary
  -- `|` "ident" (meaning-free); the dialect surface strips the bars and reads
  -- the binding names. No other operator is an argument here.
  pArgs :: Int -> Array Expr -> Either ParseError (Step (Array Expr))
  pArgs i acc = case tk i of
    Just TLParen -> do
      { val, pos } <- pExpr i
      pArgs pos (Array.snoc acc val)
    Just (TStr s) -> pArgs (i + 1) (Array.snoc acc (Lit (VString s)))
    Just (TNum n) -> pArgs (i + 1) (Array.snoc acc (Lit (VNumber n)))
    Just (TIdent name) -> pArgs (i + 1) (Array.snoc acc (App name []))
    Just (TOp "|") -> pArgs (i + 1) (Array.snoc acc (App "|" []))
    _ -> Right { val: acc, pos: i }
