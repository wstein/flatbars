-- | A *structural* parser over the hand lexer's token stream — phase 1 of the
-- | migration evaluation (see README). It walks `FlatBars.Lab.LexerHand`'s
-- | `LexToken`s and builds the engine's `FlatBars.Syntax` tree (Content / Output
-- | / Block / Sep), matching the behaviour of `FlatBars.parse` under
-- | `defaultParseOptions`. A parity test asserts the two produce the same
-- | (span-erased) AST.
-- |
-- | Division of labour: the new lexer supplies the *structure* — where tags and
-- | blocks begin/end, which sigil opens a block. Each tag's *interior* is sliced
-- | from the original source and handed to the engine's own interior tokenizer +
-- | expression grammar (`FlatBars.Token.tokenizeInterior` + `FlatBars.Expr`), so
-- | the `Expr` is identical by construction and path reassembly (the L3 concern)
-- | is free. This phase deliberately omits standalone/`~` whitespace trimming,
-- | header directives, raw blocks, and `NodeError` recovery — tracked as phase 2.
module FlatBars.Lab.Parser
  ( parse
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Foldable (foldl)
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..))
import Data.String (trim)
import Data.String.CodeUnits as SCU
import FlatBars.Error (ParseError(..))
import FlatBars.Expr as Expr
import FlatBars.Lab.Lexer.Types (LexToken, defaultLexConfig)
import FlatBars.Lab.Lexer.Types (Lexeme(..), Trivia(..)) as T
import FlatBars.Lab.Lexer.Types (Sigil(..)) as LS
import FlatBars.Lab.LexerHand (tokenize) as Hand
import FlatBars.Span (Span)
import FlatBars.Syntax (Expr(..), Node(..), Template)
import FlatBars.Syntax (Sigil(..)) as Syn
import FlatBars.Token (PosToken, Token(..), defaultLexOptions, tokenizeInterior)

-- | Parse source into the engine's `Template`, fail-fast (matching `parse`).
parse :: String -> Either ParseError Template
parse src = case Hand.tokenize defaultLexConfig src of
  Left _ -> Left (UnterminatedTag 0) -- phase 1 targets well-formed input
  Right toks -> do
    r <- seqB src toks 0
    case r.stop of
      StopEOF -> Right (Array.fromFoldable (List.reverse r.nodes))
      StopClose name _ -> Left (MismatchedBlock "<none>" name 0)

data Stop = StopEOF | StopClose String Int

type SeqResult = { nodes :: List Node, stop :: Stop, next :: Int }

-- | Walk the token stream from `i`, accumulating sibling nodes (reversed) until
-- | EOF or a close tag. Block opens recurse for their body.
seqB :: String -> Array LexToken -> Int -> Either ParseError SeqResult
seqB src toks = go Nil
  where
  sub a b = SCU.take (b - a) (SCU.drop a src)

  go :: List Node -> Int -> Either ParseError SeqResult
  go acc i = case Array.index toks i of
    Nothing -> Right { nodes: acc, stop: StopEOF, next: i }
    Just tok ->
      let
        acc1 = prependContent tok.leading acc
      in
        case tok.lexeme of
          T.Eof -> Right { nodes: acc1, stop: StopEOF, next: i }
          T.Comment _ -> go acc1 (i + 1)
          T.SetDelimiter _ _ -> go acc1 (i + 1)
          T.OpenTriple -> tag acc1 i T.CloseTriple Nothing
          T.Open -> tag acc1 i T.CloseTag (sigilAt (i + 1))
          _ -> go acc1 (i + 1) -- defensive: stray in-tag token

  -- The sigil token immediately after an opener (skipping a leading `~`).
  sigilAt :: Int -> Maybe { sig :: LS.Sigil, idx :: Int }
  sigilAt j =
    let
      j' = if isTrim j then j + 1 else j
    in
      case Array.index toks j' of
        Just { lexeme: T.Sigil s } -> Just { sig: s, idx: j' }
        _ -> Nothing

  isTrim j = case Array.index toks j of
    Just { lexeme: T.Trim } -> true
    _ -> false

  -- Read a whole tag opened at `i`, classify it, emit/recurse.
  tag
    :: List Node
    -> Int
    -> T.Lexeme
    -> Maybe { sig :: LS.Sigil, idx :: Int }
    -> Either ParseError SeqResult
  tag acc i closeLex msig =
    case Array.index toks i <#> _.span, findClose closeLex (i + 1) of
      Just oSpan, Just closeIdx ->
        let
          cSpan = spanOf closeIdx
          tagSpan = { start: oSpan.start.index, end: cSpan.end.index } :: Span
          -- interior source range: after opener (and any sigil/trim), before close
          intStart = interiorStart i oSpan msig
          intEnd = cSpan.start.index
          interior = sub intStart intEnd
        in
          dispatch acc i closeIdx tagSpan intStart interior msig
      _, _ -> Left (UnterminatedTag (i))

  dispatch
    :: List Node
    -> Int
    -> Int
    -> Span
    -> Int
    -> String
    -> Maybe { sig :: LS.Sigil, idx :: Int }
    -> Either ParseError SeqResult
  dispatch acc i closeIdx tagSpan base interior msig = case map _.sig msig of
    -- {{/name}} — close the enclosing block.
    Just LS.Close -> do
      h <- headed base interior
      Right { nodes: acc, stop: StopClose h.name (closeIdx + 1), next: closeIdx + 1 }
    -- {{&x}} — unescaped output.
    Just LS.Unescaped -> do
      e <- outputExpr base tagSpan interior
      go (Output tagSpan e : acc) (closeIdx + 1)
    -- {{> name}} — a separator headed by `>` (the engine's partial convention).
    -- The interior slice already includes the leading `>` (see interiorStart).
    Just LS.Partial -> do
      h <- headed base interior
      go (Sep tagSpan h.name h.args : acc) (closeIdx + 1)
    -- block opens: {{#}} {{^}} {{<}} {{$}} {{#*}} {{#>}}
    Just s | Just synSig <- blockSigil s -> block acc tagSpan synSig base interior (closeIdx + 1)
    -- a sigil we don't translate here (shouldn't happen) — treat as separator.
    _ -> sepOrOutput acc i closeIdx tagSpan base interior

  -- {{{x}}} and the no-sigil {{x}}.
  sepOrOutput :: List Node -> Int -> Int -> Span -> Int -> String -> Either ParseError SeqResult
  sepOrOutput acc i closeIdx tagSpan base interior =
    case Array.index toks i of
      Just { lexeme: T.OpenTriple } -> do
        e <- outputExpr base tagSpan interior
        go (Output tagSpan e : acc) (closeIdx + 1)
      _ -> case headed base interior of
        Right h -> go (Sep tagSpan h.name h.args : acc) (closeIdx + 1)
        -- a bare literal separator ({{42}}, {{"x"}}) is output, like {{{42}}}.
        Left (HeadNotIdent _) | trim interior /= "" -> do
          e <- outputExpr base tagSpan interior
          go (Output tagSpan e : acc) (closeIdx + 1)
        Left e -> Left e

  -- A block open: parse the head, recurse for the body, match the close name.
  block :: List Node -> Span -> Syn.Sigil -> Int -> String -> Int -> Either ParseError SeqResult
  block acc tagSpan sig base interior bodyStart = do
    h <- headed base interior
    inner <- seqB src toks bodyStart
    let node = Block tagSpan sig h.name h.args (Array.fromFoldable (List.reverse inner.nodes))
    case inner.stop of
      StopEOF -> Left (MismatchedBlock h.name "<eof>" tagSpan.start)
      StopClose closed pos
        | closed == h.name -> go (node : acc) pos
        | otherwise -> Left (MismatchedBlock h.name closed tagSpan.start)

  -- The interior's start offset, after the opener and any leading `~`/sigil.
  -- For `>` (Partial) the sigil is included in the interior (the engine reads it
  -- as the head), so we start at the opener's end and re-prepend `>` in dispatch.
  interiorStart i oSpan = case _ of
    Just { sig: LS.Partial } -> afterOpenTrim i oSpan
    Just { idx } -> (spanOf idx).end.index
    Nothing -> afterOpenTrim i oSpan

  afterOpenTrim i oSpan =
    if isTrim (i + 1) then (spanOf (i + 1)).end.index
    else oSpan.end.index

  spanOf j = case Array.index toks j of
    Just t -> t.span
    Nothing -> { start: zeroPos, end: zeroPos }

  findClose :: T.Lexeme -> Int -> Maybe Int
  findClose closeLex j = case Array.index toks j of
    Nothing -> Nothing
    Just t
      | t.lexeme == closeLex -> Just j
      | otherwise -> findClose closeLex (j + 1)

zeroPos :: { index :: Int, line :: Int, column :: Int }
zeroPos = { index: 0, line: 1, column: 1 }

-- Map a lexer block-sigil to the engine's Syntax sigil (Nothing = not a block).
blockSigil :: LS.Sigil -> Maybe Syn.Sigil
blockSigil = case _ of
  LS.Section -> Just Syn.Section
  LS.Inverse -> Just Syn.Inverse
  LS.Parent -> Just Syn.Parent
  LS.BlockDef -> Just Syn.BlockDef
  LS.Decorator -> Just Syn.Decorator
  LS.PartialBlock -> Just Syn.PartialBlock
  _ -> Nothing

-- Content nodes from a token's leading trivia (the host-text ocean runs). Row-
-- polymorphic in the span (trivia carries the lexer's SourcePos span, not core's).
prependContent :: forall r. Array { value :: T.Trivia | r } -> List Node -> List Node
prependContent leading acc = foldl step acc leading
  where
  step a t = case t.value of
    T.Text s -> Content s : a
    _ -> a

--------------------------------------------------------------------------------
-- Interior expression parsing — delegated to the engine grammar (exact by
-- construction), mirroring FlatBars.Parser.outputExpr / headed / partialHead.
--------------------------------------------------------------------------------

outputExpr :: Int -> Span -> String -> Either ParseError Expr
outputExpr base span s
  | trim s == "" = Left (EmptyOutput span.start)
  | otherwise = tokenizeInterior defaultLexOptions base s >>= Expr.parseExpr

headed :: Int -> String -> Either ParseError { name :: String, args :: Array Expr }
headed base s
  | trim s == "" = Left (HeadNotIdent base)
  | otherwise =
      case (partialHead <$> tokenizeInterior defaultLexOptions base s) >>= Expr.parseExpr of
        Left e -> Left e
        Right (App name args) -> Right { name, args }
        Right _ -> Left (HeadNotIdent base)

partialHead :: Array PosToken -> Array PosToken
partialHead toks = case Array.uncons toks of
  Just { head: pt, tail } | pt.tok == TOp ">" -> Array.cons (pt { tok = TIdent ">" }) tail
  _ -> toks
