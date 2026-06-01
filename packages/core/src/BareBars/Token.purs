-- | The *interior* token stream. The structural scanner (`BareBars.Lexer`)
-- | delimits tags and hands their interior text here; `tokenizeInterior` lexes
-- | that text into a flat `Token` stream that a dialect grammar then parses into
-- | an `Expr`. This is the meaning-free lexical layer: it recognizes operators,
-- | brackets, identifiers/paths, and literals as tokens, but assigns them no
-- | meaning — a dialect decides whether `&&`/`|`/`<` are operators (MaxBars) or a
-- | parse error (RawBars/FullBars).
-- |
-- | One subtlety: `=` is an identifier *continuation* char (so the surface hash
-- | `key=value` lexes as a single ident the desugar later splits), while `==` at
-- | a token boundary is the equality operator.
module BareBars.Token
  ( Token(..)
  , PosToken
  , LexOptions
  , defaultLexOptions
  , tokenizeInterior
  ) where

import Prelude

import BareBars.Error (ParseError(..))
import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), maybe)
import Data.Number as Number
import Data.String.CodeUnits as SCU

-- | An interior token. Paths (`a.b`, `a.[k]`, `@root`, `../x`) are a single
-- | `TIdent` (dots/brackets/`@`/`..` included, kept verbatim) — the dialect
-- | desugar interprets them. `TOp` carries the operator lexeme (`&&`, `|`, `<=`,
-- | …); whether it means anything is the dialect's call.
data Token
  = TIdent String
  | TStr String
  | TNum Number
  | TLParen
  | TRParen
  | TOp String

derive instance eqToken :: Eq Token

instance showToken :: Show Token where
  show = case _ of
    TIdent s -> "TIdent " <> show s
    TStr s -> "TStr " <> show s
    TNum n -> "TNum " <> show n
    TLParen -> "TLParen"
    TRParen -> "TRParen"
    TOp s -> "TOp " <> show s

-- | A token with its source offset (for located parse errors).
type PosToken = { tok :: Token, at :: Int }

-- | Tokenize a tag interior. `base` is its offset in the source, added to every
-- | token's position so a downstream parse error points into the original
-- | template. A blank interior yields `[]`.
-- | Lexer configuration (a dialect seam). `infixArith` turns `+ - * / % ` and
-- | `??` into operator tokens (MaxBars); when off (RawBars/FullBars default)
-- | those characters stay *identifier* characters, so path/name syntax such as
-- | `../x`, `a/b`, and `partial-block` lexes as a single `TIdent` exactly as
-- | before. `.` `@` `_` `=` remain identifier characters in **both** modes, so
-- | dotted paths, `@data`, and `key=value` hashes are untouched by the switch.
type LexOptions = { infixArith :: Boolean }

-- | The default lexer config: no arithmetic operators (RawBars/FullBars).
defaultLexOptions :: LexOptions
defaultLexOptions = { infixArith: false }

tokenizeInterior :: LexOptions -> Int -> String -> Either ParseError (Array PosToken)
tokenizeInterior cfg base src = go 0 []
  where
  cs = SCU.toCharArray src
  len = Array.length cs
  at i = Array.index cs i
  slc a b = SCU.fromCharArray (Array.slice a b cs)

  -- `+ - * / ?` are operator characters only under `infixArith`; otherwise they
  -- are identifier characters (path/name punctuation). `%` is never an identifier
  -- character, so it is an operator under `infixArith` and invalid otherwise.
  arithChar c = c == '+' || c == '-' || c == '*' || c == '/' || c == '?'
  identChar c = isIdentChar c && not (cfg.infixArith && arithChar c)

  go :: Int -> Array PosToken -> Either ParseError (Array PosToken)
  go i acc
    | i >= len = Right acc
    | otherwise = case at i of
        Nothing -> Right acc
        Just c
          | isWs c -> go (i + 1) acc
          | c == '(' -> go (i + 1) (push acc TLParen i)
          | c == ')' -> go (i + 1) (push acc TRParen i)
          | c == '"' || c == '\'' -> readString i c acc
          -- operators (longest-match); `&` only as `&&`.
          | c == '&' -> if at (i + 1) == Just '&' then op2 "&&" i acc else bad i
          | c == '|' -> if at (i + 1) == Just '|' then op2 "||" i acc else op1 "|" i acc
          | c == '!' -> if at (i + 1) == Just '=' then op2 "!=" i acc else op1 "!" i acc
          | c == '<' -> if at (i + 1) == Just '=' then op2 "<=" i acc else op1 "<" i acc
          | c == '>' -> if at (i + 1) == Just '=' then op2 ">=" i acc else op1 ">" i acc
          -- `==` is the only token-boundary use of `=`; a lone `=` here is invalid
          -- (`key=value` keeps `=` inside the ident run, below).
          | c == '=' -> if at (i + 1) == Just '=' then op2 "==" i acc else bad i
          -- a leading `-` glued to a digit is a negative literal in both modes.
          | c == '-' && maybe false isDigit (at (i + 1)) -> readNumber i acc
          -- MaxBars arithmetic / coalesce operators (only under `infixArith`).
          | cfg.infixArith && c == '?' ->
              if at (i + 1) == Just '?' then op2 "??" i acc else bad i
          | cfg.infixArith && arithChar c -> op1 (SCU.singleton c) i acc
          | cfg.infixArith && c == '%' -> op1 "%" i acc
          | isDigit c -> readNumber i acc
          | identChar c || c == '[' -> readIdent i acc
          | otherwise -> bad i

  push acc t i = Array.snoc acc { tok: t, at: base + i }
  op1 s i acc = go (i + 1) (push acc (TOp s) i)
  op2 s i acc = go (i + 2) (push acc (TOp s) i)
  bad i = Left (LexError "unexpected character" (base + i))

  -- an identifier/path: a run of ident chars and whole `[bracket]` segments.
  readIdent :: Int -> Array PosToken -> Either ParseError (Array PosToken)
  readIdent start acc = scan start
    where
    scan j = case at j of
      Just '[' -> case bracketEnd (j + 1) of
        Just k -> scan (k + 1)
        Nothing -> Left (LexError "unterminated [ segment" (base + j))
      Just c | identChar c -> scan (j + 1)
      _ -> go j (push acc (TIdent (slc start j)) start)
    bracketEnd k
      | k > len = Nothing
      | at k == Just ']' = Just k
      | otherwise = bracketEnd (k + 1)

  readNumber :: Int -> Array PosToken -> Either ParseError (Array PosToken)
  readNumber start acc =
    let
      end = numEnd (start + 1) -- first char is a digit or `-`
      raw = slc start end
    in
      case Number.fromString raw of
        Just n -> go end (push acc (TNum n) start)
        Nothing -> Left (LexError ("malformed number '" <> raw <> "'") (base + start))
    where
    numEnd j = case at j of
      Just c | isNumChar c -> numEnd (j + 1)
      _ -> j

  readString :: Int -> Char -> Array PosToken -> Either ParseError (Array PosToken)
  readString start q acc = collect (start + 1) []
    where
    collect j chars = case at j of
      Nothing -> Left (LexError "unterminated string" (base + start))
      Just c
        | c == q -> go (j + 1) (push acc (TStr (SCU.fromCharArray (Array.reverse chars))) start)
        | c == '\\' -> case at (j + 1) of
            Just e -> case unescape e of
              Just ch -> collect (j + 2) (Array.cons ch chars)
              Nothing -> Left (LexError "invalid string escape" (base + j))
            Nothing -> Left (LexError "unterminated string" (base + start))
        | otherwise -> collect (j + 1) (Array.cons c chars)

unescape :: Char -> Maybe Char
unescape = case _ of
  '\\' -> Just '\\'
  '"' -> Just '"'
  '\'' -> Just '\''
  'n' -> Just '\n'
  't' -> Just '\t'
  'r' -> Just '\r'
  _ -> Nothing

isWs :: Char -> Boolean
isWs c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

isDigit :: Char -> Boolean
isDigit c = c >= '0' && c <= '9'

isNumChar :: Char -> Boolean
isNumChar c = isDigit c || c == '.'

isAlpha :: Char -> Boolean
isAlpha c = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')

-- | Identifier characters (continuation): alnum, the path punctuation
-- | `_ - . @ / + * ?`, and `=` (so `key=value` hash lexes as one ident). The
-- | operator characters `& | ! < >` are deliberately excluded so they tokenize
-- | as operators. `[` segments are handled separately.
isIdentChar :: Char -> Boolean
isIdentChar c =
  isAlpha c || isDigit c
    || c == '_'
    || c == '-'
    || c == '.'
    || c == '@'
    || c == '/'
    || c == '+'
    || c == '*'
    || c == '?'
    || c == '='
