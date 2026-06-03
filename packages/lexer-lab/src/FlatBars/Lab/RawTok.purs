-- | The parser-facing lexer of the hand-lexer family: a self-contained
-- | structural scan that emits the engine's `RawTok` stream DIRECTLY — no
-- | re-walk of the fine `LexToken` stream (that was the tech debt). It finds
-- | tags by scanning the char array (offsets only — `RawTok` spans are
-- | code-unit offsets, so no line/column bookkeeping is needed), applies `~`
-- | whitespace control and backslash escapes, and slices interiors. It matches
-- | `FlatBars.Lexer.tokenizeTemplate` under the default delimiters, so feeding
-- | it to the engine's `trimStandalone` + `buildFromTokens` is identical to
-- | `FlatBars.parse` (proven by RawTokParity). `parse` demonstrates that.
-- |
-- | This is the migration shape: swap the lexer, keep the proven parser. The
-- | fine `FlatBars.Lab.LexerHand` (string-aware, line/column, LSP) stays the
-- | editor-facing lexer; this is its leaner parser-facing sibling.
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
import Data.String.Common (joinWith)
import FlatBars.Error (ParseError(..))
import FlatBars.Lab.Lexer.Types (LexConfig, firstWord, isSpace)
import FlatBars.Lexer (RawTok(..), trimStandalone) as E
import FlatBars.Parser (buildFromTokens, defaultParseOptions)
import FlatBars.Syntax (Sigil(..)) as Syn
import FlatBars.Syntax (Template)

-- | Tokenize a template into the engine's `RawTok` stream (default delimiters).
toRawToks :: LexConfig -> String -> Either ParseError (Array E.RawTok)
toRawToks _ src = map (Array.fromFoldable <<< List.reverse) (go 0 false 0 [] Nil)
  where
  cs = SCU.toCharArray src
  len = Array.length cs

  at i = case Array.index cs i of
    Just c -> c
    Nothing -> ' '

  matchAt i pat = Array.slice i (i + SCU.length pat) cs == SCU.toCharArray pat

  findFrom from pat = scan from
    where
    pcs = SCU.toCharArray pat
    plen = Array.length pcs
    scan k
      | k + plen > len = Nothing
      | Array.slice k (k + plen) cs == pcs = Just k
      | otherwise = scan (k + 1)

  slice a b = SCU.fromCharArray (Array.slice a b cs)

  -- The content string for a run: escape fragments then the trailing slice.
  contentTo segStart frags end = joinWith "" (Array.snoc frags (slice segStart end))
  pushSeg segStart frags end lit = Array.snoc (Array.snoc frags (slice segStart end)) lit

  -- Main scan: accumulate a content run (a slice plus escape fragments) until a
  -- tag, flushing it with the pending leading trim and the tag's trimL.
  go :: Int -> Boolean -> Int -> Array String -> List E.RawTok -> Either ParseError (List E.RawTok)
  go i pend segStart frags acc
    | i >= len = Right (flush (contentTo segStart frags i) acc pend false)
    | at i == '\\' =
        if matchAt (i + 1) "\\" then go (i + 2) pend (i + 2) (pushSeg segStart frags i "\\") acc
        else case escapedOpenerAt (i + 1) of
          Just lit ->
            let
              next = i + 1 + SCU.length lit
            in
              go next pend next (pushSeg segStart frags i lit) acc
          Nothing -> go (i + 1) pend (i + 1) (pushSeg segStart frags i "\\") acc
    | at i == '{' && isOpenerAt i = case readTag i of
        Left e -> Left e
        Right res ->
          let
            acc1 = consTok res.mtok (flush (contentTo segStart frags i) acc pend res.trimL)
          in
            go res.next res.trimR res.next [] acc1
    | otherwise = go (i + 1) pend segStart frags acc

  consTok mtok acc = case mtok of
    Just t -> t : acc
    Nothing -> acc

  flush s0 acc pend trimR =
    let
      s1 = if pend then trimStartWs s0 else s0
      s2 = if trimR then trimEndWs s1 else s1
    in
      if s2 == "" then acc else E.RContent s2 : acc

  -- The brace-prefixed openers, longest first (mirrors FlatBars.Lexer). The `~`
  -- whitespace-control variants are recognised so a left-trim tilde may sit
  -- between the braces and the sigil.
  openerLiteralAt i
    | matchAt i "{{{{#" = Just "{{{{#"
    | matchAt i "{{{{" = Just "{{{{"
    | matchAt i "{{~!--" = Just "{{~!--"
    | matchAt i "{{!--" = Just "{{!--"
    | matchAt i "{{{^" = Just "{{{^"
    | matchAt i "{{{/" = Just "{{{/"
    | matchAt i "{{{" = Just "{{{"
    | matchAt i "{{~!" = Just "{{~!"
    | matchAt i "{{!" = Just "{{!"
    | matchAt i "{{~#*" = Just "{{~#*"
    | matchAt i "{{#*" = Just "{{#*"
    | matchAt i "{{~#>" = Just "{{~#>"
    | matchAt i "{{#>" = Just "{{#>"
    | matchAt i "{{~#" = Just "{{~#"
    | matchAt i "{{#" = Just "{{#"
    | matchAt i "{{~^" = Just "{{~^"
    | matchAt i "{{^" = Just "{{^"
    | matchAt i "{{~<" = Just "{{~<"
    | matchAt i "{{<" = Just "{{<"
    | matchAt i "{{~$" = Just "{{~$"
    | matchAt i "{{$" = Just "{{$"
    | matchAt i "{{~/" = Just "{{~/"
    | matchAt i "{{/" = Just "{{/"
    | matchAt i "{{~&" = Just "{{~&"
    | matchAt i "{{&" = Just "{{&"
    | otherwise = Nothing

  isSeparatorAt i = matchAt i "{{" && not (matchAt i "{{{") && case openerLiteralAt i of
    Just _ -> false
    Nothing -> true

  isOpenerAt i = case openerLiteralAt i of
    Just _ -> true
    Nothing -> isSeparatorAt i

  escapedOpenerAt i = case openerLiteralAt i of
    Just s -> Just s
    Nothing -> if isSeparatorAt i then Just "{{" else Nothing

  leadTrimAt i = matchAt (i + 2) "~"

  splitTrims raw =
    let
      trimL = SCU.take 1 raw == "~"
      r1 = if trimL then SCU.drop 1 raw else raw
      trimR = SCU.takeRight 1 r1 == "~"
      core = if trimR then SCU.dropRight 1 r1 else r1
    in
      { trimL, trimR, core }

  span i j = { start: i, end: j }

  readTag i
    | matchAt i "{{{{#" = readRaw i 5
    | matchAt i "{{{{" = readRaw i 4
    | matchAt i "{{~!--" = readLongComment i "{{~!--"
    | matchAt i "{{!--" = readLongComment i "{{!--"
    | matchAt i "{{{^" = readBlockOpen i "{{{^" Syn.Inverse "}}}"
    | matchAt i "{{{/" = readClose i "{{{/" "}}}"
    | matchAt i "{{{" = readOutput i
    | matchAt i "{{~!" = readShortComment i "{{~!"
    | matchAt i "{{!" = readShortComment i "{{!"
    | matchAt i "{{~#*" = readBlockOpen i "{{~#*" Syn.Decorator "}}"
    | matchAt i "{{#*" = readBlockOpen i "{{#*" Syn.Decorator "}}"
    | matchAt i "{{~#>" = readBlockOpen i "{{~#>" Syn.PartialBlock "}}"
    | matchAt i "{{#>" = readBlockOpen i "{{#>" Syn.PartialBlock "}}"
    | matchAt i "{{~#" = readBlockOpen i "{{~#" Syn.Section "}}"
    | matchAt i "{{#" = readBlockOpen i "{{#" Syn.Section "}}"
    | matchAt i "{{~^" = readBlockOpen i "{{~^" Syn.Inverse "}}"
    | matchAt i "{{^" = readBlockOpen i "{{^" Syn.Inverse "}}"
    | matchAt i "{{~<" = readBlockOpen i "{{~<" Syn.Parent "}}"
    | matchAt i "{{<" = readBlockOpen i "{{<" Syn.Parent "}}"
    | matchAt i "{{~$" = readBlockOpen i "{{~$" Syn.BlockDef "}}"
    | matchAt i "{{$" = readBlockOpen i "{{$" Syn.BlockDef "}}"
    | matchAt i "{{~/" = readClose i "{{~/" "}}"
    | matchAt i "{{/" = readClose i "{{/" "}}"
    | matchAt i "{{~&" = readAmp i "{{~&"
    | matchAt i "{{&" = readAmp i "{{&"
    | otherwise = readSeparator i

  readOutput i =
    let
      start = i + 3
    in
      case findFrom start "}}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice start q)
          in
            Right
              { mtok: Just (E.ROutput (span i (q + 3)) start t.core)
              , next: q + 3
              , trimL: t.trimL
              , trimR: t.trimR
              }

  readBlockOpen i opener sigil close =
    let
      start = i + SCU.length opener
      cl = SCU.length close
    in
      case findFrom start close of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice start q)
          in
            Right
              { mtok: Just (E.ROpen (span i (q + cl)) sigil start t.core)
              , next: q + cl
              , trimL: leadTrimAt i || t.trimL
              , trimR: t.trimR
              }

  readClose i opener close =
    let
      start = i + SCU.length opener
      cl = SCU.length close
    in
      case findFrom start close of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice start q)
          in
            Right
              { mtok: Just (E.RClose (span i (q + cl)) start t.core)
              , next: q + cl
              , trimL: leadTrimAt i || t.trimL
              , trimR: t.trimR
              }

  readAmp i opener =
    let
      start = i + SCU.length opener
    in
      case findFrom start "}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice start q)
          in
            Right
              { mtok: Just (E.RAmp (span i (q + 2)) start t.core)
              , next: q + 2
              , trimL: leadTrimAt i || t.trimL
              , trimR: t.trimR
              }

  readSeparator i =
    let
      start = if leadTrimAt i then i + 3 else i + 2
    in
      case findFrom start "}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice start q)
          in
            Right
              { mtok: Just (E.RSep (span i (q + 2)) start t.core)
              , next: q + 2
              , trimL: leadTrimAt i || t.trimL
              , trimR: t.trimR
              }

  readShortComment i opener =
    let
      start = i + SCU.length opener
    in
      case findFrom start "}}" of
        Nothing -> Left (UnterminatedComment i)
        Just q ->
          let
            trimR = matchAt (q - 1) "~"
            interior = slice start (if trimR then q - 1 else q)
          in
            Right
              { mtok: Just (E.RComment (span i (q + 2)) start interior)
              , next: q + 2
              , trimL: leadTrimAt i
              , trimR
              }

  -- Long comments render nothing and are dropped (the default config does not
  -- keep them); the `~`/standalone trims are unchanged.
  readLongComment i opener = case findFrom (i + SCU.length opener) "--}}" of
    Nothing -> Left (UnterminatedComment i)
    Just q -> Right { mtok: Nothing, next: q + 4, trimL: leadTrimAt i, trimR: matchAt (q - 1) "~" }

  readRaw i sigil =
    let
      start = i + sigil
    in
      case findFrom start "}}}}" of
        Nothing -> Left (UnterminatedRaw i)
        Just qh ->
          let
            head = slice start qh
            bodyStart = qh + 4
            closePat = "{{{{/" <> firstWord head <> "}}}}"
          in
            case findFrom bodyStart closePat of
              Nothing -> Left (UnterminatedRaw i)
              Just qc ->
                let
                  end = qc + SCU.length closePat
                in
                  Right
                    { mtok: Just (E.RRaw (span i end) (sigil == 5) start head (slice bodyStart qc))
                    , next: end
                    , trimL: false
                    , trimR: false
                    }

-- | Parse via the structural scanner, reusing the engine's whitespace + tree
-- | builder — the same path `FlatBars.parse` takes, only the lexer swapped.
parse :: LexConfig -> String -> Either ParseError Template
parse cfg src = do
  raw <- toRawToks cfg src
  buildFromTokens defaultParseOptions (E.trimStandalone [ "else", "elif" ] raw)

isWs :: Char -> Boolean
isWs = isSpace

trimStartWs :: String -> String
trimStartWs s = SCU.fromCharArray (Array.dropWhile isWs (SCU.toCharArray s))

trimEndWs :: String -> String
trimEndWs s =
  SCU.fromCharArray (Array.reverse (Array.dropWhile isWs (Array.reverse (SCU.toCharArray s))))
