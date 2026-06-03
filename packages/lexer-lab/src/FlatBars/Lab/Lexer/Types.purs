-- | The token model shared by the two lexer spikes — `FlatBars.Lab.Lexer` (the
-- | `purescript-parsing` version) and `FlatBars.Lab.LexerHand` (the hand-written
-- | index scan). One source of truth for the lexeme/trivia/span types, their
-- | classification (`semanticTokenType`/`lspEmits`), the lexical character
-- | classes, and the pieces→tokens fold — so the two lexers cannot drift, and
-- | the parity test really is comparing the same model produced two ways.
module FlatBars.Lab.Lexer.Types
  ( SourcePos
  , Span
  , Spanned
  , Trivia(..)
  , Sigil(..)
  , Lexeme(..)
  , LexToken
  , Piece(..)
  , LexConfig
  , defaultLexConfig
  , lexemes
  , semanticTokenType
  , lspEmits
  , isSpace
  , isDigit
  , isAlpha
  , identChar
  , baseIdent
  , arithChar
  , unescape
  , words
  , firstWord
  , assemble
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl)
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), split)
import Data.String.CodeUnits as SCU

--------------------------------------------------------------------------------
-- Spans
--------------------------------------------------------------------------------

-- | A source position: the absolute code-unit `index` plus 1-based
-- | `line`/`column` (straight from `parsing`'s `Position`). Carrying line/column
-- | — not just the offset — lets an LSP build a `Range` without re-scanning the
-- | source for line starts.
type SourcePos = { index :: Int, line :: Int, column :: Int }

-- | A source span: the position of the first character and the position just
-- | past the last — exactly the substrate an LSP needs to build a range.
type Span = { start :: SourcePos, end :: SourcePos }

-- | A value tagged with the span it occupies.
type Spanned a = { value :: a, span :: Span }

--------------------------------------------------------------------------------
-- Tokens
--------------------------------------------------------------------------------

-- | Insignificant source the grammar skips. `Text` is the host-text "ocean"
-- | between tags; `Whitespace` is the runs *inside* a tag that separate
-- | interior tokens. Both are carried as the leading trivia of the next lexeme.
data Trivia
  = Text String
  | Whitespace String

derive instance eqTrivia :: Eq Trivia

instance showTrivia :: Show Trivia where
  show = case _ of
    Text s -> "Text " <> show s
    Whitespace s -> "Whitespace " <> show s

-- | The single character (or two-character compound) that immediately follows a
-- | tag opener and selects the tag's role. The lexer recognises the *shape*; it
-- | attaches no meaning (a dialect decides whether, say, `Parent` is legal).
data Sigil
  = Section -- {{#
  | Inverse -- {{^
  | Close -- {{/
  | Partial -- {{>
  | Unescaped -- {{&
  | BlockDef -- {{$
  | Parent -- {{<
  | Decorator -- {{#*
  | PartialBlock -- {{#>

derive instance eqSigil :: Eq Sigil

instance showSigil :: Show Sigil where
  show = case _ of
    Section -> "Section"
    Inverse -> "Inverse"
    Close -> "Close"
    Partial -> "Partial"
    Unescaped -> "Unescaped"
    BlockDef -> "BlockDef"
    Parent -> "Parent"
    Decorator -> "Decorator"
    PartialBlock -> "PartialBlock"

-- | A significant lexeme — delimiter, sigil, structural punctuation, literal, or
-- | a whole-tag form (comment / set-delimiter / raw block). Whitespace and the
-- | host-text ocean are *not* lexemes; they are `Trivia`.
-- |
-- | Deliberate divergences from `FlatBars.Token`, all toward a finer-grained,
-- | LSP-friendly stream: brackets `[` `]` and the path separators `.` (`Dot`)
-- | and `/` (`Slash`) are their own lexemes (L3: paths are segmented), and
-- | raw-block fences are coarse (one lexeme per fence — an edge form).
data Lexeme
  = Open -- {{   (also the opener under custom delimiters)
  | OpenTriple -- {{{
  | OpenRaw -- {{{{ … }}}}  (whole opening or closing fence; coarse)
  | CloseTag -- }}
  | CloseTriple -- }}}
  | CloseRaw -- }}}}
  | Trim -- ~
  | Sigil Sigil
  | LBracket -- [
  | RBracket -- ]
  | LParen -- (
  | RParen -- )
  | Dot -- . — a path separator (L3: paths are segmented, not one ident)
  | Slash -- / — a path separator (under infixArith, `/` is an Op instead)
  | Ident String -- a single path segment / name (no `.` or `/`; see identChar)
  | Str String -- a quoted string literal
  | Num Number -- a numeric literal
  | Op String -- an operator lexeme (meaning-free; MaxBars decides)
  | Comment String -- {{! … }} / {{!-- … --}}
  | SetDelimiter String String -- {{=open close=}} (mutates the active pair)
  | RawBody String -- the verbatim body between raw-block fences
  | Invalid String -- recovery: a diagnostic message for the malformed span
  | Eof -- synthetic end token; its leading trivia is the trailing ocean

derive instance eqLexeme :: Eq Lexeme

instance showLexeme :: Show Lexeme where
  show = case _ of
    Open -> "Open"
    OpenTriple -> "OpenTriple"
    OpenRaw -> "OpenRaw"
    CloseTag -> "CloseTag"
    CloseTriple -> "CloseTriple"
    CloseRaw -> "CloseRaw"
    Trim -> "Trim"
    Sigil s -> "Sigil " <> show s
    LBracket -> "LBracket"
    RBracket -> "RBracket"
    LParen -> "LParen"
    RParen -> "RParen"
    Dot -> "Dot"
    Slash -> "Slash"
    Ident s -> "Ident " <> show s
    Str s -> "Str " <> show s
    Num n -> "Num " <> show n
    Op s -> "Op " <> show s
    Comment s -> "Comment " <> show s
    SetDelimiter o c -> "SetDelimiter " <> show o <> " " <> show c
    RawBody s -> "RawBody " <> show s
    Invalid s -> "Invalid " <> show s
    Eof -> "Eof"

-- | A lexeme with its span and the leading trivia accumulated before it.
type LexToken = { lexeme :: Lexeme, span :: Span, leading :: Array (Spanned Trivia) }

-- | The flat, intermediate stream a lexer emits before trivia is folded onto
-- | the following lexeme. Exposed mainly for debugging/tests.
data Piece
  = Triv (Spanned Trivia)
  | Lex (Spanned Lexeme)

derive instance eqPiece :: Eq Piece

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------

-- | `open`/`close` seed the active delimiter pair (set-delimiters may change it
-- | mid-stream). `infixArith` mirrors `FlatBars.Token.LexOptions`: off, the
-- | arithmetic characters `+ - * / ?` stay *identifier* characters; on, they
-- | lex as operators (and `/` becomes the division `Op` rather than `Slash`).
type LexConfig = { open :: String, close :: String, infixArith :: Boolean }

defaultLexConfig :: LexConfig
defaultLexConfig = { open: "{{", close: "}}", infixArith: false }

--------------------------------------------------------------------------------
-- Pieces → tokens (attach leading trivia; synthesize the EOF token)
--------------------------------------------------------------------------------

-- | Fold the ordered piece stream into tokens, attaching each run of trivia as
-- | the *leading* trivia of the lexeme that follows it, and ending with a
-- | synthetic `Eof` whose leading trivia is the trailing ocean. Both
-- | accumulators are reversed `List`s (O(1) prepend) flushed once — `Array.snoc`
-- | in a fold is O(n) per token and would make the whole pass O(n²).
assemble :: Array Piece -> Array LexToken
assemble pieces =
  let
    -- positions are 1-based in line/column and 0-based in index.
    acc = foldl step { tokens: Nil, buf: Nil, lastEnd: { index: 0, line: 1, column: 1 } } pieces
    eofTok = { lexeme: Eof, span: { start: acc.lastEnd, end: acc.lastEnd }, leading: flush acc.buf }
  in
    Array.fromFoldable (List.reverse (eofTok : acc.tokens))
  where
  flush = Array.fromFoldable <<< List.reverse

  step acc = case _ of
    Triv t -> acc { buf = t : acc.buf, lastEnd = t.span.end }
    Lex l ->
      acc
        { tokens = { lexeme: l.value, span: l.span, leading: flush acc.buf } : acc.tokens
        , buf = Nil
        , lastEnd = l.span.end
        }

--------------------------------------------------------------------------------
-- Views / LSP feed
--------------------------------------------------------------------------------

-- | The bare lexeme sequence (trivia and EOF dropped) — handy for assertions.
lexemes :: Array LexToken -> Array Lexeme
lexemes = Array.mapMaybe \t -> case t.lexeme of
  Eof -> Nothing
  l -> Just l

-- | The ADR-017 semantic-token *type* a lexeme would carry. Structural braces
-- | return `Nothing`: the LSP stays silent there and lets the TextMate grammar
-- | paint the familiar Handlebars braces (see `lspEmits` for what the LSP
-- | actually emits as a correction).
semanticTokenType :: Lexeme -> Maybe String
semanticTokenType = case _ of
  Ident _ -> Just "variable"
  Str _ -> Just "string"
  Num _ -> Just "number"
  Op _ -> Just "operator"
  Comment _ -> Just "comment"
  SetDelimiter _ _ -> Just "keyword"
  Invalid _ -> Just "variable" -- ADR-017 `error` kind: variable + `invalid` modifier
  Sigil s -> Just (sigilType s)
  _ -> Nothing
  where
  sigilType = case _ of
    Partial -> "macro"
    PartialBlock -> "macro"
    _ -> "keyword"

-- | Whether the LSP emits a semantic-token *correction* for this lexeme. Mirrors
-- | ADR-017's sparse `lspEmitKinds` (operator/string/number/set-delimiter, plus
-- | the recovery `error`): the LSP only paints where it knows more than the
-- | stateless grammar.
lspEmits :: Lexeme -> Boolean
lspEmits = case _ of
  Op _ -> true
  Str _ -> true
  Num _ -> true
  SetDelimiter _ _ -> true
  Invalid _ -> true
  _ -> false

--------------------------------------------------------------------------------
-- Lexical character classes & tiny string utilities
--------------------------------------------------------------------------------

isSpace :: Char -> Boolean
isSpace c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

isDigit :: Char -> Boolean
isDigit c = c >= '0' && c <= '9'

isAlpha :: Char -> Boolean
isAlpha c = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')

-- | Single-segment identifier chars, minus the arithmetic characters when
-- | `infixArith` is on. `.`/`/` are NOT here (L3: separate `Dot`/`Slash`
-- | tokens); `@` stays (for `@root`/`@index`); `=` stays (for `key=value`).
identChar :: Boolean -> Char -> Boolean
identChar infixArith c = baseIdent c && not (infixArith && arithChar c)

baseIdent :: Char -> Boolean
baseIdent c =
  isAlpha c || isDigit c
    || c == '_'
    || c == '-'
    || c == '@'
    || c == '+'
    || c == '*'
    || c == '?'
    || c == '='

arithChar :: Char -> Boolean
arithChar c = c == '+' || c == '-' || c == '*' || c == '/' || c == '?'

-- | The string-escape table shared by both lexers.
unescape :: Char -> Maybe Char
unescape = case _ of
  'n' -> Just '\n'
  't' -> Just '\t'
  'r' -> Just '\r'
  '\\' -> Just '\\'
  '"' -> Just '"'
  '\'' -> Just '\''
  _ -> Nothing

-- | Whitespace-separated, non-empty words (set-delimiter parsing).
words :: String -> Array String
words = Array.filter (_ /= "") <<< split (Pattern " ") <<< normalize
  where
  -- collapse tabs/newlines to spaces so `split " "` suffices for the spike
  normalize = SCU.fromCharArray <<< map (\c -> if isSpace c then ' ' else c) <<< SCU.toCharArray

firstWord :: String -> String
firstWord s = case Array.head (words s) of
  Just w -> w
  Nothing -> ""
