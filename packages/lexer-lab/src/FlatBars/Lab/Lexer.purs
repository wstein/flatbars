-- | A standalone, *stateful*, delimiter-level lexer for FlatBars templates,
-- | built on `purescript-parsing` as a design SPIKE (ADR-023 / ADR-017
-- | exploration). It is deliberately **not** wired into the engine — it exists
-- | to evaluate a CST-style tokenizer shape against the hand-written
-- | `FlatBars.Lexer` before any adoption decision.
-- |
-- | Three ideas drive the design:
-- |
-- |  1. **Trivia, leading-only.** A template is mostly *ocean* — the host text
-- |     the tags float in. That ocean is insignificant to the grammar, so it is
-- |     `Trivia` (a `Text` run), as is the whitespace *inside* a tag
-- |     (`Whitespace`). Trivia is never a token of its own; it is attached as
-- |     the **leading** trivia of the lexeme that follows it. There is no
-- |     trailing-trivia channel.
-- |
-- |  2. **EOF carries the tail.** The final token is a synthetic `Eof` whose
-- |     leading trivia is the trailing ocean (everything after the last real
-- |     lexeme). This mirrors `language-cst-parser`'s `TokenEOF pos comments`:
-- |     no token is ever dropped, and the trailing text has a home.
-- |
-- |  3. **State is the delimiter pair.** `{{=A B=}}` set-delimiter tags mutate
-- |     the active `open`/`close` pair for everything that follows — the lexer
-- |     threads that through `State`, which is what makes it genuinely stateful
-- |     rather than a context-free scan.
-- |
-- | Every lexeme carries an absolute code-unit `Span` ({start, end}), so an LSP
-- | semantic-token layer can recover an exact range; `semanticTokenType` maps a
-- | lexeme to the ADR-017 token-vocabulary type it would feed.
module FlatBars.Lab.Lexer
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
  , tokenize
  , lexemes
  , semanticTokenType
  , lspEmits
  ) where

import Prelude

import Control.Alt ((<|>))
import Control.Monad.State (State, runState)
import Control.Monad.State.Class (get, modify_)
import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Either (Either(..))
import Data.Foldable (foldl)
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.Number as Number
import Data.String (Pattern(..), split)
import Data.String.CodeUnits as SCU
import Data.Tuple (Tuple(..))
import Parsing (ParseError, ParserT, Position(..), fail, position, runParserT)
import Parsing.Combinators (choice, notFollowedBy, optionMaybe, try)
import Parsing.Combinators.Array as PA
import Parsing.String (anyChar, char, consumeWith, eof, satisfy, string)

--------------------------------------------------------------------------------
-- Tokens
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
-- | Note the deliberate divergences from `FlatBars.Token`, all in service of
-- | being a finer-grained, LSP-friendly stream:
-- |   * brackets `[` `]` are their own lexemes, not folded into a path ident;
-- |   * raw-block fences are coarse (one lexeme per fence) — a documented spike
-- |     simplification, since fences are an edge form.
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

-- | The flat, intermediate stream the parser emits before trivia is folded onto
-- | the following lexeme. Exposed mainly for debugging/tests.
data Piece
  = Triv (Spanned Trivia)
  | Lex (Spanned Lexeme)

derive instance eqPiece :: Eq Piece

--------------------------------------------------------------------------------
-- Configuration & the lexer monad
--------------------------------------------------------------------------------

-- | `open`/`close` seed the active delimiter pair (set-delimiters may change it
-- | mid-stream). `infixArith` mirrors `FlatBars.Token.LexOptions`: off, the
-- | arithmetic characters `+ - * / ?` stay *identifier* characters (so `../x`,
-- | `a/b`, `partial-block` are one `Ident`); on, they lex as operators.
type LexConfig = { open :: String, close :: String, infixArith :: Boolean }

defaultLexConfig :: LexConfig
defaultLexConfig = { open: "{{", close: "}}", infixArith: false }

-- | The active delimiter pair — the lexer's mutable state.
type LexState = { open :: String, close :: String }

type Lexer = ParserT String (State LexState)

--------------------------------------------------------------------------------
-- Entry point
--------------------------------------------------------------------------------

-- | Tokenize a template. The result always ends with an `Eof` token; a lexical
-- | error (unterminated tag, bad escape, malformed set-delimiter) is `Left`.
tokenize :: LexConfig -> String -> Either ParseError (Array LexToken)
tokenize cfg input =
  case runState (runParserT input program) { open: cfg.open, close: cfg.close } of
    Tuple res _ -> map assemble res
  where
  -- The whole grammar lives in this `where` so every combinator closes over
  -- `cfg` (its `infixArith` flag in particular) without threading it around.

  program :: Lexer (Array Piece)
  program = do
    chunks <- PA.many chunk
    eof
    pure (Array.concat chunks)

  -- One unit of progress: a whole tag, or a maximal run of ocean text. Both
  -- consume at least one character, so `PA.many` terminates exactly at EOF.
  chunk :: Lexer (Array Piece)
  chunk = tagChunk <|> oceanChunk

  ----------------------------------------------------------------------------
  -- Ocean (host text between tags) → leading `Text` trivia
  ----------------------------------------------------------------------------

  oceanChunk :: Lexer (Array Piece)
  oceanChunk = do
    start <- pos
    parts <- PA.many oceanSeg
    if Array.null parts then fail "expected host text"
    else do
      end <- pos
      pure [ Triv { value: Text (joinStr parts), span: { start, end } } ]

  -- A run of ocean is a sequence of segments. `oceanRun` consumes a whole run
  -- of text in ONE slice (via `anyTill`, not character-by-character) up to the
  -- next opener, the next backslash, or EOF — so the common case (a tag-free
  -- stretch of host text) costs one allocation, not one per character.
  -- `escapedOpener` lets `\{{` contribute the opener literally; `backslashChar`
  -- carries a lone backslash through as ordinary text.
  oceanSeg :: Lexer String
  oceanSeg = escapedOpener <|> oceanRun <|> backslashChar

  escapedOpener :: Lexer String
  escapedOpener = do
    st <- get
    try (char '\\' *> string st.open)

  -- Find the next opener or backslash with a single NATIVE `String.indexOf`
  -- (via `consumeWith`), then consume that slice in one step — instead of
  -- `anyTill`, which loops per code point and was ~25× slower than the
  -- incumbent even on pure prose. `consumeWith` still updates line/column over
  -- the consumed slice, so spans stay correct.
  oceanRun :: Lexer String
  oceanRun = do
    st <- get
    consumeWith \rest ->
      let
        stop = oceanStopIndex st.open rest
      in
        if stop == 0 then Left "no host text here"
        else Right
          { value: SCU.take stop rest
          , consumed: SCU.take stop rest
          , remainder: SCU.drop stop rest
          }

  backslashChar :: Lexer String
  backslashChar = char '\\' $> "\\"

  ----------------------------------------------------------------------------
  -- Tags
  ----------------------------------------------------------------------------

  tagChunk :: Lexer (Array Piece)
  tagChunk = do
    st <- get
    choice $ map try $
      [ setDelimTag st.open st.close ] <>
        if st.open == "{{" && st.close == "}}" then
          [ rawBlockTag, longCommentTag, shortCommentTag, tripleTag, doubleTag ]
        else [ simpleTag st.open st.close ]

  -- {{=open close=}} — parses the two delimiter words, MUTATES the active pair,
  -- and emits a single whole-tag lexeme. This is the lexer's stateful core.
  setDelimTag :: String -> String -> Lexer (Array Piece)
  setDelimTag open close = do
    start <- pos
    _ <- string (open <> "=")
    body <- charsUntil ("=" <> close)
    _ <- string ("=" <> close)
    end <- pos
    case words body of
      [ o, c ] -> do
        modify_ (_ { open = o, close = c })
        pure [ Lex { value: SetDelimiter o c, span: { start, end } } ]
      _ -> fail "set-delimiter expects exactly two whitespace-separated delimiters"

  -- {{!-- … --}} and {{! … }} both collapse to one `Comment` lexeme.
  longCommentTag :: Lexer (Array Piece)
  longCommentTag = wholeTag "{{!--" "--}}" Comment

  shortCommentTag :: Lexer (Array Piece)
  shortCommentTag = wholeTag "{{!" "}}" Comment

  -- A single-lexeme tag whose interior is captured verbatim as a string.
  wholeTag :: String -> String -> (String -> Lexeme) -> Lexer (Array Piece)
  wholeTag open close mk = do
    start <- pos
    _ <- string open
    body <- charsUntil close
    _ <- string close
    end <- pos
    pure [ Lex { value: mk body, span: { start, end } } ]

  tripleTag :: Lexer (Array Piece)
  tripleTag = delimitedTag "{{{" "}}}" OpenTriple CloseTriple false

  doubleTag :: Lexer (Array Piece)
  doubleTag = delimitedTag "{{" "}}" Open CloseTag true

  -- A tag under custom (set-)delimiters: opener, optional sigil, interior,
  -- closer. The reduced grammar (no triple/raw/`~`), per ADR-015.
  simpleTag :: String -> String -> Lexer (Array Piece)
  simpleTag open close = delimitedTag open close Open CloseTag false

  -- The shared open/interior/close shape. `allowTrim` enables the `~`
  -- whitespace-control lexeme (only the default `{{ }}`/`{{{ }}}` forms).
  delimitedTag :: String -> String -> Lexeme -> Lexeme -> Boolean -> Lexer (Array Piece)
  delimitedTag open close openL closeL allowTrim = do
    os <- pos
    _ <- string open
    oe <- pos
    trimL <- if allowTrim then trimOpt else pure []
    sig <- sigilOpt
    inner <- interiorPieces close
    trimR <- if allowTrim then trimOpt else pure []
    cs <- pos
    _ <- string close
    ce <- pos
    pure $ Array.concat
      [ [ Lex { value: openL, span: { start: os, end: oe } } ]
      , trimL
      , sig
      , inner
      , trimR
      , [ Lex { value: closeL, span: { start: cs, end: ce } } ]
      ]

  -- A raw block `{{{{name}}}} body {{{{/name}}}}`. Fences are emitted coarsely
  -- (one `OpenRaw`/`CloseRaw` lexeme each); the body is captured verbatim as a
  -- `RawBody`. The closing fence is name-matched, like `FlatBars.Lexer`.
  rawBlockTag :: Lexer (Array Piece)
  rawBlockTag = do
    fos <- pos
    _ <- string "{{{{"
    _ <- optionMaybe (char '#')
    head <- charsUntil "}}}}"
    _ <- string "}}}}"
    foe <- pos
    let closeFence = "{{{{/" <> firstWord head <> "}}}}"
    bs <- pos
    body <- charsUntil closeFence
    be <- pos
    _ <- string closeFence
    fe <- pos
    pure
      [ Lex { value: OpenRaw, span: { start: fos, end: foe } }
      , Lex { value: RawBody body, span: { start: bs, end: be } }
      , Lex { value: CloseRaw, span: { start: be, end: fe } }
      ]

  ----------------------------------------------------------------------------
  -- Tag interior
  ----------------------------------------------------------------------------

  trimOpt :: Lexer (Array Piece)
  trimOpt = (Array.singleton <$> spannedLex (char '~' $> Trim)) <|> pure []

  sigilOpt :: Lexer (Array Piece)
  sigilOpt = (Array.singleton <$> spannedLex sigil) <|> pure []

  sigil :: Lexer Lexeme
  sigil = choice
    [ try (string "#*") $> Sigil Decorator
    , try (string "#>") $> Sigil PartialBlock
    , char '#' $> Sigil Section
    , char '^' $> Sigil Inverse
    , char '/' $> Sigil Close
    , char '>' $> Sigil Partial
    , char '&' $> Sigil Unescaped
    , char '$' $> Sigil BlockDef
    , char '<' $> Sigil Parent
    ]

  -- Interior tokens up to (but not consuming) the active close delimiter. The
  -- `notFollowedBy close` guard makes close detection robust even when a
  -- delimiter character (`%` in `%>`, say) would otherwise lex as an operator.
  interiorPieces :: String -> Lexer (Array Piece)
  interiorPieces close = Array.concat <$> PA.many do
    _ <- notFollowedBy (string close)
    wsPiece <|> (Array.singleton <$> spannedLex interiorLexeme)

  wsPiece :: Lexer (Array Piece)
  wsPiece = do
    start <- pos
    w <- run1 isSpace
    end <- pos
    pure [ Triv { value: Whitespace w, span: { start, end } } ]

  interiorLexeme :: Lexer Lexeme
  interiorLexeme = choice
    [ char '[' $> LBracket
    , char ']' $> RBracket
    , char '(' $> LParen
    , char ')' $> RParen
    , Str <$> try stringLit
    , Num <$> try numberLit
    , Op <$> try operatorLex
    -- L3: `.`/`/` are path separators, their own tokens (so `items.[0]` carries
    -- no dangling dot). Placed after operatorLex so that under infixArith `/`
    -- is consumed there as the division Op instead.
    , char '.' $> Dot
    , char '/' $> Slash
    , Ident <$> identLex
    ]

  operatorLex :: Lexer String
  operatorLex = choice (map (try <<< string) ops)
    where
    ops =
      [ "&&", "||", "==", "!=", "<=", ">=", "<", ">", "!", "|" ]
        <> if cfg.infixArith then [ "??", "+", "-", "*", "/", "%" ] else []

  identLex :: Lexer String
  identLex = run1 (identChar cfg.infixArith)

  numberLit :: Lexer Number
  numberLit = do
    sign <- (char '-' $> "-") <|> pure ""
    intPart <- run1 isDigit
    frac <- optionMaybe (char '.' *> run1 isDigit)
    let s = sign <> intPart <> maybe "" ("." <> _) frac
    case Number.fromString s of
      Just n -> pure n
      Nothing -> fail ("malformed number '" <> s <> "'")

  stringLit :: Lexer String
  stringLit = do
    q <- char '"' <|> char '\''
    cs <- PA.many (strChar q)
    _ <- char q
    pure (SCU.fromCharArray cs)

  strChar :: Char -> Lexer Char
  strChar q = (char '\\' *> escChar) <|> satisfy (\c -> c /= q && c /= '\\')

  escChar :: Lexer Char
  escChar = do
    c <- anyChar
    case c of
      'n' -> pure '\n'
      't' -> pure '\t'
      'r' -> pure '\r'
      '\\' -> pure '\\'
      '"' -> pure '"'
      '\'' -> pure '\''
      _ -> fail "invalid string escape"

  ----------------------------------------------------------------------------
  -- Small parser helpers
  ----------------------------------------------------------------------------

  -- The current source position (index + line + column), for span endpoints.
  pos :: Lexer SourcePos
  pos = do
    Position p <- position
    pure p

  spannedLex :: Lexer Lexeme -> Lexer Piece
  spannedLex p = do
    start <- pos
    v <- p
    end <- pos
    pure (Lex { value: v, span: { start, end } })

  -- A maximal run (length >= 1) of characters satisfying `pred`.
  run1 :: (Char -> Boolean) -> Lexer String
  run1 pred = (SCU.fromCharArray <<< NEA.toArray) <$> PA.many1 (satisfy pred)

  -- All characters up to (not including) the next occurrence of `pat`. Does not
  -- consume `pat`; the caller does, and fails on an unterminated tag.
  charsUntil :: String -> Lexer String
  charsUntil pat = do
    cs <- PA.many (notFollowedBy (string pat) *> anyChar)
    pure (SCU.fromCharArray cs)

--------------------------------------------------------------------------------
-- Pieces → tokens (attach leading trivia; synthesize the EOF token)
--------------------------------------------------------------------------------

-- | Both accumulators are reversed `List`s (O(1) prepend) flushed once with a
-- | single reverse, exactly as `FlatBars.Lexer` does — `Array.snoc` in a fold
-- | is O(n) per token and would make the whole pass O(n²) (it did; see the
-- | benchmark in `bench.mjs`).
assemble :: Array Piece -> Array LexToken
assemble pieces =
  let
    -- `parsing` positions are 1-based in line/column and 0-based in index.
    acc = foldl step { tokens: Nil, buf: Nil, lastEnd: { index: 0, line: 1, column: 1 } } pieces
    eofTok = { lexeme: Eof, span: { start: acc.lastEnd, end: acc.lastEnd }, leading: flush acc.buf }
  in
    Array.fromFoldable (List.reverse (eofTok : acc.tokens))
  where
  -- Trivia is buffered reversed, so flush = reverse-then-Array.
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
-- | ADR-017's sparse `lspEmitKinds` (operator/string/number/set-delimiter): the
-- | LSP only paints where it knows more than the stateless grammar.
lspEmits :: Lexeme -> Boolean
lspEmits = case _ of
  Op _ -> true
  Str _ -> true
  Num _ -> true
  SetDelimiter _ _ -> true
  Invalid _ -> true
  _ -> false

--------------------------------------------------------------------------------
-- Character classes & tiny string utilities
--------------------------------------------------------------------------------

isSpace :: Char -> Boolean
isSpace c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

isDigit :: Char -> Boolean
isDigit c = c >= '0' && c <= '9'

isAlpha :: Char -> Boolean
isAlpha c = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')

-- | Mirrors `FlatBars.Token.isIdentChar`/`identChar`: the path/name continuation
-- | set, minus the arithmetic characters when `infixArith` is on.
identChar :: Boolean -> Char -> Boolean
identChar infixArith c = baseIdent c && not (infixArith && arithChar c)

-- | Identifier (single path segment) chars. `.` and `/` are NOT here (L3: they
-- | are separate `Dot`/`Slash` tokens). `@` stays (for `@root`/`@index`); `=`
-- | stays (for `key=value` hash args).
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

joinStr :: Array String -> String
joinStr = foldl (<>) ""

-- | The code-unit index of the next ocean stopper — the active opener or a
-- | backslash — or the input length if neither occurs. Uses native
-- | `String.indexOf` (code units, matching `SourcePos.index`) so a tag-free
-- | stretch is skipped in one native call rather than a per-character scan.
oceanStopIndex :: String -> String -> Int
oceanStopIndex open input =
  let
    len = SCU.length input
    io = fromMaybe len (SCU.indexOf (Pattern open) input)
    ib = fromMaybe len (SCU.indexOf (Pattern "\\") input)
  in
    min io ib
