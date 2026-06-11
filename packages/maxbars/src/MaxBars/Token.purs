-- | The **MaxBars interior token stream** — forked from `FlatBars.Token`'s
-- | `tokenizeInterior` (ADR-041) so MaxBars owns its *entire* front-end: the
-- | structural lexer (`MaxBars.Lexer`), this interior tokenizer, the parser
-- | (`MaxBars.Parser`), and the highlighter (`MaxBars.Highlight`). Nothing in
-- | MaxBars's `String → Template`/spans path runs shared lexing code.
-- |
-- | It emits the **shared** `Token`/`PosToken` types (the interior-token AST stays
-- | single-source, like `Syntax`); only the *lexing rules* are owned, with the
-- | MaxBars expression surface baked in (no `LexOptions` seam):
-- |
-- |   * the infix-operator alphabet `+ - * / % ? :` lexes as `TOp` (a glued `?`
-- |     greedily forms `??`/`?:`); `& | ! < > ==` are operators in every dialect;
-- |   * the `..` range operator (`1..5`/`a..b` carve `a`/`..`/`b`; a single `.`
-- |     stays a dotted-path char);
-- |   * the `[…]` list and `{k: v}` dict literals (`[ ] { } ,` are their own
-- |     punctuation; a *mid-identifier* `a.[k]` path-bracket is untouched).
-- |
-- | `.` `@` `_` `=` are identifier characters, so dotted paths, `@data`, and
-- | `key=value` hashes lex as one `TIdent`.
module MaxBars.Token
  ( tokenizeInterior
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), maybe)
import Data.Number as Number
import Data.String.CodeUnits as SCU
import FlatBars.Error (ParseError(..))
import FlatBars.Token (PosToken, Token(..))

-- | The MaxBars infix-operator alphabet: arithmetic `+ - * / %`, the string-concat
-- | `~` (Tera's spelling, ADR-042), the ternary head `?`, and its `:` separator.
-- | `& | ! < > =` are handled directly below (operators in every dialect), so they
-- | are not listed here. (`~` is free in MaxBars: the whitespace trim-mark is `-`
-- | under `statementTags`, not `~`.)
maxOperatorChars :: String
maxOperatorChars = "+-*/%?:~"

-- | Tokenize a MaxBars tag interior. `base` is its offset in the source, added to
-- | every token's position so a downstream parse error points into the original
-- | template. A blank interior yields `[]`.
tokenizeInterior :: Int -> String -> Either ParseError (Array PosToken)
tokenizeInterior base src = go 0 []
  where
  cs = SCU.toCharArray src
  len = Array.length cs
  at i = Array.index cs i
  slc a b = SCU.fromCharArray (Array.slice a b cs)

  opChars = SCU.toCharArray maxOperatorChars
  isOp c = Array.elem c opChars
  identChar c = isIdentChar c && not (isOp c)

  -- The `..` range operator: a glued double dot is the two-char operator; a single
  -- `.` stays an identifier char (dotted paths `a.b` are untouched).
  rangeAt j = at j == Just '.' && at (j + 1) == Just '.'

  go :: Int -> Array PosToken -> Either ParseError (Array PosToken)
  go i acc
    | i >= len = Right acc
    | otherwise = case at i of
        Nothing -> Right acc
        Just c
          | isWs c -> go (i + 1) acc
          | c == '(' -> go (i + 1) (push acc TLParen i (i + 1))
          | c == ')' -> go (i + 1) (push acc TRParen i (i + 1))
          -- collection-literal punctuation: a leading `[`/`{`/`,`/`}`/`]` is a
          -- list/dict token. A *mid-identifier* `a.[k]` path-bracket is consumed by
          -- `readIdent` before this dispatch sees the `[`, so paths and lists coexist.
          | c == '[' -> go (i + 1) (push acc TLBracket i (i + 1))
          | c == ']' -> go (i + 1) (push acc TRBracket i (i + 1))
          | c == '{' -> go (i + 1) (push acc TLBrace i (i + 1))
          | c == '}' -> go (i + 1) (push acc TRBrace i (i + 1))
          | c == ',' -> go (i + 1) (push acc TComma i (i + 1))
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
          -- the `..` range operator: a glued double dot, before the single `.` falls
          -- through to the identifier run below.
          | rangeAt i -> op2 ".." i acc
          -- a leading `-` glued to a digit is a negative literal.
          | c == '-' && maybe false isDigit (at (i + 1)) -> readNumber i acc
          -- the infix-operator chars lex as `TOp`. `?` greedily opens `??`
          -- (null-coalesce) or `?:` (truthy-coalesce) when glued, else a lone `?`
          -- (a ternary head); every other is single-char (`+ - * / %`, `:`).
          | isOp c && c == '?' ->
              if at (i + 1) == Just '?' then op2 "??" i acc
              else if at (i + 1) == Just ':' then op2 "?:" i acc
              else op1 "?" i acc
          | isOp c -> op1 (SCU.singleton c) i acc
          | isDigit c -> readNumber i acc
          | identChar c -> readIdent i acc
          | otherwise -> bad i

  push acc t i j = Array.snoc acc { tok: t, at: base + i, end: base + j }
  op1 s i acc = go (i + 1) (push acc (TOp s) i (i + 1))
  op2 s i acc = go (i + 2) (push acc (TOp s) i (i + 2))
  bad i = Left (LexError "unexpected character" (base + i))

  -- an identifier/path: a run of ident chars and whole `[bracket]` path segments.
  readIdent :: Int -> Array PosToken -> Either ParseError (Array PosToken)
  readIdent start acc = scan start
    where
    scan j = case at j of
      -- a mid-identifier `[` is a path-index segment (`a.[k]`) only after a `.`; a
      -- `[` glued elsewhere (`xs=[1,2]`, `f[…]`) ends the identifier so the `[` opens
      -- a list literal in the main loop.
      Just '[' | at (j - 1) /= Just '.' ->
        go j (push acc (TIdent (slc start j)) start j)
      Just '[' -> case bracketEnd (j + 1) of
        Just k -> scan (k + 1)
        Nothing -> Left (LexError "unterminated [ segment" (base + j))
      -- a `..` ends the identifier (the range operator splits `a..b`); a single `.`
      -- keeps the dotted path together.
      _ | rangeAt j -> go j (push acc (TIdent (slc start j)) start j)
      Just c | identChar c -> scan (j + 1)
      -- a *spaced* hash assignment `key = value`: fold the `=` into the key as the
      -- `key=` form (identical downstream to the glued `key=`), so the value is the
      -- next token. Lets `{% set x = e %}` / `{{tag k = v}}` lex.
      _ | hashEqAt j -> go (skipWs j + 1)
        (push acc (TIdent (slc start j <> "=")) start (skipWs j + 1))
      _ -> go j (push acc (TIdent (slc start j)) start j)
    skipWs k = case at k of
      Just c | isWs c -> skipWs (k + 1)
      _ -> k
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
    -- a `..` ends the number before the dots, so `1..5` carves into `1`/`..`/`5`; a
    -- single `.` is still a decimal point (`1.5`).
    numEnd j
      | rangeAt j = j
      | otherwise = case at j of
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
-- | `_ - . @ / + * ?`, and `=` (so `key=value` hash lexes as one ident). The
-- | operator characters are excluded by the caller (`identChar`) so they tokenize
-- | as operators; `[` segments are handled separately.
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
