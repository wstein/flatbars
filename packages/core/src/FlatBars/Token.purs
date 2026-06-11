-- | The *interior* token stream. The structural scanner (`FlatBars.Lexer`)
-- | delimits tags and hands their interior text here; `tokenizeInterior` lexes
-- | that text into a flat `Token` stream that a dialect grammar then parses into
-- | an `Expr`. This is the meaning-free lexical layer: it recognizes operators,
-- | brackets, identifiers/paths, and literals as tokens, but assigns them no
-- | meaning — a dialect decides whether `&&`/`|`/`<` are operators or a parse
-- | error.
-- |
-- | One subtlety: `=` is an identifier *continuation* char (so the surface hash
-- | `key=value` lexes as a single ident the desugar later splits), while `==` at
-- | a token boundary is the equality operator.
module FlatBars.Token
  ( Token(..)
  , PosToken
  , Interior
  , tokenizeInterior
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), maybe)
import Data.Number as Number
import Data.String.CodeUnits as SCU
import FlatBars.Error (ParseError(..))

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
  -- collection-literal punctuation (`[…]` list, `{k: v}` dict, `,` separator). The
  -- *shared* interior tokenizer (RawBars/ClassicBars/MinBars) never emits these — a
  -- `[` stays a path-segment opener, `{`/`,` a lex error — but the constructors are
  -- part of the shared `Token` type because `MaxBars.Token` (ADR-041) does emit them.
  | TLBracket
  | TRBracket
  | TLBrace
  | TRBrace
  | TComma
  | TOp String

derive instance eqToken :: Eq Token

instance showToken :: Show Token where
  show = case _ of
    TIdent s -> "TIdent " <> show s
    TStr s -> "TStr " <> show s
    TNum n -> "TNum " <> show n
    TLParen -> "TLParen"
    TRParen -> "TRParen"
    TLBracket -> "TLBracket"
    TRBracket -> "TRBracket"
    TLBrace -> "TLBrace"
    TRBrace -> "TRBrace"
    TComma -> "TComma"
    TOp s -> "TOp " <> show s

-- | A token with its source span: `at` is the start offset (used for located
-- | parse errors), `end` the offset just past the token. Both are absolute
-- | source offsets (the interior `base` is already added). The parsers read only
-- | `tok`/`at`; `end` is substrate for the editor token vocabulary of ADR-017 (an
-- | opt-in LSP/TextMate semantic-token layer can recover an exact span for every
-- | interior token from it). The whole-tag syntax highlighter (ADR-014) colours a
-- | tag by its head's meaning and does not consume `end`.
type PosToken = { tok :: Token, at :: Int, end :: Int }

-- | A tag interior, pre-lexed: either its `PosToken` stream or the *deferred*
-- | interior lex error. Each interior-bearing `RawTok` (`FlatBars.Lexer`) carries
-- | one, so the parser and the highlighter consume pre-lexed interiors instead of
-- | re-lexing. Kept as the `Either` (not flattened) so a malformed interior rides
-- | inside its own tag and never breaks the structural scan (ADR-023 recovery). A
-- | token with no interior expression carries `Right []`.
type Interior = Either ParseError (Array PosToken)

-- | Tokenize a tag interior. `base` is its offset in the source, added to every
-- | token's position so a downstream parse error points into the original
-- | template. A blank interior yields `[]`.
-- |
-- | This is the **shared** path/name-only interior tokenizer for RawBars /
-- | ClassicBars / MinBars: `+ - * / % ? :` and `..` are identifier characters (so
-- | `../x`, `a/b`, `partial-block`, `done?` lex as one `TIdent`), and `[ { ,` keep
-- | their path/literal-free meaning. The infix-operator / `..` range / collection
-- | surface is MaxBars-only and lives in its own tokenizer (`MaxBars.Token`,
-- | ADR-041). The characters `& | ! < > ==` are operators in every dialect (they
-- | tokenize as `TOp`, and the prefix grammar then rejects them — `{{ a && b }}` is a
-- | parse error outside MaxBars).
tokenizeInterior :: Int -> String -> Either ParseError (Array PosToken)
tokenizeInterior base src = go 0 []
  where
  cs = SCU.toCharArray src
  len = Array.length cs
  at i = Array.index cs i
  slc a b = SCU.fromCharArray (Array.slice a b cs)

  go :: Int -> Array PosToken -> Either ParseError (Array PosToken)
  go i acc
    | i >= len = Right acc
    | otherwise = case at i of
        Nothing -> Right acc
        Just c
          | isWs c -> go (i + 1) acc
          | c == '(' -> go (i + 1) (push acc TLParen i (i + 1))
          | c == ')' -> go (i + 1) (push acc TRParen i (i + 1))
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
          -- a leading `-` glued to a digit is a negative literal.
          | c == '-' && maybe false isDigit (at (i + 1)) -> readNumber i acc
          | isDigit c -> readNumber i acc
          | isIdentChar c || c == '[' -> readIdent i acc
          | otherwise -> bad i

  push acc t i j = Array.snoc acc { tok: t, at: base + i, end: base + j }
  op1 s i acc = go (i + 1) (push acc (TOp s) i (i + 1))
  op2 s i acc = go (i + 2) (push acc (TOp s) i (i + 2))
  bad i = Left (LexError "unexpected character" (base + i))

  -- an identifier/path: a run of ident chars and whole `[bracket]` segments.
  readIdent :: Int -> Array PosToken -> Either ParseError (Array PosToken)
  readIdent start acc = scan start
    where
    scan j = case at j of
      -- a `[` is a path-index segment (`a.[k]`) — scanned whole into the identifier.
      Just '[' -> case bracketEnd (j + 1) of
        Just k -> scan (k + 1)
        Nothing -> Left (LexError "unterminated [ segment" (base + j))
      Just c | isIdentChar c -> scan (j + 1)
      -- a *spaced* hash assignment `key = value` (or `key =value`): the ident run
      -- ended on whitespace, and the next non-space char is a lone `=` (NOT `==`).
      -- Fold the `=` into the key as the `consumesNext` form `key=` — identical
      -- downstream to the glued `key=` (`asHashKey`), so the value is the next token.
      -- This is what lets the docs-17 binding surface (`{% set x = e %}` /
      -- `{% local x = 1 %}`) and any spaced helper hash (`{{tag k = v}}`) lex.
      _ | hashEqAt j -> go (skipWs j + 1)
        (push acc (TIdent (slc start j <> "=")) start (skipWs j + 1))
      _ -> go j (push acc (TIdent (slc start j)) start j)
    -- the index of the first non-whitespace char at or after `k`.
    skipWs k = case at k of
      Just c | isWs c -> skipWs (k + 1)
      _ -> k
    -- true when the run [start, j) is followed (past whitespace) by a lone `=`.
    hashEqAt j =
      let
        w = skipWs j
      in
        j > start && at w == Just '=' && at (w + 1) /= Just '='
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
        Just n -> go end (push acc (TNum n) start end)
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
        | c == q -> go (j + 1)
            (push acc (TStr (SCU.fromCharArray (Array.reverse chars))) start (j + 1))
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
-- | `_ - . @ / + * ?`, and `=` (so `key=value` hash lexes as one ident). `+ * ?`
-- | are path/name punctuation in this shared grammar (the infix interior is
-- | MaxBars-only); the operator characters `& | ! < >` are excluded so they
-- | tokenize as operators. `[` segments are handled separately.
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
