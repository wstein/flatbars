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
  ( module FlatBars.Lab.Lexer.Types -- re-export the shared token model
  , tokenize
  ) where

import Prelude

import Control.Alt ((<|>))
import Control.Monad.State (State, runState)
import Control.Monad.State.Class (get, modify_)
import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Either (Either(..))
import Data.Foldable (foldl)
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.Number as Number
import Data.String (Pattern(..))
import Data.String.CodeUnits as SCU
import Data.Tuple (Tuple(..))
import FlatBars.Lab.Lexer.Types (LexConfig, LexToken, Lexeme(..), Piece(..), Sigil(..), SourcePos, Span, Spanned, Trivia(..), assemble, defaultLexConfig, firstWord, identChar, isDigit, isSpace, lexemes, lspEmits, semanticTokenType, unescape, words)
import Parsing (ParseError, ParserT, Position(..), fail, position, runParserT)
import Parsing.Combinators (choice, notFollowedBy, optionMaybe, try)
import Parsing.Combinators.Array as PA
import Parsing.String (anyChar, char, consumeWith, eof, satisfy, string)

--------------------------------------------------------------------------------
-- Configuration & the lexer monad
--------------------------------------------------------------------------------

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
      -- set-delimiters are a dialect gate (ADR-015): only MinBars (mustacheDelims)
      -- recognises `{{=A B=}}`; otherwise it is an ordinary separator.
      (if cfg.mustacheDelims then [ setDelimTag st.open st.close ] else []) <>
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
    case unescape c of
      Just e -> pure e
      Nothing -> fail "invalid string escape"

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
