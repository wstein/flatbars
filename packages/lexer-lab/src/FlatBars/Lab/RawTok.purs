-- | Phase 2/3 of the migration evaluation: adapt the hand lexer's token stream
-- | into the engine's `RawTok` stream — the exact output `FlatBars.Lexer`'s
-- | `tokenizeTemplate` produces, including `~` whitespace control. This is the
-- | migration-realistic shape: swap the *lexer*, keep the proven *parser*. If
-- | `toRawToks src == tokenizeTemplate src`, then feeding either into the
-- | engine's `trimStandalone` + `buildFromTokens` yields identical results, so
-- | standalone-whitespace, header directives, raw blocks, and recovering parse
-- | are inherited for free. `parse` demonstrates exactly that.
-- |
-- | `~` is the only behaviour this module reproduces (the engine applies it in
-- | the lexer); standalone trimming is deferred to the reused `trimStandalone`.
module FlatBars.Lab.RawTok
  ( toRawToks
  , parse
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..))
import Data.String.CodeUnits as SCU
import FlatBars.Error (ParseError(..))
import FlatBars.Lab.Lexer.Types (LexToken, Trivia(..), defaultLexConfig)
import FlatBars.Lab.Lexer.Types (Lexeme(..)) as T
import FlatBars.Lab.Lexer.Types (Sigil(..)) as LS
import FlatBars.Lab.LexerHand (tokenize) as Hand
import FlatBars.Lexer (RawTok(..), trimStandalone) as E
import FlatBars.Parser (buildFromTokens, defaultParseOptions)
import FlatBars.Syntax (Sigil(..)) as Syn
import FlatBars.Syntax (Template)

-- | The hand lexer's tokens, rendered as the engine's `RawTok` stream.
toRawToks :: String -> Either ParseError (Array E.RawTok)
toRawToks src = case Hand.tokenize defaultLexConfig src of
  Left _ -> Left (UnterminatedTag 0)
  Right toks -> Right (build src toks)

-- | Parse via the adapter, reusing the engine's whitespace + tree builder — the
-- | same path `FlatBars.parse` takes, only the lexer swapped.
parse :: String -> Either ParseError Template
parse src = do
  raw <- toRawToks src
  buildFromTokens defaultParseOptions (E.trimStandalone [ "else", "elif" ] raw)

--------------------------------------------------------------------------------

isWs :: Char -> Boolean
isWs c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

trimStartWs :: String -> String
trimStartWs s = SCU.fromCharArray (Array.dropWhile isWs (SCU.toCharArray s))

trimEndWs :: String -> String
trimEndWs s =
  SCU.fromCharArray (Array.reverse (Array.dropWhile isWs (Array.reverse (SCU.toCharArray s))))

build :: String -> Array LexToken -> Array E.RawTok
build src toks = Array.fromFoldable (List.reverse (go 0 false Nil))
  where
  sub a b = SCU.take (b - a) (SCU.drop a src)

  spanOf j = case Array.index toks j of
    Just t -> t.span
    Nothing -> { start: zero3, end: zero3 }

  leadingText j = case Array.index toks j of
    Just t -> Array.foldl addText "" t.leading
    Nothing -> ""

  addText acc tr = case tr.value of
    Text s -> acc <> s
    _ -> acc

  isTrim j = case Array.index toks j of
    Just { lexeme: T.Trim } -> true
    _ -> false

  isCloseLex closeLex j = case Array.index toks j of
    Just t -> t.lexeme == closeLex
    Nothing -> false

  findClose closeLex j
    | j >= Array.length toks = j
    | isCloseLex closeLex j = j
    | otherwise = findClose closeLex (j + 1)

  -- `pend` = the previous tag had a trailing `~`, so trim the start of the
  -- content that precedes the next tag.
  go :: Int -> Boolean -> List E.RawTok -> List E.RawTok
  go i pend acc = case Array.index toks i of
    Nothing -> acc
    Just tok -> case tok.lexeme of
      T.Eof -> flushContent (leadingText i) pend false acc
      T.Comment _ -> comment i pend acc
      T.SetDelimiter _ _ ->
        let
          acc1 = flushContent (leadingText i) pend false acc
        in
          go (i + 1) false (E.RSetDelim (coreSpan (spanOf i)) : acc1)
      T.OpenRaw -> rawBlock i pend acc
      T.OpenTriple -> tag i pend acc T.CloseTriple
      T.Open -> tag i pend acc T.CloseTag
      _ -> go (i + 1) pend acc

  -- Flush a content run with the pending leading trim and an optional trailing
  -- trim (from the upcoming tag's `~`); drop it when empty (engine parity).
  flushContent :: String -> Boolean -> Boolean -> List E.RawTok -> List E.RawTok
  flushContent s pend trimL acc =
    let
      s1 = if pend then trimStartWs s else s
      s2 = if trimL then trimEndWs s1 else s1
    in
      if s2 == "" then acc else E.RContent s2 : acc

  tag :: Int -> Boolean -> List E.RawTok -> T.Lexeme -> List E.RawTok
  tag i pend acc closeLex =
    let
      closeIdx = findClose closeLex (i + 1)
      trimL = isTrim (i + 1)
      msig = sigilAfter (if trimL then i + 2 else i + 1)
      trimR = closeIdx > 0 && isTrim (closeIdx - 1)
      base = interiorBase i trimL msig
      intEnd = if trimR then (spanOf (closeIdx - 1)).start.index else (spanOf closeIdx).start.index
      interior = sub base intEnd
      span = coreSpan { start: (spanOf i).start, end: (spanOf closeIdx).end }
      acc1 = flushContent (leadingText i) pend trimL acc
      rawTok = case closeLex of
        T.CloseTriple -> E.ROutput span base interior
        _ -> case map _.sig msig of
          Just LS.Unescaped -> E.RAmp span base interior
          Just LS.Close -> E.RClose span base interior
          Just LS.Partial -> E.RSep span base interior
          Just s | Just syn <- blockSigil s -> E.ROpen span syn base interior
          _ -> E.RSep span base interior
    in
      go (closeIdx + 1) trimR (rawTok : acc1)

  -- The interior's source offset, after the opener and any leading `~`/sigil.
  -- `>` (Partial) keeps its sigil in the interior (the engine's `RSep` does).
  interiorBase i trimL = case _ of
    Just { sig: LS.Partial, idx } -> (spanOf idx).start.index
    Just { idx } -> (spanOf idx).end.index
    Nothing -> if trimL then (spanOf (i + 1)).end.index else (spanOf i).end.index

  sigilAfter j = case Array.index toks j of
    Just { lexeme: T.Sigil s } -> Just { sig: s, idx: j }
    _ -> Nothing

  -- {{! … }} short comment → RComment; {{!-- … --}} long comment → dropped
  -- (the engine's default config does not keep long comments).
  comment :: Int -> Boolean -> List E.RawTok -> List E.RawTok
  comment i pend acc =
    let
      sp = spanOf i
      open = sub sp.start.index sp.end.index
      acc1 = flushContent (leadingText i) pend false acc
    in
      if SCU.take 5 open == "{{!--" then go (i + 1) false acc1 -- long comment dropped
      else
        let
          base = sp.start.index + 3 -- after "{{!"
          interior = sub base (sp.end.index - 2) -- before "}}"
        in
          go (i + 1) false (E.RComment (coreSpan sp) base interior : acc1)

  -- OpenRaw / RawBody / CloseRaw (3 lexemes) → one RRaw.
  rawBlock :: Int -> Boolean -> List E.RawTok -> List E.RawTok
  rawBlock i pend acc =
    let
      openSp = spanOf i
      closeSp = spanOf (i + 2)
      hash = SCU.take 5 (sub openSp.start.index openSp.end.index) == "{{{{#"
      headStart = openSp.start.index + (if hash then 5 else 4)
      head = sub headStart (openSp.end.index - 4) -- before the opening "}}}}"
      body = case Array.index toks (i + 1) of
        Just { lexeme: T.RawBody b } -> b
        _ -> ""
      span = coreSpan { start: openSp.start, end: closeSp.end }
      acc1 = flushContent (leadingText i) pend false acc
    in
      go (i + 3) false (E.RRaw span hash headStart head body : acc1)

zero3 :: { index :: Int, line :: Int, column :: Int }
zero3 = { index: 0, line: 1, column: 1 }

-- Lexer span (SourcePos endpoints) → core Span (code-unit offsets).
coreSpan
  :: { start :: { index :: Int, line :: Int, column :: Int }
     , end :: { index :: Int, line :: Int, column :: Int }
     }
  -> { start :: Int, end :: Int }
coreSpan s = { start: s.start.index, end: s.end.index }

blockSigil :: LS.Sigil -> Maybe Syn.Sigil
blockSigil = case _ of
  LS.Section -> Just Syn.Section
  LS.Inverse -> Just Syn.Inverse
  LS.Parent -> Just Syn.Parent
  LS.BlockDef -> Just Syn.BlockDef
  LS.Decorator -> Just Syn.Decorator
  LS.PartialBlock -> Just Syn.PartialBlock
  _ -> Nothing
