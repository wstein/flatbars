-- | Lexical structure. See `docs/modules/ROOT/pages/lexical.adoc`.
-- |
-- | `tokenizeTemplate` scans the raw source into a flat stream of `RawTok` —
-- | content runs and tag tokens — handling comment stripping, raw-block capture,
-- | backslash escaping, and `~` whitespace control. It is a deliberately
-- | hand-written, index-slicing scan (linear, tail-recursive, stack-safe for
-- | very large templates); the parser (`BareBars.Parser`) then parses each tag's
-- | *interior* text into an `Expr` with `BareBars.Expr` (a `purescript-parsing`
-- | grammar). The scanner is structural only — it never interprets a tag's
-- | contents, just delimits them — so each tag token carries its interior text
-- | and that interior's source offset, for the expression parser.
module BareBars.Lexer
  ( RawTok(..)
  , tokenizeTemplate
  , trimStandalone
  ) where

import Prelude

import BareBars.Error (ParseError(..))
import BareBars.Span (Span)
import Data.Array as Array
import Data.Either (Either(..))
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..), maybe)
import Data.String.CodeUnits as SCU
import Data.String.Common (joinWith)

-- | A flat template token. Comments never appear (they are dropped); `~`
-- | whitespace control has already been applied to the `Content` runs. Each tag
-- | carries its `Span`, the source offset of its interior (`Int`), and the
-- | interior text — the parser turns that text into `Expr`s.
data RawTok
  = RContent String
  | ROutput Span Int String -- {{{ <interior> }}}
  | ROpen Span Int String -- {{# <interior> }}
  | RClose Span Int String -- {{/ <interior> }}
  | RSep Span Int String -- {{ <interior> }} — a name-agnostic separator
  | RRaw Span Int String String -- {{{{# <interior> }}}} <body> {{{{/ name }}}}
  -- {{! <interior> }} — a *short* comment, kept for directive lifting (the parser
  -- scans its interior for `@key` heads). Long `{{!-- … --}}` comments are never
  -- emitted (inert prose).
  | RComment Span Int String

derive instance eqRawTok :: Eq RawTok

instance showRawTok :: Show RawTok where
  show = case _ of
    RContent s -> "RContent " <> show s
    ROutput _ _ s -> "ROutput " <> show s
    ROpen _ _ s -> "ROpen " <> show s
    RClose _ _ s -> "RClose " <> show s
    RSep _ _ s -> "RSep " <> show s
    RRaw _ _ s b -> "RRaw " <> show s <> " " <> show b
    RComment _ _ s -> "RComment " <> show s

--------------------------------------------------------------------------------
-- Character helpers
--------------------------------------------------------------------------------

isSpace :: Char -> Boolean
isSpace c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

-- | Does `cs` contain the literal `pat` starting at index `i`?
matchAt :: Array Char -> Int -> String -> Boolean
matchAt cs i pat =
  let
    pcs = SCU.toCharArray pat
  in
    Array.slice i (i + Array.length pcs) cs == pcs

-- | First index `>= from` at which `pat` occurs, if any.
findFrom :: Array Char -> Int -> String -> Maybe Int
findFrom cs from pat = go from
  where
  len = Array.length cs
  go i
    | i > len = Nothing
    | matchAt cs i pat = Just i
    | otherwise = go (i + 1)

slice :: Array Char -> Int -> Int -> String
slice cs i j = SCU.fromCharArray (Array.slice i j cs)

trimStartWs :: String -> String
trimStartWs s = SCU.fromCharArray (Array.dropWhile isSpace (SCU.toCharArray s))

trimEndWs :: String -> String
trimEndWs s =
  SCU.fromCharArray (Array.reverse (Array.dropWhile isSpace (Array.reverse (SCU.toCharArray s))))

--------------------------------------------------------------------------------
-- Standalone whitespace removal (Handlebars-style)
--------------------------------------------------------------------------------

-- | Strip the line a "standalone" tag sits on: when a block open/close or a
-- | comment is alone on its line (only whitespace before it back to a newline or
-- | the start, and only whitespace after it to a newline or the end), remove
-- | that indentation and the trailing newline so the tag leaves no blank line.
-- |
-- | Only `{{#…}}` / `{{/…}}` / `{{! }}` are eligible. Output tags (`{{ }}` /
-- | `{{{ }}}`) and bare separators (`RSep`) are *not* — at the structural level a
-- | `{{ x }}` separator is indistinguishable from surface output, so trimming it
-- | could eat real content. (`{{else}}`-standalone therefore needs dialect clause
-- | knowledge and is deferred.) Composes with `~`: it runs on the already
-- | tilde-trimmed content.
trimStandalone :: Array RawTok -> Array RawTok
trimStandalone toks = Array.mapWithIndex trimContent toks
  where
  n = Array.length toks

  trimContent :: Int -> RawTok -> RawTok
  trimContent j = case _ of
    RContent s ->
      let
        -- the tag *before* this content is standalone ⇒ drop its trailing line.
        s1 = if standaloneAt (j - 1) then dropLeadingLine s else s
        -- the tag *after* this content is standalone ⇒ drop this line's indent.
        s2 = if standaloneAt (j + 1) then dropTrailingIndent s1 else s1
      in
        RContent s2
    other -> other

  standaloneAt :: Int -> Boolean
  standaloneAt i = case Array.index toks i of
    Just t | blockLevel t -> leftBlank i && rightBlank i
    _ -> false

  -- everything from the previous newline (or start of input) to the tag is blank.
  leftBlank :: Int -> Boolean
  leftBlank i = case Array.index toks (i - 1) of
    Nothing -> true
    Just (RContent s) -> allWs (afterLastNL s)
    Just _ -> false

  -- everything from the tag to the next newline (or end of input) is blank.
  rightBlank :: Int -> Boolean
  rightBlank i = case Array.index toks (i + 1) of
    Nothing -> true
    Just (RContent s)
      | hasNL s -> allWs (beforeFirstNL s)
      | otherwise -> allWs s && i + 1 == n - 1
    Just _ -> false

blockLevel :: RawTok -> Boolean
blockLevel = case _ of
  ROpen _ _ _ -> true
  RClose _ _ _ -> true
  RComment _ _ _ -> true
  _ -> false

allWs :: String -> Boolean
allWs = Array.all isSpace <<< SCU.toCharArray

hasNL :: String -> Boolean
hasNL s = nlIndex true s /= Nothing

-- index of the first ('true') or last ('false') newline, in code units.
nlIndex :: Boolean -> String -> Maybe Int
nlIndex first s =
  let
    f = if first then Array.findIndex else Array.findLastIndex
  in
    f (_ == '\n') (SCU.toCharArray s)

afterLastNL :: String -> String
afterLastNL s = case nlIndex false s of
  Just i -> SCU.drop (i + 1) s
  Nothing -> s

beforeFirstNL :: String -> String
beforeFirstNL s = case nlIndex true s of
  Just i -> SCU.take i s
  Nothing -> s

-- drop the leading blank run through the first newline (the standalone tag's
-- line break); with no newline it is trailing EOF whitespace, dropped whole.
dropLeadingLine :: String -> String
dropLeadingLine s = case nlIndex true s of
  Just i -> SCU.drop (i + 1) s
  Nothing -> ""

-- drop the trailing blank indentation after the last newline (keep the newline);
-- with no newline the whole run is indentation on the first line, dropped whole.
dropTrailingIndent :: String -> String
dropTrailingIndent s = case nlIndex false s of
  Just i -> SCU.take (i + 1) s
  Nothing -> ""

--------------------------------------------------------------------------------
-- Template tokenizer
--------------------------------------------------------------------------------

type TagResult = { mtok :: Maybe RawTok, next :: Int, trimL :: Boolean, trimR :: Boolean }

tokenizeTemplate :: String -> Either ParseError (Array RawTok)
tokenizeTemplate src = map finalize (go 0 0 [] Nil false)
  where
  cs = SCU.toCharArray src
  len = Array.length cs

  -- Tokens accumulate in a *reversed* `List` (O(1) prepend) and are reversed
  -- into an `Array` once, for the same O(n²)-avoidance as the content scan.
  finalize :: List RawTok -> Array RawTok
  finalize = Array.fromFoldable <<< List.reverse

  -- The content run is tracked as a *slice* `[segStart, i)` of the source plus
  -- `frags`, the fragments split off by backslash escapes (which rewrite text,
  -- so the run is not one contiguous slice). A normal character just advances
  -- `i` — O(1), no per-char copy — so a long content run is linear, not the
  -- O(n²) `Array.snoc`-per-char it used to be. `frags` is flushed by joining.
  --
  -- Every recursive `go` must stay in *tail* position (explicit `case`, never
  -- `do`) or PureScript abandons the tail-call loop and the scan overflows the
  -- stack on large input.
  go
    :: Int
    -> Int
    -> Array String
    -> List RawTok
    -> Boolean
    -> Either ParseError (List RawTok)
  go i segStart frags acc pend
    | i >= len = Right (flush (contentTo segStart frags i) acc pend false)
    | otherwise = case Array.index cs i of
        Nothing -> Right (flush (contentTo segStart frags i) acc pend false)
        Just c
          -- backslash escaping of an opener: emit the segment so far, then the
          -- literal, and restart the segment after the escape.
          | c == '\\' ->
              if matchAt cs (i + 1) "\\" then
                go (i + 2) (i + 2) (pushSeg segStart frags i "\\") acc pend
              else case escapedOpenerAt (i + 1) of
                Just lit ->
                  let
                    next = i + 1 + SCU.length lit
                  in
                    go next next (pushSeg segStart frags i lit) acc pend
                Nothing -> go (i + 1) (i + 1) (pushSeg segStart frags i "\\") acc pend
          -- openers all begin with `{`, so gate the (multi-probe) opener check
          -- on that single character — non-brace content costs one comparison.
          | c == '{' && isOpenerAt i -> case readTag i of
              Left e -> Left e
              Right res ->
                let
                  acc1 = flush (contentTo segStart frags i) acc pend res.trimL
                  acc2 = maybe acc1 (\t -> t : acc1) res.mtok
                in
                  go res.next res.next [] acc2 res.trimR
          | otherwise -> go (i + 1) segStart frags acc pend

  -- The content string for a run: prior escape fragments followed by the
  -- still-uncopied slice `[segStart, end)`.
  contentTo :: Int -> Array String -> Int -> String
  contentTo segStart frags end = joinWith "" (Array.snoc frags (slice cs segStart end))

  -- Close the current segment `[segStart, end)` and append a literal fragment.
  pushSeg :: Int -> Array String -> Int -> String -> Array String
  pushSeg segStart frags end lit = Array.snoc (Array.snoc frags (slice cs segStart end)) lit

  -- Flush a content string (prepending to the reversed token list), applying a
  -- pending leading trim and an optional trailing trim (from the following tag).
  flush :: String -> List RawTok -> Boolean -> Boolean -> List RawTok
  flush s0 acc pend trimR =
    let
      s1 = if pend then trimStartWs s0 else s0
      s2 = if trimR then trimEndWs s1 else s1
    in
      if s2 == "" then acc else RContent s2 : acc

  -- The brace-prefixed openers, longest first. The `~` whitespace-control
  -- variants (`{{~#`, `{{~/`, …) are recognized so a left-trim tilde may sit
  -- between the braces and the sigil. `{{#` is the only block *opener*; the bare
  -- double-stash `{{ … }}` is a name-agnostic *separator* (handled separately).
  openerLiteralAt :: Int -> Maybe String
  openerLiteralAt i
    | matchAt cs i "{{{{#" = Just "{{{{#"
    | matchAt cs i "{{~!--" = Just "{{~!--"
    | matchAt cs i "{{!--" = Just "{{!--"
    | matchAt cs i "{{{" = Just "{{{"
    | matchAt cs i "{{~!" = Just "{{~!"
    | matchAt cs i "{{!" = Just "{{!"
    | matchAt cs i "{{~#" = Just "{{~#"
    | matchAt cs i "{{#" = Just "{{#"
    | matchAt cs i "{{~/" = Just "{{~/"
    | matchAt cs i "{{/" = Just "{{/"
    | otherwise = Nothing

  -- A separator is any `{{` that is not `{{{` and not one of the bracketed
  -- openers above — a bare double-stash whose head is an identifier. The lexer
  -- recognizes the *shape*, never the name.
  isSeparatorAt :: Int -> Boolean
  isSeparatorAt i = matchAt cs i "{{" && not (matchAt cs i "{{{") && case openerLiteralAt i of
    Just _ -> false
    Nothing -> true

  isOpenerAt :: Int -> Boolean
  isOpenerAt i = case openerLiteralAt i of
    Just _ -> true
    Nothing -> isSeparatorAt i

  -- The literal text emitted for a backslash-escaped opener.
  escapedOpenerAt :: Int -> Maybe String
  escapedOpenerAt i = case openerLiteralAt i of
    Just s -> Just s
    Nothing -> if isSeparatorAt i then Just "{{" else Nothing

  readTag :: Int -> Either ParseError TagResult
  readTag i
    | matchAt cs i "{{{{#" = readRaw i
    | matchAt cs i "{{~!--" = readLongComment i "{{~!--"
    | matchAt cs i "{{!--" = readLongComment i "{{!--"
    | matchAt cs i "{{{" = readOutput i
    | matchAt cs i "{{~!" = readShortComment i "{{~!"
    | matchAt cs i "{{!" = readShortComment i "{{!"
    | matchAt cs i "{{~#" = readBlockOpen i "{{~#"
    | matchAt cs i "{{#" = readBlockOpen i "{{#"
    | matchAt cs i "{{~/" = readClose i "{{~/"
    | matchAt cs i "{{/" = readClose i "{{/"
    | matchAt cs i "{{" = readSeparator i
    | otherwise = Left (LexError "internal: no opener" i)

  -- A left-trim tilde may sit immediately after the braces, before the sigil.
  leadTrimAt :: Int -> Boolean
  leadTrimAt i = matchAt cs (i + 2) "~"

  -- Split a tag interior on leading/trailing `~`, returning (trimL, trimR, core)
  splitTrims :: String -> { trimL :: Boolean, trimR :: Boolean, core :: String }
  splitTrims raw =
    let
      trimL = SCU.take 1 raw == "~"
      r1 = if trimL then SCU.drop 1 raw else raw
      trimR = SCU.takeRight 1 r1 == "~"
      core = if trimR then SCU.dropRight 1 r1 else r1
    in
      { trimL, trimR, core }

  readOutput :: Int -> Either ParseError TagResult
  readOutput i =
    let
      start = i + 3
    in
      case findFrom cs start "}}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice cs start q)
          in
            Right
              { mtok: Just (ROutput { start: i, end: q + 3 } start t.core)
              , next: q + 3
              , trimL: t.trimL
              , trimR: t.trimR
              }

  readBlockOpen :: Int -> String -> Either ParseError TagResult
  readBlockOpen i opener =
    let
      start = i + SCU.length opener
    in
      case findFrom cs start "}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice cs start q)
          in
            Right
              { mtok: Just (ROpen { start: i, end: q + 2 } start t.core)
              , next: q + 2
              , trimL: leadTrimAt i || t.trimL
              , trimR: t.trimR
              }

  readClose :: Int -> String -> Either ParseError TagResult
  readClose i opener =
    let
      start = i + SCU.length opener
    in
      case findFrom cs start "}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice cs start q)
          in
            Right
              { mtok: Just (RClose { start: i, end: q + 2 } start t.core)
              , next: q + 2
              , trimL: leadTrimAt i || t.trimL
              , trimR: t.trimR
              }

  -- A bare double-stash separator `{{ [~] name args [~] }}`. The leading `~`
  -- (if any) sits before the interior; the head is an identifier the lexer does
  -- not interpret.
  readSeparator :: Int -> Either ParseError TagResult
  readSeparator i =
    let
      start = if leadTrimAt i then i + 3 else i + 2
    in
      case findFrom cs start "}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice cs start q)
          in
            Right
              { mtok: Just (RSep { start: i, end: q + 2 } start t.core)
              , next: q + 2
              , trimL: leadTrimAt i || t.trimL
              , trimR: t.trimR
              }

  -- A short comment `{{! [~] … [~] }}` is *kept* as an `RComment` carrying its
  -- interior (trailing `~` stripped) and offset, so the parser can lift any
  -- `@key` directives from it. It still produces no output — the parser drops it
  -- after directive extraction — and its `~` trims as before.
  readShortComment :: Int -> String -> Either ParseError TagResult
  readShortComment i opener =
    let
      start = i + SCU.length opener
    in
      case findFrom cs start "}}" of
        Nothing -> Left (UnterminatedComment i)
        Just q ->
          let
            trimR = matchAt cs (q - 1) "~"
            interior = slice cs start (if trimR then q - 1 else q)
          in
            Right
              { mtok: Just (RComment { start: i, end: q + 2 } start interior)
              , next: q + 2
              , trimL: leadTrimAt i
              , trimR
              }

  readLongComment :: Int -> String -> Either ParseError TagResult
  readLongComment i opener = case findFrom cs (i + SCU.length opener) "--}}" of
    Nothing -> Left (UnterminatedComment i)
    Just q -> Right
      { mtok: Nothing, next: q + 4, trimL: leadTrimAt i, trimR: matchAt cs (q - 1) "~" }

  readRaw :: Int -> Either ParseError TagResult
  readRaw i =
    let
      start = i + 5
    in
      case findFrom cs start "}}}}" of
        Nothing -> Left (UnterminatedRaw i)
        Just qh ->
          let
            head = slice cs start qh
            bodyStart = qh + 4
            -- the close is name-matched (`{{{{/name}}}}`); the name is the
            -- leading whitespace-delimited token of the head, which is exactly
            -- the head identifier the parser will read from `head`.
            closePat = "{{{{/" <> rawName head <> "}}}}"
          in
            case findFrom cs bodyStart closePat of
              Nothing -> Left (UnterminatedRaw i)
              Just qc ->
                let
                  end = qc + SCU.length closePat
                in
                  Right
                    { mtok: Just (RRaw { start: i, end } start head (slice cs bodyStart qc))
                    , next: end
                    , trimL: false
                    , trimR: false
                    }

  -- The leading whitespace-delimited token of a raw-block head, used to build
  -- the name-matched close delimiter.
  rawName :: String -> String
  rawName s =
    SCU.fromCharArray
      (Array.takeWhile (not <<< isSpace) (Array.dropWhile isSpace (SCU.toCharArray s)))
