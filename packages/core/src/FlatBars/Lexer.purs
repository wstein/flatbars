-- | Lexical structure. See `docs/modules/ROOT/pages/lexical.adoc`.
-- |
-- | `tokenizeTemplate` scans the raw source into a flat stream of `RawTok` —
-- | content runs and tag tokens — handling comment stripping, raw-block capture,
-- | backslash escaping, and `~` whitespace control. It is a deliberately
-- | hand-written, index-slicing scan (linear, tail-recursive, stack-safe for
-- | very large templates); the parser (`FlatBars.Parser`) then parses each tag's
-- | *interior* text into an `Expr` with `FlatBars.Expr` (a `purescript-parsing`
-- | grammar). The scanner is structural only — it never interprets a tag's
-- | contents, just delimits them — so each tag token carries its interior text
-- | and that interior's source offset, for the expression parser.
module FlatBars.Lexer
  ( RawTok(..)
  , LexConfig
  , defaultLexConfig
  , tokenizeTemplate
  , trimStandalone
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..), maybe)
import Data.String (Pattern(..))
import Data.String.CodeUnits as SCU
import Data.String.Common (joinWith)
import FlatBars.Error (ParseError(..))
import FlatBars.Span (Span)
import FlatBars.Syntax (Sigil(..))
import FlatBars.Token (Interior, LexOptions, tokenizeInterior)

-- | A flat template token. Comments never appear (they are dropped); `~`
-- | whitespace control has already been applied to the `Content` runs. Each tag
-- | carries its `Span`, the source offset of its interior (`Int`), the interior
-- | text, and — for the expression-bearing tags — that interior already lexed
-- | (`Interior`, the meaning-free `PosToken` stream or its deferred lex error).
-- | The parser and the highlighter consume the pre-lexed `Interior` rather than
-- | re-lexing the text; the text is retained for directive lifting,
-- | standalone-whitespace head-words, and raw-block close-matching.
data RawTok
  = RContent String
  | ROutput Span Int String Interior -- {{{ <interior> }}}
  | RAmp Span Int String Interior -- {{& <interior> }} — unescaped output (Handlebars `&`)
  | ROpen Span Sigil Int String Interior -- {{# / {{^ / {{< / {{$ <interior> }} — sigil distinguishes them
  | RClose Span Int String Interior -- {{/ <interior> }}
  | RSep Span Int String Interior -- {{ <interior> }} — a name-agnostic separator
  -- span, `hasHash` (true for the `{{{{# }}}}` FlatBars spelling, false for the
  -- bare `{{{{ }}}}` Handlebars spelling — gated separately per dialect), base,
  -- head, the head's `Interior`, body. `{{{{# <interior> }}}} <body> {{{{/ name }}}}`.
  | RRaw Span Boolean Int String Interior String
  -- {{! <interior> }} — a *short* comment, kept for directive lifting (the parser
  -- scans its interior for `@key` heads). Long `{{!-- … --}}` comments are never
  -- emitted (inert prose).
  | RComment Span Int String
  -- {{=<% %>=}} — a Mustache set-delimiter tag (only recognized when
  -- `LexConfig.mustacheDelims` is on). It changes the active delimiter pair for
  -- all following content and renders nothing; the parser drops it (like a
  -- comment) after the standalone-whitespace pass, where it is eligible.
  | RSetDelim Span
  -- {{!-- … --}} (and {{~!--) — a *long* comment, inert prose. It is normally
  -- dropped (it carries no directives and produces no output), but is emitted as
  -- this span-only token when `LexConfig.keepLongComments` is on, so the
  -- highlighter can colour it (the parser/compiler never set that flag, so they
  -- still never see it). Standalone-whitespace and `~` trimming are unchanged —
  -- handled by the surrounding flush regardless of whether the token is emitted.
  | RLongComment Span

derive instance eqRawTok :: Eq RawTok

instance showRawTok :: Show RawTok where
  show = case _ of
    RContent s -> "RContent " <> show s
    ROutput _ _ s _ -> "ROutput " <> show s
    RAmp _ _ s _ -> "RAmp " <> show s
    ROpen _ sig _ s _ -> "ROpen " <> show sig <> " " <> show s
    RClose _ _ s _ -> "RClose " <> show s
    RSep _ _ s _ -> "RSep " <> show s
    RRaw _ hash _ s _ b -> "RRaw " <> show hash <> " " <> show s <> " " <> show b
    RComment _ _ s -> "RComment " <> show s
    RSetDelim _ -> "RSetDelim"
    RLongComment _ -> "RLongComment"

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
-- | Block opens/closes (`{{#…}}` / `{{/…}}`) and comments (`{{! }}`) are always
-- | eligible. Output tags (`{{ }}` / `{{{ }}}`) never are. A bare separator
-- | (`RSep`) is eligible only when its head name is in `seps` — the caller's
-- | clause-separator names (`["else", "elif"]`): at the structural level a
-- | `{{ x }}` separator is indistinguishable from surface output, so only the
-- | known clause markers are trimmed (a `{{else}}` / `{{elif …}}` alone on its
-- | line leaves no blank line), never an arbitrary `{{ x }}`. Composes with `~`:
-- | it runs on the already tilde-trimmed content.
trimStandalone :: Array String -> Array RawTok -> Array RawTok
trimStandalone seps toks = Array.mapWithIndex trimContent toks
  where

  -- standalone-eligible: a block open/close/comment, or a separator whose head
  -- name is a known clause marker (so `{{else}}`/`{{elif}}` strip, output does not).
  eligible :: RawTok -> Boolean
  eligible t = blockLevel t || case t of
    RSep _ _ s _ -> Array.elem (sepHead s) seps
    _ -> false

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
    Just t | eligible t -> leftBlank i && rightBlank i
    _ -> false

  -- everything from the previous newline (or start of input) to the tag is blank.
  -- Scans *through* blank content runs but stops at any other tag: an
  -- interpolation or block tag earlier on the same line is non-whitespace source,
  -- so the tag is not standalone (Handlebars/Mustache parity — without this, the
  -- space in `pass:[{{#each xs}}{{this}} {{/each}}]` was wrongly stripped).
  leftBlank :: Int -> Boolean
  leftBlank i = goLeft (i - 1)
    where
    goLeft k = case Array.index toks k of
      Nothing -> true -- start of input
      Just (RContent s)
        | hasNL s -> allWs (afterLastNL s) -- reached this line's start
        | allWs s -> goLeft (k - 1) -- a wholly-blank run; keep scanning left
        | otherwise -> false -- visible text on this line
      Just _ -> false -- another tag on this line ⇒ not standalone

  -- everything from the tag to the next newline (or end of input) is blank.
  rightBlank :: Int -> Boolean
  rightBlank i = goRight (i + 1)
    where
    goRight k = case Array.index toks k of
      Nothing -> true -- end of input
      Just (RContent s)
        | hasNL s -> allWs (beforeFirstNL s) -- reached this line's end
        | allWs s -> goRight (k + 1) -- a wholly-blank run; keep scanning right
        | otherwise -> false -- visible text on this line
      Just _ -> false -- another tag on this line ⇒ not standalone

blockLevel :: RawTok -> Boolean
blockLevel = case _ of
  ROpen _ _ _ _ _ -> true
  RClose _ _ _ _ -> true
  RComment _ _ _ -> true
  RSetDelim _ -> true -- standalone-eligible (a lone `{{=<% %>=}}` line is stripped)
  _ -> false

-- | The head name of a separator interior — its first whitespace-delimited word
-- | (leading whitespace skipped): `"else"` from `{{else}}`, `"elif"` from
-- | `{{elif (gt x 0)}}`. Used only to decide standalone-whitespace eligibility.
sepHead :: String -> String
sepHead s =
  let
    cs = Array.dropWhile isSpace (SCU.toCharArray s)
  in
    SCU.fromCharArray (Array.takeWhile (not <<< isSpace) cs)

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

-- | Lexer configuration for the *template* scanner (distinct from
-- | `FlatBars.Token.LexOptions`, which configures the *interior* expression
-- | tokenizer). `open`/`close` are the initial delimiter pair; `mustacheDelims`
-- | enables the Mustache `{{=<% %>=}}` set-delimiter tag — when on, the scanner
-- | swaps the active pair mid-stream (ADR-015). When `mustacheDelims` is off
-- | (the ladder's default) and the pair is the default `{{`/`}}`, the scan is
-- | byte-identical to the fixed-delimiter lexer.
-- | `keepLongComments` makes the scanner emit `{{!-- … --}}` long comments as
-- | span-only `RLongComment` tokens instead of dropping them; only the syntax
-- | highlighter sets it (rendering/compilation leave it off, so their token
-- | stream — and output — is unchanged).
type LexConfig =
  { open :: String, close :: String, mustacheDelims :: Boolean, keepLongComments :: Boolean }

-- | Default template-lexer config: `{{`/`}}`, no set-delimiter switching, long
-- | comments dropped (the render/compile default).
defaultLexConfig :: LexConfig
defaultLexConfig = { open: "{{", close: "}}", mustacheDelims: false, keepLongComments: false }

type TagResult = { mtok :: Maybe RawTok, next :: Int, trimL :: Boolean, trimR :: Boolean }

-- | Result of reading a set-delimiter tag: the token, the next index, and the
-- | new active delimiter pair the scan continues with.
type SetDelimResult =
  { tok :: RawTok
  , next :: Int
  , open :: String
  , close :: String
  , trimL :: Boolean
  , trimR :: Boolean
  }

-- | Scan a template into the flat `RawTok` stream. `LexOptions` (the interior
-- | tokenizer's dialect seam — `operatorChars`) is threaded through so each tag's
-- | interior is lexed *here*, at scan time, and carried on the token. The
-- | structural shape is `LexOptions`-independent (tag boundaries, sigils, spans,
-- | raw bodies, set-delimiter state); `LexOptions` only governs the meaning-free
-- | interior token lexing.
tokenizeTemplate :: LexConfig -> LexOptions -> String -> Either ParseError (Array RawTok)
tokenizeTemplate cfg lexOpts src = map finalize (go 0 cfg.open cfg.close 0 [] Nil false)
  where
  cs = SCU.toCharArray src
  len = Array.length cs

  -- Lex a tag interior at its source offset — the pre-lexed `Interior` every
  -- expression-bearing `RawTok` carries.
  interiorAt :: Int -> String -> Interior
  interiorAt base s = tokenizeInterior lexOpts base s

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
    -> String
    -> String
    -> Int
    -> Array String
    -> List RawTok
    -> Boolean
    -> Either ParseError (List RawTok)
  go i open close segStart frags acc pend
    | i >= len = Right (flush (contentTo segStart frags i) acc pend false)
    | otherwise = case Array.index cs i of
        Nothing -> Right (flush (contentTo segStart frags i) acc pend false)
        Just c
          -- A set-delimiter tag `<open>=A B=<close>` (Mustache; gated). Checked
          -- before the opener probe so `{{=…=}}` is not read as a bare separator.
          -- It swaps the active pair for everything that follows.
          | cfg.mustacheDelims && matchAt cs i (open <> "=") -> case readSetDelim i open close of
              Left e -> Left e
              Right sd ->
                let
                  acc1 = flush (contentTo segStart frags i) acc pend sd.trimL
                in
                  go sd.next sd.open sd.close sd.next [] (sd.tok : acc1) sd.trimR
          -- Default delimiters `{{`/`}}`: the full Handlebars-flavored grammar,
          -- byte-identical to the fixed-delimiter lexer (backslash escapes, triple,
          -- raw blocks, long comments, `~`). The opener probe is gated on `{`, so
          -- non-brace content costs one comparison.
          | open == "{{" && close == "}}" && c == '\\' ->
              if matchAt cs (i + 1) "\\" then
                go (i + 2) open close (i + 2) (pushSeg segStart frags i "\\") acc pend
              else case escapedOpenerAt (i + 1) of
                Just lit ->
                  let
                    next = i + 1 + SCU.length lit
                  in
                    go next open close next (pushSeg segStart frags i lit) acc pend
                Nothing -> go (i + 1) open close (i + 1) (pushSeg segStart frags i "\\") acc pend
          | open == "{{" && close == "}}" && c == '{' && isOpenerAt i -> case readTag i of
              Left e -> Left e
              Right res ->
                let
                  acc2 = consTok res.mtok (flush (contentTo segStart frags i) acc pend res.trimL)
                in
                  case delimSwitch res.mtok of
                    Left e -> Left e
                    Right Nothing -> go res.next open close res.next [] acc2 res.trimR
                    Right (Just d) -> go res.next d.open d.close res.next [] acc2 res.trimR
          | open == "{{" && close == "}}" -> go (i + 1) open close segStart frags acc pend
          -- Custom delimiters: the reduced Mustache grammar (no triple/raw/long
          -- comment/`~` — those forms do not rebase, ADR-015).
          | matchAt cs i open -> case readCustomTag i open close of
              Left e -> Left e
              Right res ->
                let
                  acc2 = consTok res.mtok (flush (contentTo segStart frags i) acc pend res.trimL)
                in
                  case delimSwitch res.mtok of
                    Left e -> Left e
                    Right Nothing -> go res.next open close res.next [] acc2 res.trimR
                    Right (Just d) -> go res.next d.open d.close res.next [] acc2 res.trimR
          | otherwise -> go (i + 1) open close segStart frags acc pend

  -- Push an optional tag token onto the (reversed) accumulator.
  consTok :: Maybe RawTok -> List RawTok -> List RawTok
  consTok mtok acc1 = maybe acc1 (\t -> t : acc1) mtok

  -- Decide whether a just-read token switches the delimiters. A
  -- `{{! @delimiters: A B }}` short comment is *positional* (like an inline
  -- `{{=A B=}}`): when `mustacheDelims` is on it switches the active pair from
  -- here on (the comment is still emitted, so it is carried as a directive the
  -- engine ignores — lexer-acted, like `@trim`). Gated on `mustacheDelims`, so
  -- the Handlebars family (FullBars, default) never treats `@delimiters`
  -- specially. `Right Nothing` ⇒ no switch; this is a pure decision, never
  -- recursing — `go` must call itself directly to keep its tail-call loop.
  delimSwitch :: Maybe RawTok -> Either ParseError (Maybe { open :: String, close :: String })
  delimSwitch = case _ of
    Just (RComment _ _ interior) | cfg.mustacheDelims -> case parseDelimDirective interior of
      Nothing -> Right Nothing
      Just (Left e) -> Left e
      Just (Right d) -> Right (Just d)
    _ -> Right Nothing

  -- A `@delimiters: A B` directive comment ⇒ `Just (Right {open,close})`; a
  -- malformed one ⇒ `Just (Left err)`; any other comment ⇒ `Nothing`.
  parseDelimDirective :: String -> Maybe (Either ParseError { open :: String, close :: String })
  parseDelimDirective interior =
    let
      t = trimStartWs interior
    in
      case
        SCU.stripPrefix (Pattern "@delimiters") t >>=
          (trimStartWs >>> SCU.stripPrefix (Pattern ":"))
        of
        Nothing -> Nothing
        Just val -> Just case delimWords val of
          Just d | validDelim d.open && validDelim d.close -> Right d
          _ -> Left (LexError "@delimiters expects two whitespace-separated delimiters (no '=')" 0)

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
    | matchAt cs i "{{{{" = Just "{{{{" -- raw block, Handlebars form (no `#`)
    | matchAt cs i "{{~!--" = Just "{{~!--"
    | matchAt cs i "{{!--" = Just "{{!--"
    | matchAt cs i "{{{^" = Just "{{{^" -- inverse block, triple-brace variant
    | matchAt cs i "{{{/" = Just "{{{/" -- close, triple-brace variant
    | matchAt cs i "{{{" = Just "{{{"
    | matchAt cs i "{{~!" = Just "{{~!"
    | matchAt cs i "{{!" = Just "{{!"
    | matchAt cs i "{{~#" = Just "{{~#"
    | matchAt cs i "{{#" = Just "{{#"
    | matchAt cs i "{{~^" = Just "{{~^"
    | matchAt cs i "{{^" = Just "{{^" -- inverse block (Handlebars inverted section)
    | matchAt cs i "{{~<" = Just "{{~<"
    | matchAt cs i "{{<" = Just "{{<" -- parent block (Mustache inheritance `{{<name}}`)
    | matchAt cs i "{{~$" = Just "{{~$"
    | matchAt cs i "{{$" = Just "{{$" -- override block (Mustache inheritance `{{$name}}`)
    | matchAt cs i "{{~/" = Just "{{~/"
    | matchAt cs i "{{/" = Just "{{/"
    | matchAt cs i "{{~&" = Just "{{~&"
    | matchAt cs i "{{&" = Just "{{&" -- unescaped output (Handlebars `&`)
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
    | matchAt cs i "{{{{#" = readRaw i 5 -- `{{{{#name}}}}` (FlatBars/back-compat)
    | matchAt cs i "{{{{" = readRaw i 4 -- `{{{{name}}}}` (Handlebars raw block)
    | matchAt cs i "{{~!--" = readLongComment i "{{~!--"
    | matchAt cs i "{{!--" = readLongComment i "{{!--"
    | matchAt cs i "{{{^" = readBlockOpen i "{{{^" Inverse "}}}"
    | matchAt cs i "{{{/" = readClose i "{{{/" "}}}"
    | matchAt cs i "{{{" = readOutput i
    | matchAt cs i "{{~!" = readShortComment i "{{~!"
    | matchAt cs i "{{!" = readShortComment i "{{!"
    -- `{{#*name}}` (inline-partial decorator) and `{{#>name}}` (partial block) are
    -- distinct openers — matched before bare `{{#}}` so the `*`/`>` is consumed as
    -- part of the opener, not folded into the head.
    | matchAt cs i "{{~#*" = readBlockOpen i "{{~#*" Decorator "}}"
    | matchAt cs i "{{#*" = readBlockOpen i "{{#*" Decorator "}}"
    | matchAt cs i "{{~#>" = readBlockOpen i "{{~#>" PartialBlock "}}"
    | matchAt cs i "{{#>" = readBlockOpen i "{{#>" PartialBlock "}}"
    | matchAt cs i "{{~#" = readBlockOpen i "{{~#" Section "}}"
    | matchAt cs i "{{#" = readBlockOpen i "{{#" Section "}}"
    | matchAt cs i "{{~^" = readBlockOpen i "{{~^" Inverse "}}"
    | matchAt cs i "{{^" = readBlockOpen i "{{^" Inverse "}}"
    | matchAt cs i "{{~<" = readBlockOpen i "{{~<" Parent "}}"
    | matchAt cs i "{{<" = readBlockOpen i "{{<" Parent "}}"
    | matchAt cs i "{{~$" = readBlockOpen i "{{~$" BlockDef "}}"
    | matchAt cs i "{{$" = readBlockOpen i "{{$" BlockDef "}}"
    | matchAt cs i "{{~/" = readClose i "{{~/" "}}"
    | matchAt cs i "{{/" = readClose i "{{/" "}}"
    | matchAt cs i "{{~&" = readAmp i "{{~&"
    | matchAt cs i "{{&" = readAmp i "{{&"
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
              { mtok: Just (ROutput { start: i, end: q + 3 } start t.core (interiorAt start t.core))
              , next: q + 3
              , trimL: t.trimL
              , trimR: t.trimR
              }

  -- A block opener `{{# / {{^ [~] name args [~] close`, carrying its `sigil`
  -- (Section/Inverse). `close` is `}}` for double-brace openers, `}}}` for the
  -- triple-brace inverse variant `{{{^…}}}`.
  readBlockOpen :: Int -> String -> Sigil -> String -> Either ParseError TagResult
  readBlockOpen i opener sigil close =
    let
      start = i + SCU.length opener
      cl = SCU.length close
    in
      case findFrom cs start close of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice cs start q)
          in
            Right
              { mtok: Just
                  (ROpen { start: i, end: q + cl } sigil start t.core (interiorAt start t.core))
              , next: q + cl
              , trimL: leadTrimAt i || t.trimL
              , trimR: t.trimR
              }

  -- A close `{{/ [~] name [~] close`; `close` is `}}` or `}}}` (the triple-brace
  -- `{{{/…}}}` that pairs with the triple-brace inverse open).
  readClose :: Int -> String -> String -> Either ParseError TagResult
  readClose i opener close =
    let
      start = i + SCU.length opener
      cl = SCU.length close
    in
      case findFrom cs start close of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice cs start q)
          in
            Right
              { mtok: Just (RClose { start: i, end: q + cl } start t.core (interiorAt start t.core))
              , next: q + cl
              , trimL: leadTrimAt i || t.trimL
              , trimR: t.trimR
              }

  -- Unescaped output `{{& [~] expr [~] }}` (Handlebars' `&` alias for `{{{…}}}`).
  readAmp :: Int -> String -> Either ParseError TagResult
  readAmp i opener =
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
              { mtok: Just (RAmp { start: i, end: q + 2 } start t.core (interiorAt start t.core))
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
              { mtok: Just (RSep { start: i, end: q + 2 } start t.core (interiorAt start t.core))
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

  -- A long comment `{{!-- … --}}` renders nothing and carries no directive, so
  -- it is dropped (`mtok: Nothing`) — except under `keepLongComments`, where it
  -- is emitted as a span-only `RLongComment` for the highlighter. Either way the
  -- `~`/standalone trims are the same, so render output never depends on this.
  readLongComment :: Int -> String -> Either ParseError TagResult
  readLongComment i opener = case findFrom cs (i + SCU.length opener) "--}}" of
    Nothing -> Left (UnterminatedComment i)
    Just q -> Right
      { mtok: if cfg.keepLongComments then Just (RLongComment { start: i, end: q + 4 }) else Nothing
      , next: q + 4
      , trimL: leadTrimAt i
      , trimR: matchAt cs (q - 1) "~"
      }

  -- `sigil` is the opener length: 5 for `{{{{#`, 4 for the bare `{{{{`. Both
  -- close with the name-matched `{{{{/name}}}}`; the head is read from `start`.
  readRaw :: Int -> Int -> Either ParseError TagResult
  readRaw i sigil =
    let
      start = i + sigil
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
                    { mtok: Just
                        ( RRaw { start: i, end } (sigil == 5) start head (interiorAt start head)
                            (slice cs bodyStart qc)
                        )
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

  -- A set-delimiter tag `<open>=NEW-OPEN NEW-CLOSE=<close>`. Reads the two
  -- whitespace-separated delimiters, validates them (per the Mustache manual:
  -- non-empty, no whitespace — guaranteed by the split — and no `=`), and returns
  -- the new active pair for the continuing scan. Renders nothing (`RSetDelim`).
  readSetDelim :: Int -> String -> String -> Either ParseError SetDelimResult
  readSetDelim i open close =
    let
      start = i + SCU.length open + 1 -- after `<open>=`
      closePat = "=" <> close
    in
      case findFrom cs start closePat of
        Nothing -> Left
          (LexError ("unterminated set-delimiter tag (expected '=" <> close <> "')") i)
        Just q -> case delimWords (slice cs start q) of
          Nothing -> Left (LexError "set-delimiter expects two whitespace-separated delimiters" i)
          Just d
            | validDelim d.open && validDelim d.close -> Right
                { tok: RSetDelim { start: i, end: q + SCU.length closePat }
                , next: q + SCU.length closePat
                , open: d.open
                , close: d.close
                , trimL: false
                , trimR: false
                }
            | otherwise -> Left (LexError "set-delimiter values may not contain '='" i)

  -- The two whitespace-separated delimiter words of a set-delimiter interior
  -- (exactly two; nothing may follow the second).
  delimWords :: String -> Maybe { open :: String, close :: String }
  delimWords s =
    let
      a0 = Array.dropWhile isSpace (SCU.toCharArray s)
      w1 = Array.takeWhile (not <<< isSpace) a0
      a1 = Array.dropWhile isSpace (Array.dropWhile (not <<< isSpace) a0)
      w2 = Array.takeWhile (not <<< isSpace) a1
      rest = Array.dropWhile isSpace (Array.dropWhile (not <<< isSpace) a1)
    in
      if Array.null w1 || Array.null w2 || not (Array.null rest) then Nothing
      else Just { open: SCU.fromCharArray w1, close: SCU.fromCharArray w2 }

  -- A custom delimiter is non-empty (ensured by `delimWords`) and contains no `=`.
  validDelim :: String -> Boolean
  validDelim d = not (Array.elem '=' (SCU.toCharArray d))

  -- A tag under *custom* delimiters: `<open> [sigil] interior <close>`. The reduced
  -- Mustache grammar — the sigil (if any) is the single character immediately
  -- after `open` (mirroring how the default openers require `{{#` with no gap);
  -- `>` partials and bare interpolation fall through to `RSep` (keeping the full
  -- interior, exactly as `{{> x}}` / `{{ x }}` do under default delimiters).
  readCustomTag :: Int -> String -> String -> Either ParseError TagResult
  readCustomTag i open close =
    let
      start = i + SCU.length open
      cl = SCU.length close
    in
      case findFrom cs start close of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            span = { start: i, end: q + cl }
            next = q + cl
            afterSig = slice cs (start + 1) q
            afterHash = slice cs (start + 2) q
            interior = slice cs start q
            mk tok = Right { mtok: Just tok, next, trimL: false, trimR: false }
            -- The interior is lexed inside the chosen branch (these helpers are
            -- functions, so `interiorAt` fires only when the branch is taken) — so
            -- each tag tokenizes its interior exactly once, never the unused
            -- sigil/hash variant.
            sigOpen sig = mk (ROpen span sig (start + 1) afterSig (interiorAt (start + 1) afterSig))
            hashOpen sig = mk
              (ROpen span sig (start + 2) afterHash (interiorAt (start + 2) afterHash))
          in
            case Array.index cs start of
              -- `#*name` (decorator) / `#>name` (partial block): the marker after
              -- `#` opens a distinct sigil, with the head starting two chars in.
              Just '#' -> case Array.index cs (start + 1) of
                Just '*' -> hashOpen Decorator
                Just '>' -> hashOpen PartialBlock
                _ -> sigOpen Section
              Just '^' -> sigOpen Inverse
              Just '<' -> sigOpen Parent
              Just '$' -> sigOpen BlockDef
              Just '/' -> mk (RClose span (start + 1) afterSig (interiorAt (start + 1) afterSig))
              Just '&' -> mk (RAmp span (start + 1) afterSig (interiorAt (start + 1) afterSig))
              Just '!' -> mk (RComment span (start + 1) afterSig)
              _ -> mk (RSep span start interior (interiorAt start interior))
