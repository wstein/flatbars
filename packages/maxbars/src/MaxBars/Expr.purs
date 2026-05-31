-- | The **MaxBars** interior grammar: the prefix term language plus *infix
-- | operators* and *pipes*, parsed from the core interior **token stream**
-- | (`BareBars.Token`) into plain core `Expr` (`App` calls) — so the engine,
-- | prelude, and compiler below are reused unchanged.
-- |
-- | Operators desugar to helper calls: `&&`→`and`, `||`→`or`, `!`→`not`,
-- | `==`/`!=`/`<`/`>`/`<=`/`>=`→`eq`/`ne`/`lt`/`gt`/`lte`/`gte`, and `a | f x`→
-- | `(f a x)` (piped value first). Precedence loosest→tightest: pipe, `||`, `&&`,
-- | comparisons (non-associative), prefix `!`, application/atom.
module MaxBars.Expr
  ( parseMaxExpr
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
parseMaxExpr :: Array PosToken -> Either ParseError Expr
parseMaxExpr toks = case pPipe 0 of
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

  -- left-associative binary level: parse `sub`, then fold any matching operators.
  binL
    :: (Token -> Maybe (Expr -> Expr -> Expr))
    -> (Int -> Either ParseError (Step Expr))
    -> Int
    -> Either ParseError (Step Expr)
  binL match sub i = sub i >>= \first -> loop first.val first.pos
    where
    loop lhs pos = case tk pos >>= match of
      Just combine -> sub (pos + 1) >>= \r -> loop (combine lhs r.val) r.pos
      Nothing -> Right { val: lhs, pos }

  -- precedence ladder (loosest first)
  pPipe :: Int -> Either ParseError (Step Expr)
  pPipe i = binL pipeOp pOr i

  pOr :: Int -> Either ParseError (Step Expr)
  pOr i = binL (binOp "||" "or") pAnd i

  pAnd :: Int -> Either ParseError (Step Expr)
  pAnd i = binL (binOp "&&" "and") pCmp i

  -- comparisons are non-associative (at most one).
  pCmp :: Int -> Either ParseError (Step Expr)
  pCmp i = pUnary i >>= \lhs -> case tk lhs.pos >>= cmpOp of
    Just combine -> pUnary (lhs.pos + 1) >>= \r -> Right { val: combine lhs.val r.val, pos: r.pos }
    Nothing -> Right { val: lhs.val, pos: lhs.pos }

  pUnary :: Int -> Either ParseError (Step Expr)
  pUnary i = case tk i of
    Just (TOp "!") -> pUnary (i + 1) >>= \r -> Right { val: App "not" [ r.val ], pos: r.pos }
    _ -> pTerm i

  -- a term: a group, a literal, or an application (ident + atom args).
  pTerm :: Int -> Either ParseError (Step Expr)
  pTerm i = case tk i of
    Just TLParen -> pPipe (i + 1) >>= \r -> case tk r.pos of
      Just TRParen -> Right { val: r.val, pos: r.pos + 1 }
      _ -> Left (LexError "expected )" (posAt r.pos))
    Just (TStr s) -> Right { val: Lit (VString s), pos: i + 1 }
    Just (TNum n) -> Right { val: Lit (VNumber n), pos: i + 1 }
    Just (TIdent name) -> pArgs (i + 1) [] >>= \r -> Right { val: App name r.val, pos: r.pos }
    _ -> Left (LexError "expected an expression" (posAt i))

  pArgs :: Int -> Array Expr -> Either ParseError (Step (Array Expr))
  pArgs i acc = case tk i of
    Just TLParen -> pTerm i >>= \r -> pArgs r.pos (Array.snoc acc r.val)
    Just (TStr s) -> pArgs (i + 1) (Array.snoc acc (Lit (VString s)))
    Just (TNum n) -> pArgs (i + 1) (Array.snoc acc (Lit (VNumber n)))
    Just (TIdent name) -> pArgs (i + 1) (Array.snoc acc (App name []))
    _ -> Right { val: acc, pos: i }

  binOp :: String -> String -> Token -> Maybe (Expr -> Expr -> Expr)
  binOp sym helper = case _ of
    TOp s | s == sym -> Just (\a b -> App helper [ a, b ])
    _ -> Nothing

  -- `a | f x` ⇒ the piped value is f's first argument: `(f a x)`.
  pipeOp :: Token -> Maybe (Expr -> Expr -> Expr)
  pipeOp = case _ of
    TOp "|" -> Just \l r -> case r of
      App name as -> App name (Array.cons l as)
      _ -> r
    _ -> Nothing

  cmpOp :: Token -> Maybe (Expr -> Expr -> Expr)
  cmpOp = case _ of
    TOp "==" -> bin "eq"
    TOp "!=" -> bin "ne"
    TOp "<=" -> bin "lte"
    TOp ">=" -> bin "gte"
    TOp "<" -> bin "lt"
    TOp ">" -> bin "gt"
    _ -> Nothing
    where
    bin h = Just (\a b -> App h [ a, b ])
