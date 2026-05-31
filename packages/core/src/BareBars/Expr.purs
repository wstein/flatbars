-- | The expression grammar (`grammar.adoc` §3), as a `purescript-parsing`
-- | parser over a tag's interior text.
-- |
-- | This is the whole expression sub-language — there is no separate token
-- | stream. `Expr ::= Ident Arg* | Lit | "(" Expr ")"` maps directly onto the
-- | combinators below: an application is an identifier followed by `many`
-- | arguments, a group is `between` parens, and a literal is a string or number.
-- | The lexical rules (the permissive IDENT set, `[bracket]` path segments,
-- | string escapes, the number shape) match `lexical.adoc` exactly so the core
-- | reads a path like `a.b` or `a.[home town]` as one identifier.
module BareBars.Expr
  ( parseExpr
  ) where

import Prelude hiding (between)

import BareBars.Error (ParseError(..))
import BareBars.Syntax (Expr(..))
import BareBars.Value (Value(..))
import Control.Alt ((<|>))
import Control.Lazy (defer)
import Data.Either (Either(..))
import Data.Foldable (fold)
import Data.Maybe (Maybe(..))
import Data.Number as Number
import Data.String.CodeUnits (fromCharArray, singleton)
import Parsing (Parser, Position(..), fail, parseErrorMessage, parseErrorPosition, runParser)
import Parsing.Combinators (between, lookAhead, try)
import Parsing.Combinators.Array (many, many1)
import Parsing.String (anyChar, char, eof, satisfy)

-- | Parse a tag interior into a single `Expr`, consuming all of it. `base` is
-- | the interior's offset in the original source, added to the failure position
-- | so a lexical error points into the source (not into the interior slice).
-- | The caller handles a blank interior (`EmptyOutput` / `HeadNotIdent`) before
-- | calling this.
parseExpr :: Int -> String -> Either ParseError Expr
parseExpr base s = case runParser s (ws *> pExpr <* eof) of
  Right e -> Right e
  Left err -> Left (LexError (parseErrorMessage err) (base + index err))
  where
  index err = case parseErrorPosition err of Position p -> p.index

-- Expr ::= "(" Expr ")" | Lit | Ident Arg*
-- (`defer` breaks the value-level cycle in this mutually-recursive grammar; the
-- `ParserT` `Lazy` instance makes that sound.)
pExpr :: Parser String Expr
pExpr = defer \_ -> pParen <|> lexeme pLit <|> pApp

-- An application: a head identifier and its (possibly empty) argument list.
pApp :: Parser String Expr
pApp = defer \_ -> App <$> lexeme pIdent <*> many pArg

-- In *argument* position a bare identifier is a nullary application; a grouped
-- expression or a literal is itself.
pArg :: Parser String Expr
pArg = defer \_ -> pParen <|> lexeme pLit <|> (flip App [] <$> lexeme pIdent)

pParen :: Parser String Expr
pParen = defer \_ -> between (lexeme (char '(')) (lexeme (char ')')) pExpr

pLit :: Parser String Expr
pLit = pString <|> pNumber

--------------------------------------------------------------------------------
-- Lexical atoms (lexical.adoc §1.5–1.7)
--------------------------------------------------------------------------------

-- | An identifier/path: a non-empty run of IDENT characters and whole
-- | `[bracket]` segments (which may contain spaces and dots, kept verbatim).
pIdent :: Parser String String
pIdent = fold <$> many1 identPiece
  where
  identPiece = (singleton <$> satisfy isIdentChar) <|> bracketGroup
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

-- | A number is a digit (or a `-` immediately before a digit) then a run of
-- | digits and dots, parsed by `Number.fromString`. `try` lets a leading `-`
-- | that is not a number (e.g. the identifier `-`) fall back to `pIdent`; once a
-- | digit is committed, a malformed run (`1.2.3`) is a hard error, as before.
pNumber :: Parser String Expr
pNumber = do
  raw <- try numLexeme
  case Number.fromString raw of
    Just n -> pure (Lit (VNumber n))
    Nothing -> fail ("malformed number '" <> raw <> "'")
  where
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
-- Whitespace and character classes (identical to lexical.adoc / the old lexer)
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

-- | The permissive IDENT set (lexical.adoc §1.5); `.` is a legal ident char, so
-- | `a.b` is one identifier in the core.
isIdentChar :: Char -> Boolean
isIdentChar c =
  isAlpha c || isDigit c
    || c == '_'
    || c == '-'
    || c == '+'
    || c == '*'
    || c == '?'
    || c == '!'
    || c == '/'
    || c == '.'
    || c == '<'
    || c == '>'
    || c == '='
    || c == '@'
    || c == '|'
