-- | The **MaxBars** interior-expression grammar: the FullBars/core term language
-- | plus *infix operators* and *pipes*, desugared to plain core `Expr` (`App`
-- | calls) so everything below — the FullBars surface desugar, prelude, engine,
-- | and compiler — is reused unchanged. This is the dialect's defining feature
-- | and the reason MaxBars needs its own grammar (the core IDENT set has no `&`
-- | and treats `|` as an ident char). Plugged into the parser via the
-- | `ParseOptions.parseExpr` seam.
-- |
-- | Operators desugar per the spec's operator → helper table:
-- | `&&`→`and`, `||`→`or`, `!`→`not`, `==`→`eq`, `!=`→`ne`, `<`/`>`/`<=`/`>=`→
-- | `lt`/`gt`/`lte`/`gte`, and `a | f x`→`(f a x)` (piped value first). Precedence
-- | (loosest→tightest): pipe, `||`, `&&`, comparisons (non-assoc), prefix `!`,
-- | application/atom.
module MaxBars.Expr
  ( parseMaxExpr
  ) where

import Prelude hiding (between)

import BareBars.Error (ParseError(..))
import BareBars.Syntax (Expr(..))
import BareBars.Value (Value(..))
import Control.Alt ((<|>))
import Control.Lazy (defer)
import Data.Array (cons)
import Data.Either (Either(..))
import Data.Foldable (fold)
import Data.Identity (Identity)
import Data.Maybe (Maybe(..))
import Data.Number as Number
import Data.String.CodeUnits (fromCharArray, singleton)
import Parsing (Parser, Position(..), fail, parseErrorMessage, parseErrorPosition, runParser)
import Parsing.Combinators (between, choice, lookAhead, notFollowedBy, try)
import Parsing.Combinators.Array (many, many1)
import Parsing.Expr (Assoc(..), Operator(..), OperatorTable, buildExprParser)
import Parsing.String (anyChar, char, eof, satisfy, string)

-- | Parse a MaxBars tag interior into a core `Expr`. `base` offsets the failure
-- | position into the original source (as `BareBars.Expr.parseExpr` does).
parseMaxExpr :: Int -> String -> Either ParseError Expr
parseMaxExpr base s = case runParser s (ws *> expr <* eof) of
  Right e -> Right e
  Left err -> Left (LexError (parseErrorMessage err) (base + idx err))
  where
  idx err = case parseErrorPosition err of Position p -> p.index

--------------------------------------------------------------------------------
-- The operator-precedence expression
--------------------------------------------------------------------------------

expr :: Parser String Expr
expr = defer \_ -> buildExprParser table term

-- Highest precedence first (buildExprParser convention): prefix `!`, then
-- comparisons, `&&`, `||`, and pipe (loosest).
table :: OperatorTable Identity String Expr
table =
  [ [ Prefix (opNot $> \a -> App "not" [ a ]) ]
  , [ Infix (compOp <#> \name -> \a b -> App name [ a, b ]) AssocNone ]
  , [ Infix (opSym "&&" $> \a b -> App "and" [ a, b ]) AssocLeft ]
  , [ Infix (opSym "||" $> \a b -> App "or" [ a, b ]) AssocLeft ]
  , [ Infix (opPipe $> pipe) AssocLeft ]
  ]
  where
  -- `a | f x` ⇒ the piped value is f's *first* argument: `(f a x)`.
  pipe l r = case r of
    App name args -> App name (cons l args)
    _ -> r

-- prefix `!`, but not the `!=` comparison.
opNot :: Parser String Unit
opNot = lexeme (try (void (string "!") <* notFollowedBy (char '=')))

-- a fixed two-char operator (`&&` / `||`).
opSym :: String -> Parser String Unit
opSym s = lexeme (void (string s))

-- the pipe `|`, but not `||` (the or-operator).
opPipe :: Parser String Unit
opPipe = lexeme (try (void (string "|") <* notFollowedBy (char '|')))

-- a comparison operator → its helper name (longest match first).
compOp :: Parser String String
compOp = lexeme
  ( choice
      [ try (string "==") $> "eq"
      , try (string "!=") $> "ne"
      , try (string "<=") $> "lte"
      , try (string ">=") $> "gte"
      , string "<" $> "lt"
      , string ">" $> "gt"
      ]
  )

--------------------------------------------------------------------------------
-- Terms: literals, parens, and prefix applications / paths (core/FullBars)
--------------------------------------------------------------------------------

term :: Parser String Expr
term = defer \_ -> lexeme (pParen <|> pLit <|> pApp)

pApp :: Parser String Expr
pApp = defer \_ -> App <$> lexeme pIdent <*> many pArg

pArg :: Parser String Expr
pArg = defer \_ -> pParen <|> lexeme pLit <|> (flip App [] <$> lexeme pIdent)

pParen :: Parser String Expr
pParen = defer \_ -> between (lexeme (char '(')) (lexeme (char ')')) expr

pLit :: Parser String Expr
pLit = pString <|> pNumber

-- | A MaxBars identifier/path: alnum, `_`, `-`, `.`, `@`, and whole `[bracket]`
-- | segments. Operator characters (`< > = | & !`) are deliberately *excluded* so
-- | they tokenize as operators, not as part of a path.
pIdent :: Parser String String
pIdent = fold <$> many1 identPiece
  where
  identPiece = (singleton <$> satisfy isPathChar) <|> bracketGroup
  bracketGroup = do
    _ <- char '['
    inner <- many (satisfy (_ /= ']'))
    _ <- char ']'
    pure ("[" <> fromCharArray inner <> "]")

pString :: Parser String Expr
pString = do
  q <- char '"' <|> char '\''
  cs <- many (strChar q)
  _ <- char q
  pure (Lit (VString (fromCharArray cs)))
  where
  strChar q = (char '\\' *> escChar) <|> satisfy (\c -> c /= q && c /= '\\')
  escChar = do
    e <- anyChar
    case unescape e of
      Just ch -> pure ch
      Nothing -> fail "invalid string escape"

pNumber :: Parser String Expr
pNumber = do
  raw <- try numLexeme
  case Number.fromString raw of
    Just n -> pure (Lit (VNumber n))
    Nothing -> fail ("malformed number '" <> raw <> "'")
  where
  -- a digit, or a `-` immediately before a digit (negative literal); `try` lets
  -- a bare `-`/kebab fall back to an identifier.
  numLexeme = do
    first <- satisfy isDigit <|> (char '-' <* lookAhead (satisfy isDigit))
    rest <- many (satisfy isNumChar)
    pure (singleton first <> fromCharArray rest)

unescape :: Char -> Maybe Char
unescape = case _ of
  '\\' -> Just '\\'
  '"' -> Just '"'
  '\'' -> Just '\''
  'n' -> Just '\n'
  't' -> Just '\t'
  'r' -> Just '\r'
  _ -> Nothing

--------------------------------------------------------------------------------
-- Lexical helpers
--------------------------------------------------------------------------------

ws :: Parser String Unit
ws = void (many (satisfy isSpace))

lexeme :: forall a. Parser String a -> Parser String a
lexeme p = p <* ws

isSpace :: Char -> Boolean
isSpace c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

isDigit :: Char -> Boolean
isDigit c = c >= '0' && c <= '9'

isNumChar :: Char -> Boolean
isNumChar c = isDigit c || c == '.'

isAlpha :: Char -> Boolean
isAlpha c = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')

isPathChar :: Char -> Boolean
isPathChar c =
  isAlpha c || isDigit c || c == '_' || c == '-' || c == '.' || c == '@'
