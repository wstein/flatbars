-- | The MinBars-only **Mustache standalone-whitespace** pass over the core
-- | `RawTok` stream (spec §4.8). It is a *peer* of the core's Handlebars-flavored
-- | `BareBars.Lexer.trimStandalone`, but differs in two ways the spec demands and
-- | which is why MinBars owns it rather than sharing the core pass:
-- |
-- |  1. **Eligible-tag set.** A line is *standalone* when it holds only a
-- |     standalone-eligible tag plus optional surrounding whitespace. Eligible:
-- |     section/inverted open & close (`{{#}}`/`{{^}}`/`{{/}}`), comments
-- |     (`{{!}}`), partials (`{{> }}` — a `RSep` whose head is `>`), and the
-- |     inheritance tags parent/block open & close (`{{<}}`/`{{$}}`/`{{/}}`).
-- |     Interpolation (`{{x}}`/`{{{x}}}`/`{{&x}}`) is **never** standalone.
-- |  2. **Indentation capture.** For a standalone *partial* the stripped leading
-- |     whitespace is recorded and re-applied to every line of the partial's
-- |     rendered output (§4.6). The pass threads it by appending the indent as a
-- |     trailing string-literal argument to the partial token's interior, which
-- |     the MinBars surface (`MinBars.Surface`) reads back as the partial's indent
-- |     (indent is whitespace-only, so quoting it is always safe).
-- |
-- | RawBars/FullBars/MaxBars never run this pass; their whitespace behaviour is
-- | unchanged.
module MinBars.Standalone
  ( mustacheStandalone
  ) where

import Prelude

import BareBars.Lexer (RawTok(..))
import BareBars.Syntax (Sigil(..))
import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.String.CodeUnits as SCU

isSpaceCU :: Char -> Boolean
isSpaceCU c = c == ' ' || c == '\t' || c == '\r' || c == '\n'

-- horizontal whitespace only — a newline never appears in captured indentation.
isHWs :: Char -> Boolean
isHWs c = c == ' ' || c == '\t'

allWs :: String -> Boolean
allWs = Array.all isSpaceCU <<< SCU.toCharArray

-- index of the first (`true`) or last (`false`) newline, in code units.
nlIndex :: Boolean -> String -> Maybe Int
nlIndex first s =
  let
    f = if first then Array.findIndex else Array.findLastIndex
  in
    f (_ == '\n') (SCU.toCharArray s)

hasNL :: String -> Boolean
hasNL s = nlIndex true s /= Nothing

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

-- | Is the tag standalone-*eligible*? (Eligibility is necessary, not sufficient —
-- | the surrounding lines must also be blank for the tag to actually *be*
-- | standalone.) Interpolation is excluded; a `RSep` is eligible only when it is a
-- | partial (`{{> …}}`, head `>`), never a plain `{{x}}` interpolation.
eligible :: RawTok -> Boolean
eligible = case _ of
  ROpen _ _ _ _ -> true
  RClose _ _ _ -> true
  RComment _ _ _ -> true
  RSep _ _ s -> isPartialInterior s
  _ -> false

-- A partial separator's interior begins (after optional whitespace) with `>`.
isPartialInterior :: String -> Boolean
isPartialInterior s = case Array.head (dropWs (SCU.toCharArray s)) of
  Just '>' -> true
  _ -> false
  where
  dropWs = Array.dropWhile isSpaceCU

-- | The Mustache standalone pass. Mirrors the core trim's structure (strip the
-- | previous tag's trailing line and the following indent around each standalone
-- | tag), then injects each standalone partial's captured indent.
mustacheStandalone :: Array RawTok -> Array RawTok
mustacheStandalone toks0 = Array.mapWithIndex inject trimmed
  where
  trimmed = Array.mapWithIndex trimContent toks0
  n = Array.length toks0

  trimContent :: Int -> RawTok -> RawTok
  trimContent j = case _ of
    RContent s ->
      let
        s1 = if standaloneAt (j - 1) then dropLeadingLine s else s
        s2 = if standaloneAt (j + 1) then dropTrailingIndent s1 else s1
      in
        RContent s2
    other -> other

  -- The indent a standalone tag at index `i` sits at: the horizontal whitespace
  -- run after the last newline of the *preceding* content (what `trimContent`
  -- strips as the trailing indent). Empty when the tag opens the input.
  indentAt :: Int -> String
  indentAt i = case Array.index toks0 (i - 1) of
    Nothing -> ""
    Just (RContent s) ->
      SCU.fromCharArray (Array.takeWhile isHWs (SCU.toCharArray (afterLastNL s)))
    Just _ -> ""

  standaloneAt :: Int -> Boolean
  standaloneAt i = case Array.index toks0 i of
    Just t | eligible t -> leftBlank i && rightBlank i
    _ -> false

  -- Everything from the tag leftwards back to the previous newline (or start of
  -- input) is whitespace, with **no intervening tag** on that line. A preceding
  -- content with a newline ends the scan (its post-newline tail must be blank); a
  -- preceding content with no newline must itself be blank *and* be at the line
  -- start (recurse left); any preceding tag means another tag shares the line ⇒
  -- not standalone.
  leftBlank :: Int -> Boolean
  leftBlank i = case Array.index toks0 (i - 1) of
    Nothing -> true
    Just (RContent s)
      | hasNL s -> allWs (afterLastNL s)
      | otherwise -> allWs s && leftBlank (i - 1)
    -- another standalone-eligible tag sharing the line is transparent (a line of
    -- only tags + whitespace is still standalone, e.g. `{{<p}}{{/p}}`); a
    -- non-eligible tag (interpolation/output) breaks standalone-ness.
    Just t -> eligible t && leftBlank (i - 1)

  -- Mirror of `leftBlank` to the right: up to the next newline (or end of input),
  -- everything is whitespace and no *non-eligible* tag shares the line.
  rightBlank :: Int -> Boolean
  rightBlank i = case Array.index toks0 (i + 1) of
    Nothing -> true
    Just (RContent s)
      | hasNL s -> allWs (beforeFirstNL s)
      | otherwise -> allWs s && rightBlank (i + 1)
    Just t -> eligible t && rightBlank (i + 1)

  -- Inject the captured indent into each standalone partial / parent token, by
  -- appending it as a trailing quoted string-literal argument to the interior
  -- (indent is whitespace-only, so quoting is always safe). The desugar reads it
  -- back: a `>`-headed separator's indent re-applies to the partial's lines, a
  -- `Parent` open's indent re-applies to the expanded parent template's lines.
  inject :: Int -> RawTok -> RawTok
  inject i = case _ of
    RSep span base s
      | isPartialInterior s && standaloneAt i ->
          RSep span base (s <> " \"" <> indentAt i <> "\"")
    ROpen span Parent base s
      | standaloneAt i ->
          ROpen span Parent base (s <> " \"" <> indentAt i <> "\"")
    -- a standalone override-block open carries its indent too: the override (or
    -- default) body is re-indented to it at expansion (§4.6.2 reindentation).
    ROpen span BlockDef base s
      | standaloneAt i ->
          ROpen span BlockDef base (s <> " \"" <> indentAt i <> "\"")
    other -> other
