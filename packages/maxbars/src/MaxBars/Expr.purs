-- | The **MaxBars** interior grammar: the prefix term language plus *infix
-- | operators* and *pipes*, parsed from the core interior **token stream**
-- | (`FlatBars.Token`) into plain core `Expr` (`App` calls) — so the engine,
-- | prelude, and compiler below are reused unchanged.
-- |
-- | Operators desugar to helper calls: `&&`→`and`, `||`→`or`, `!`→`not`,
-- | `==`/`!=`/`<`/`>`/`<=`/`>=`→`eq`/`ne`/`lt`/`gt`/`lte`/`gte`, the
-- | null-coalescing `??`→`coalesce`, arithmetic `+`/`-`/`*`/`/`/`%`→
-- | `add`/`subtract`/`multiply`/`divide`/`modulo`, and `a | f x`→`(f a x)` (piped
-- | value first). Precedence loosest→tightest: pipe, `??`, `||`, `&&`, comparisons
-- | (non-associative), additive (`+` `-`), multiplicative (`*` `/` `%`), prefix
-- | `!`, application/atom. (A dotted path like `a.b` stays a single identifier —
-- | the lexer keeps `.` an ident char — so `/` is unambiguously division here.)
-- |
-- | Two entry points share the precedence ladder, differing only in the *primary*
-- | the operators bind over:
-- |
-- |  * `parseMaxExpr` (output expressions) — the primary is an **application**
-- |    (`f a b`), so `{{ f a && b }}` is `(and (f a) b)`.
-- |  * `parseMaxHead` (block heads, the `parseHead` seam) — the head is `name`
-- |    followed by *arguments*, each an infix expression whose primary is a single
-- |    **atom**. So `{{#if a && b}}` reads as `if (and a b)` (one condition) and
-- |    `{{#each xs}}` / `{{#if cond k=v}}` keep their positional/hash args. The head
-- |    ladder omits the *pipe* rung: a bar in head position is **structure**, not an
-- |    operator — it carries the block-parameter clause `as |a b|` through to the
-- |    surface desugar (`extractBlockParams`), exactly as the core default parser
-- |    does. Pipe an argument by parenthesising it (`{{#each (xs | reverse) as |x|}}`),
-- |    where an atom re-enters the full expression ladder.
module MaxBars.Expr
  ( parseMaxExpr
  , parseMaxHead
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), isJust)
import Data.String (Pattern(..), stripPrefix)
import FlatBars.Error (ParseError(..))
import FlatBars.Syntax (Expr(..))
import FlatBars.Token (PosToken, Token(..))
import FlatBars.Value (Value(..))

-- | MaxBars drops the Handlebars `@` namespace (ADR-021): `@index`/`@root`/`@key`
-- | are rejected — read the loop/context model instead. (`../` is already gone:
-- | `/` is MaxBars' division operator, so `../x` is arithmetic, not a path.)
isAtVar :: String -> Boolean
isAtVar name = isJust (stripPrefix (Pattern "@") name)

atVarError :: Int -> ParseError
atVarError = LexError
  "'@…' variables are not used in MaxBars; read the loop/context model instead (e.g. {{loop.index0}}, {{parent.x}}, {{root.y}})"

type Step a = { val :: a, pos :: Int }

-- | Parse a tag interior's tokens into one `Expr` (output position), consuming
-- | all of them.
parseMaxExpr :: Array PosToken -> Either ParseError Expr
parseMaxExpr toks = case exprLadder 0 of
  Left e -> Left e
  Right { val, pos }
    | pos >= len -> Right val
    | otherwise -> Left (LexError "unexpected token" (posAt pos))
  where
  comb = combinators toks
  exprLadder = comb.exprLadder
  len = comb.len
  posAt = comb.posAt

-- | Parse a *block head*: `name arg*`, where each argument is an infix expression
-- | over atoms (so `{{#if a && b}}` is `if (and a b)`) — the *pipe* rung excluded,
-- | so a trailing `as |a b|` survives as structure (see the module header). Returns
-- | the head as an `App`, which the core tree-builder splits into `{ name, args }`.
parseMaxHead :: Array PosToken -> Either ParseError Expr
parseMaxHead toks = case comb.tk 0 of
  Just (TIdent name)
    | isAtVar name -> Left (atVarError (comb.posAt 0))
    | otherwise -> App name <$> collect 1 []
  _ -> Left (LexError "expected a block helper name" (comb.posAt 0))
  where
  comb = combinators toks
  collect i acc
    | i >= comb.len = Right acc
    | otherwise = case comb.headLadder i of
        Left e -> Left e
        Right r
          | r.pos == i -> Left (LexError "unexpected token" (comb.posAt i))
          | otherwise -> collect r.pos (Array.snoc acc r.val)

-- | The shared parser combinators over a token array: the precedence ladder
-- | (parameterised by its primary), the atom/application primaries, and helpers.
combinators
  :: Array PosToken
  -> { exprLadder :: Int -> Either ParseError (Step Expr)
     , headLadder :: Int -> Either ParseError (Step Expr)
     , tk :: Int -> Maybe Token
     , posAt :: Int -> Int
     , len :: Int
     }
combinators toks =
  { exprLadder, headLadder, tk, posAt, len }
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

  -- the precedence ladder over a given `term` (the primary at the bottom).
  -- `withPipe` is the top rung: output expressions include it; block heads omit
  -- it (a bar there is a block-parameter delimiter, parsed as structure below).
  ladder
    :: Boolean -> (Int -> Either ParseError (Step Expr)) -> Int -> Either ParseError (Step Expr)
  ladder withPipe term = if withPipe then pPipe else pCoalesce
    where
    pPipe i = binL pipeOp pCoalesce i
    pCoalesce i = binL (binOp "??" "coalesce") pOr i
    pOr i = binL (binOp "||" "or") pAnd i
    pAnd i = binL (binOp "&&" "and") pCmp i
    -- comparison is non-associative and its operands are full additive
    -- expressions, so `n + 1 > 5` reads as `(gt (add n 1) 5)`.
    pCmp i = pAdd i >>= \lhs -> case tk lhs.pos >>= cmpOp of
      Just c -> pAdd (lhs.pos + 1) >>= \r -> Right { val: c lhs.val r.val, pos: r.pos }
      Nothing -> Right { val: lhs.val, pos: lhs.pos }
    pAdd i = binL addOp pMul i
    pMul i = binL mulOp pUnary i
    pUnary i = case tk i of
      Just (TOp "!") -> pUnary (i + 1) >>= \r -> Right { val: App "not" [ r.val ], pos: r.pos }
      _ -> term i

  -- output expressions: the primary is an application (`f a b`); pipe included.
  exprLadder i = ladder true pApp i
  -- block-head arguments: the primary is a single atom (so `name a b` is two args);
  -- the pipe rung is omitted so a bar stays structural (a block-param delimiter).
  headLadder i = ladder false pAtom i

  -- an application: an identifier head applied to atom arguments, or an atom.
  pApp :: Int -> Either ParseError (Step Expr)
  pApp i = case tk i of
    Just (TIdent name)
      | isAtVar name -> Left (atVarError (posAt i))
      | otherwise -> pArgs (i + 1) [] >>= \r -> Right { val: App name r.val, pos: r.pos }
    _ -> pAtom i

  -- an atom: a parenthesised full expression, a literal, or a nullary identifier.
  pAtom :: Int -> Either ParseError (Step Expr)
  pAtom i = case tk i of
    Just TLParen -> exprLadder (i + 1) >>= \r -> case tk r.pos of
      Just TRParen -> Right { val: r.val, pos: r.pos + 1 }
      _ -> Left (LexError "expected )" (posAt r.pos))
    Just (TStr s) -> Right { val: Lit (VString s), pos: i + 1 }
    Just (TNum n) -> Right { val: Lit (VNumber n), pos: i + 1 }
    Just (TIdent name)
      | isAtVar name -> Left (atVarError (posAt i))
      | otherwise -> Right { val: App name [], pos: i + 1 }
    -- a bare bar is structure, not an operator: in head position (no pipe rung)
    -- it survives as `App "|" []` so the surface desugar's `extractBlockParams`
    -- can strip a trailing `as |…|` clause — matching the core default parser.
    -- (In output position the pipe rung consumes the bar first, so this case is
    -- reached only inside a block head.)
    Just (TOp "|") -> Right { val: App "|" [], pos: i + 1 }
    _ -> Left (LexError "expected an expression" (posAt i))

  -- application arguments: a run of atoms (paren / literal / nullary ident).
  pArgs :: Int -> Array Expr -> Either ParseError (Step (Array Expr))
  pArgs i acc = case tk i of
    Just TLParen -> pAtom i >>= \r -> pArgs r.pos (Array.snoc acc r.val)
    Just (TStr s) -> pArgs (i + 1) (Array.snoc acc (Lit (VString s)))
    Just (TNum n) -> pArgs (i + 1) (Array.snoc acc (Lit (VNumber n)))
    Just (TIdent name)
      | isAtVar name -> Left (atVarError (posAt i))
      | otherwise -> pArgs (i + 1) (Array.snoc acc (App name []))
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

  -- additive / multiplicative arithmetic (desugar to the shared prelude helpers).
  addOp :: Token -> Maybe (Expr -> Expr -> Expr)
  addOp = case _ of
    TOp "+" -> bin "add"
    TOp "-" -> bin "subtract"
    _ -> Nothing
    where
    bin h = Just (\a b -> App h [ a, b ])

  mulOp :: Token -> Maybe (Expr -> Expr -> Expr)
  mulOp = case _ of
    TOp "*" -> bin "multiply"
    TOp "/" -> bin "divide"
    TOp "%" -> bin "modulo"
    _ -> Nothing
    where
    bin h = Just (\a b -> App h [ a, b ])
