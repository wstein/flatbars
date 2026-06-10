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
  , LexOptions
  , defaultLexOptions
  , infixOperatorChars
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
  -- collection-literal punctuation (`[…]` list, `{k: v}` dict, `,` separator) —
  -- emitted only when `LexOptions.collectionLiterals` is on (MaxBars). A dialect
  -- without it never sees these: `[` stays a path-segment opener, `{`/`,` a lex
  -- error, exactly as before.
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

-- | Lexer configuration — the interior lexer's one dialect seam. `operatorChars`
-- | lists the characters that lex as **operator tokens** instead of identifier
-- | characters. Empty (the default) is a path/name-only interior: `+ - * / ?` stay
-- | identifier characters, so `../x`, `a/b`, `partial-block`, and predicate-style
-- | names like `done?` lex as a single `TIdent`. A dialect with an infix surface
-- | opts in by listing the operator chars (`infixOperatorChars` is the conventional
-- | set); those then tokenize as `TOp`. `.` `@` `_` `=` are identifier characters
-- | regardless, so dotted paths, `@data`, and `key=value` hashes are unaffected by
-- | the seam. (The characters `& | ! < > =` are operators in every dialect — they
-- | are not configurable.)
-- |
-- | `rangeOperator` opts in to the `..` range operator (MaxBars): a glued double
-- | dot tokenizes as `TOp ".."` (so `1..5` and `a..b` carve into `a`/`..`/`b`),
-- | while a single `.` stays an identifier char (dotted paths `a.b` are untouched).
-- | Off by default — the dialects that keep the Handlebars `../` parent-path
-- | (ClassicBars/RawBars) and MinBars leave `..` inside the identifier run.
-- |
-- | `collectionLiterals` opts in to the `[…]` list and `{k: v}` dict literals
-- | (MaxBars): `[` `]` `{` `}` `,` tokenize as their own punctuation. Off by
-- | default — a leading `[` then stays a path-segment opener (`[0]`), `{`/`,` a
-- | lex error. A *mid-identifier* `[seg]` (the `a.[k]` path-bracket) is untouched
-- | either way — only a leading `[` becomes a list opener.
type LexOptions =
  { operatorChars :: String, rangeOperator :: Boolean, collectionLiterals :: Boolean }

-- | The default: an empty operator set, no range operator, no collection literals
-- | — a path/name-only interior (`..`/`[`/`{` keep their path/literal-free meaning).
defaultLexOptions :: LexOptions
defaultLexOptions = { operatorChars: "", rangeOperator: false, collectionLiterals: false }

-- | The conventional infix-operator alphabet a dialect enables for an expression
-- | surface: arithmetic `+ - * / %`, the ternary head `?`, and its `:` separator
-- | (a glued `?` greedily forms `??`/`?:`). Exported so opt-in dialects share one
-- | source instead of re-listing the characters.
infixOperatorChars :: String
infixOperatorChars = "+-*/%?:"

-- | Tokenize a tag interior. `base` is its offset in the source, added to every
-- | token's position so a downstream parse error points into the original
-- | template. A blank interior yields `[]`.
tokenizeInterior :: LexOptions -> Int -> String -> Either ParseError (Array PosToken)
tokenizeInterior cfg base src = go 0 []
  where
  cs = SCU.toCharArray src
  len = Array.length cs
  at i = Array.index cs i
  slc a b = SCU.fromCharArray (Array.slice a b cs)

  -- The configured operator characters (`cfg.operatorChars`): when a character is
  -- in this set it lexes as an operator rather than an identifier character. Empty
  -- by default, so `+ - * / ?` stay path/name punctuation; an infix dialect lists
  -- them (see `infixOperatorChars`). Precomputed once per interior.
  opChars = SCU.toCharArray cfg.operatorChars
  isOp c = Array.elem c opChars
  identChar c = isIdentChar c && not (isOp c)

  -- the `..` range operator (MaxBars, `cfg.rangeOperator`): a double dot at offset
  -- `j` is the two-char operator. A single `.` stays an identifier char (so dotted
  -- paths `a.b` are untouched); only a *glued* second dot triggers the split.
  rangeAt j = cfg.rangeOperator && at j == Just '.' && at (j + 1) == Just '.'

  go :: Int -> Array PosToken -> Either ParseError (Array PosToken)
  go i acc
    | i >= len = Right acc
    | otherwise = case at i of
        Nothing -> Right acc
        Just c
          | isWs c -> go (i + 1) acc
          | c == '(' -> go (i + 1) (push acc TLParen i (i + 1))
          | c == ')' -> go (i + 1) (push acc TRParen i (i + 1))
          -- collection-literal punctuation (MaxBars `collectionLiterals`): a leading
          -- `[`/`{`/`,`/`}`/`]` is a list/dict token. A `]` always closes a list here
          -- (never an ident char), but a *mid-identifier* `[seg]` is consumed by
          -- `readIdent` below before this dispatch sees the `[`, so `a.[k]` paths and
          -- `[…]` lists coexist.
          | cfg.collectionLiterals && c == '[' -> go (i + 1) (push acc TLBracket i (i + 1))
          | cfg.collectionLiterals && c == ']' -> go (i + 1) (push acc TRBracket i (i + 1))
          | cfg.collectionLiterals && c == '{' -> go (i + 1) (push acc TLBrace i (i + 1))
          | cfg.collectionLiterals && c == '}' -> go (i + 1) (push acc TRBrace i (i + 1))
          | cfg.collectionLiterals && c == ',' -> go (i + 1) (push acc TComma i (i + 1))
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
          -- the `..` range operator (MaxBars): a glued double dot, before the
          -- single `.` falls through to the identifier run below.
          | rangeAt i -> op2 ".." i acc
          -- a leading `-` glued to a digit is a negative literal in both modes.
          | c == '-' && maybe false isDigit (at (i + 1)) -> readNumber i acc
          -- Configured operator characters (`operatorChars`) lex as `TOp`. `?`
          -- greedily opens `??` (null-coalesce) or `?:` (truthy-coalesce) when
          -- glued, else a lone `?` (a ternary head); every other operator char is a
          -- single-character token (e.g. `+ - * / %`, and `:` the ternary separator).
          | isOp c && c == '?' ->
              if at (i + 1) == Just '?' then op2 "??" i acc
              else if at (i + 1) == Just ':' then op2 "?:" i acc
              else op1 "?" i acc
          | isOp c -> op1 (SCU.singleton c) i acc
          | isDigit c -> readNumber i acc
          | identChar c || c == '[' -> readIdent i acc
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
      -- a mid-identifier `[` is a path-index segment (`a.[k]`) — but with collection
      -- literals on it is one *only* after a `.`; a `[` glued elsewhere (`xs=[1,2]`,
      -- `f[…]`) ends the identifier so the `[` opens a list literal in the main loop.
      Just '[' | cfg.collectionLiterals && at (j - 1) /= Just '.' ->
        go j (push acc (TIdent (slc start j)) start j)
      Just '[' -> case bracketEnd (j + 1) of
        Just k -> scan (k + 1)
        Nothing -> Left (LexError "unterminated [ segment" (base + j))
      -- a `..` ends the identifier (the range operator splits `a..b`); a single
      -- `.` keeps the dotted path together.
      _ | rangeAt j -> go j (push acc (TIdent (slc start j)) start j)
      Just c | identChar c -> scan (j + 1)
      _ -> go j (push acc (TIdent (slc start j)) start j)
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
    -- a `..` (the range operator) ends the number before the dots, so `1..5`
    -- carves into `1`/`..`/`5` instead of a malformed `1..5` literal; a single
    -- `.` is still a decimal point (`1.5`).
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
