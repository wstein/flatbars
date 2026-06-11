-- | The **MaxBars structural lexer** — forked from the shared `FlatBars.Lexer`
-- | (ADR-041) so the MaxBars surface *owns* its front-end: a change to the shared
-- | lexer (for RawBars/ClassicBars/MinBars) can no longer reach MaxBars, and the
-- | MaxBars grammar can be frozen independently for production.
-- |
-- | `tokenize` scans MaxBars source into the flat `RawTok` stream with the MaxBars
-- | config **baked in** — no `LexConfig`/`LexOptions` knobs at the boundary:
-- | `{{ … }}` output (output-only — ADR-039), `{% … %}` statement tags, `{# … #}`
-- | comments, `{{#…}}…{{/…}}` blocks, the `{{{{#…}}}}` raw region, the infix-operator
-- | / `..` range / `[…]`·`{k:v}` collection interior lexing, standalone-line
-- | trimming, and the recovering scan (ADR-023). It is structural only — it never
-- | interprets a tag's contents, just delimits them — so each tag token carries its
-- | interior text and offset for the MaxBars expression grammar (`MaxBars.Expr`).
-- |
-- | Two grammars MaxBars does not have are baked **out**, not gated: the Mustache
-- | set-delimiter machinery (`{{=A B=}}`) — so `open`/`close` are the constant
-- | `{{`/`}}` — and the Handlebars output-only holdovers (`{{{ … }}}` raw output is
-- | a lex error, `{{! … }}`/`{{!-- --}}` are not comments; ADR-039 `bracesOutputOnly`).
-- | The Handlebars `{{&}}`/`{{^}}` and the `{{<`/`{{$` inheritance sigils MaxBars
-- | rejects are still *produced* here (their trim is parser-coupled — the parser
-- | rejects them with a located `DisallowedShape`). The equivalence gate
-- | (`Test.MaxBars` — the lexer ≡ the shared lexer driven with MaxBars's config over
-- | valid MaxBars input) pins this fork to the reference until the Phase 4 freeze.
module MaxBars.Lexer
  ( RawTok(..)
  , tokenize
  , trimStandalone
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.String.CodeUnits as SCU
import Data.String.Common (joinWith, trim)
import FlatBars.Error (ParseError(..))
import FlatBars.Span (Span)
import FlatBars.Syntax (Sigil(..))
import FlatBars.Token (Interior)
import MaxBars.Token (tokenizeInterior)

-- | A flat template token. Comments never appear (they are dropped); `~`
-- | whitespace control has already been applied to the `Content` runs. Each tag
-- | carries its `Span`, the source offset of its interior (`Int`), the interior
-- | text, and — for the expression-bearing tags — that interior already lexed
-- | (`Interior`, the meaning-free `PosToken` stream or its deferred lex error).
-- | The parser and the highlighter consume the pre-lexed `Interior` rather than
-- | re-lexing the text; the text is retained for directive lifting,
-- | standalone-whitespace head-words, and raw-block close-matching.
data RawTok
  = RContent Span String -- span of the source run, text
  | RAmp Span Int String Interior -- {{& <interior> }} — unescaped output (Handlebars `&`)
  | ROpen Span Sigil Int String Interior -- {{# / {{^ / {{< / {{$ <interior> }} — sigil distinguishes them
  | RClose Span Int String Interior -- {{/ <interior> }}
  | RSep Span Int String Interior -- {{ <interior> }} — a name-agnostic separator
  -- span, `hasHash` (true for the `{{{{# }}}}` FlatBars spelling, false for the
  -- bare `{{{{ }}}}` Handlebars spelling — gated separately per dialect), base,
  -- head, the head's `Interior`, body. `{{{{# <interior> }}}} <body> {{{{/ name }}}}`.
  | RRaw Span Boolean Int String Interior String
  -- {# <interior> #} — a Django/Jinja inline comment (the MaxBars comment form),
  -- kept for directive lifting (the parser scans its interior for `@key` heads). It
  -- renders nothing — the parser drops it after directive extraction.
  | RComment Span Int String
  -- An unterminated construct: a `{{` / `{#` / `{{{{` opener with no
  -- closer. The *recovering* scanner (ADR-023, extended to the lexer) emits this
  -- instead of bailing — it spans the orphan opener up to the next opener (or
  -- EOF), carries the structural `ParseError`, and resyncs there so the rest of
  -- the template still lexes (so highlighting survives a half-typed tag). The
  -- parser harvests its error; `tokenizeSpans` paints it as the `unterminated`
  -- kind; the fail-fast `parse` still reports it.
  | RError Span ParseError

derive instance eqRawTok :: Eq RawTok

instance showRawTok :: Show RawTok where
  show = case _ of
    RContent _ s -> "RContent " <> show s
    RAmp _ _ s _ -> "RAmp " <> show s
    ROpen _ sig _ s _ -> "ROpen " <> show sig <> " " <> show s
    RClose _ _ s _ -> "RClose " <> show s
    RSep _ _ s _ -> "RSep " <> show s
    RRaw _ hash _ s _ b -> "RRaw " <> show hash <> " " <> show s <> " " <> show b
    RComment _ _ s -> "RComment " <> show s
    RError _ e -> "RError " <> show e

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

-- | The first whitespace-delimited word of a string (leading whitespace skipped) — the
-- | head keyword of a `{% … %}` statement tag. `""` for an all-whitespace string.
firstWord :: String -> String
firstWord s =
  SCU.fromCharArray
    (Array.takeWhile (not <<< isSpace) (Array.dropWhile isSpace (SCU.toCharArray s)))

-- | A `{% endX %}` close head (`endif`, `endeach`, …): `end` + a non-empty block name.
isStmtClose :: String -> Boolean
isStmtClose h = SCU.take 3 h == "end" && SCU.length h > 3

-- | A `{% %}` clause separator head — splits the enclosing block (docs-19), the `{% %}`
-- | analogue of the bare `{{else}}` / `{{when}}` / `{{elif}}`.
isStmtSep :: String -> Boolean
isStmtSep h = h == "else" || h == "elif" || h == "when"

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
    RContent sp s ->
      let
        -- the tag *before* this content is standalone ⇒ drop its trailing line.
        s1 = if standaloneAt (j - 1) then dropLeadingLine s else s
        -- the tag *after* this content is standalone ⇒ drop this line's indent.
        s2 = if standaloneAt (j + 1) then dropTrailingIndent s1 else s1
      in
        -- the source span is kept (the original run's location) — trimming removes
        -- whitespace from the rendered text, not from where it sits in the source.
        RContent sp s2
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
      Just (RContent _ s)
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
      Just (RContent _ s)
        | hasNL s -> allWs (beforeFirstNL s) -- reached this line's end
        | allWs s -> goRight (k + 1) -- a wholly-blank run; keep scanning right
        | otherwise -> false -- visible text on this line
      Just _ -> false -- another tag on this line ⇒ not standalone

blockLevel :: RawTok -> Boolean
blockLevel = case _ of
  ROpen _ _ _ _ _ -> true
  RClose _ _ _ _ -> true
  RComment _ _ _ -> true
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
-- | tokenizer). `open`/`close` are the delimiter pair — always `{{`/`}}` for
-- | MaxBars, which never switches delimiters (ADR-041 dropped the Mustache
-- | set-delimiter machinery), so the pair is threaded as a constant.
-- | `statementTags` enables the Django-style `{% … %}` statement surface (docs-19):
-- | a `{% … %}` tag lexes into the *same* structural tokens its `{{ … }}` counterpart
-- | would — `{% if %}`/`{% each %}`/… → `ROpen Section`, `{% endX %}` → `RClose X`,
-- | `{% else %}`/`{% elif %}`/`{% when %}` → `RSep` — so the parser, engine, and every
-- | backend are unchanged (docs-19 §3). MaxBars keeps it on (it selects the `-`
-- | whitespace-control marker over `~`).
type LexConfig =
  { open :: String
  , close :: String
  , statementTags :: Boolean
  }

-- | Default template-lexer config: `{{`/`}}`, no `{% %}` statement tags.
defaultLexConfig :: LexConfig
defaultLexConfig =
  { open: "{{"
  , close: "}}"
  , statementTags: false
  }

-- | The frozen MaxBars lexer config: `{{`/`}}` delimiters, `{% %}` statement tags
-- | on, no set-delimiter switching, long comments dropped (the parse default).
maxLexConfig :: LexConfig
maxLexConfig = defaultLexConfig { statementTags = true }

-- | Tokenize MaxBars source into the flat `RawTok` stream — the owned entry, no
-- | knobs (ADR-041). The MaxBars config is baked in; tag interiors are lexed by the
-- | owned `MaxBars.Token.tokenizeInterior` (infix / `..` / collection literals).
tokenize :: String -> Either ParseError (Array RawTok)
tokenize = tokenizeTemplate maxLexConfig

type TagResult = { mtok :: Maybe RawTok, next :: Int, trimL :: Boolean, trimR :: Boolean }

-- | Scan a template into the flat `RawTok` stream. Each tag's interior is lexed
-- | *here*, at scan time, by the owned `MaxBars.Token.tokenizeInterior` and carried
-- | on the token. The structural shape (tag boundaries, sigils, spans, raw bodies)
-- | is interior-grammar-independent.
tokenizeTemplate :: LexConfig -> String -> Either ParseError (Array RawTok)
tokenizeTemplate cfg src = map finalize (go 0 cfg.open cfg.close 0 [] Nil false)
  where
  cs = SCU.toCharArray src
  len = Array.length cs

  -- Lex a tag interior at its source offset — the pre-lexed `Interior` every
  -- expression-bearing `RawTok` carries (the owned MaxBars interior tokenizer).
  interiorAt :: Int -> String -> Interior
  interiorAt base s = tokenizeInterior base s

  -- Find a tag's close delimiter from `from`. MaxBars has collection literals, so
  -- the scan is *brace-aware*: it balances `{ }` and skips string literals, so a
  -- dict literal's own `}` is consumed before the tag close and `{{#with {a: 1}}}`
  -- needs no disambiguating space (ADR-024 width detection).
  closeFrom :: Int -> String -> Maybe Int
  closeFrom from close = findClose from close

  -- The brace/string-aware close finder: the `close` delimiter at brace depth 0.
  -- A `{` opens a level, a `}` closes one (a stray `}` at depth 0 is ignored), and
  -- a quoted string (`"…"`/`'…'`, with `\` escapes) is skipped whole — so a `}}` or
  -- `{` inside a string never moves the depth nor ends the tag.
  findClose :: Int -> String -> Maybe Int
  findClose from close = scan from 0
    where
    scan i depth
      | i >= len = Nothing
      | depth == 0 && matchAt cs i close = Just i
      | otherwise = case Array.index cs i of
          Just '"' -> scan (skipString (i + 1) '"') depth
          Just '\'' -> scan (skipString (i + 1) '\'') depth
          Just '{' -> scan (i + 1) (depth + 1)
          Just '}' -> scan (i + 1) (if depth > 0 then depth - 1 else 0)
          _ -> scan (i + 1) depth
    skipString j q
      | j >= len = j
      | Array.index cs j == Just '\\' = skipString (j + 2) q
      | Array.index cs j == Just q = j + 1
      | otherwise = skipString (j + 1) q

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
    | i >= len = Right
        (flush { start: segStart, end: i } (contentTo segStart frags i) acc pend false)
    | otherwise = case Array.index cs i of
        Nothing -> Right
          (flush { start: segStart, end: i } (contentTo segStart frags i) acc pend false)
        Just c
          -- A Django-style statement tag `{% … %}` (docs-19). Checked before the `{{`
          -- opener probe; it re-delimits the same structural tokens (`ROpen`/`RClose`/
          -- `RSep`) so the parser is unchanged.
          | matchAt cs i "{%" -> case readStatementTag i of
              Left e -> recoverFrom i e segStart frags acc pend open close
              Right res ->
                let
                  acc2 = consTok res.mtok
                    ( flush { start: segStart, end: i } (contentTo segStart frags i) acc pend
                        res.trimL
                    )
                in
                  go res.next open close res.next [] acc2 res.trimR
          -- A Django/Jinja inline comment `{# … #}` (ADR-039 item 1; the MaxBars
          -- comment form, replacing the Handlebars `{{! … }}`). It renders nothing —
          -- emitted as an `RComment` the parser drops. Checked before the `{{` opener
          -- probe so a leading `{#` is never read as a dict literal.
          | matchAt cs i "{#" -> case readInlineComment i of
              Left e -> recoverFrom i e segStart frags acc pend open close
              Right res ->
                let
                  acc2 = consTok res.mtok
                    ( flush { start: segStart, end: i } (contentTo segStart frags i) acc pend
                        res.trimL
                    )
                in
                  go res.next open close res.next [] acc2 res.trimR
          -- The `{{`/`}}` grammar (backslash escapes, triple, raw blocks, long
          -- comments, `~`). The opener probe is gated on `{`, so non-brace content
          -- costs one comparison. MaxBars never switches delimiters (ADR-041 — the
          -- Mustache set-delimiter machinery is gone), so `open`/`close` are always
          -- `{{`/`}}` and no token can re-delimit.
          | c == '\\' ->
              if matchAt cs (i + 1) "\\" then
                go (i + 2) open close (i + 2) (pushSeg segStart frags i "\\") acc pend
              else case escapedOpenerAt (i + 1) of
                Just lit ->
                  let
                    next = i + 1 + SCU.length lit
                  in
                    go next open close next (pushSeg segStart frags i lit) acc pend
                Nothing -> go (i + 1) open close (i + 1) (pushSeg segStart frags i "\\") acc pend
          | c == '{' && isOpenerAt i -> case readTag i of
              Left e -> recoverFrom i e segStart frags acc pend open close
              Right res ->
                let
                  acc2 = consTok res.mtok
                    ( flush { start: segStart, end: i } (contentTo segStart frags i) acc pend
                        res.trimL
                    )
                in
                  go res.next open close res.next [] acc2 res.trimR
          | otherwise -> go (i + 1) open close segStart frags acc pend

  -- Push an optional tag token onto the (reversed) accumulator.
  consTok :: Maybe RawTok -> List RawTok -> List RawTok
  consTok mtok acc1 = maybe acc1 (\t -> t : acc1) mtok

  -- Recover from an unterminated construct (ADR-023, extended to the lexer): emit
  -- an `RError` spanning the orphan opener `i` up to the *next* opener (or EOF) so
  -- a later valid tag still lexes, flush the content before it, and resume there.
  -- This is the COLD path (errors are rare) — the mutual call back into `go` does
  -- not grow the hot content scan's stack, which stays in `go`'s self-recursion.
  recoverFrom
    :: Int
    -> ParseError
    -> Int
    -> Array String
    -> List RawTok
    -> Boolean
    -> String
    -> String
    -> Either ParseError (List RawTok)
  recoverFrom i e segStart frags acc pend open close =
    let
      resync = fromMaybe len (findFrom cs (i + SCU.length open) open)
      acc2 = RError { start: i, end: resync } e : flush { start: segStart, end: i }
        (contentTo segStart frags i)
        acc
        pend
        false
    in
      go resync open close resync [] acc2 false

  -- The content string for a run: prior escape fragments followed by the
  -- still-uncopied slice `[segStart, end)`.
  contentTo :: Int -> Array String -> Int -> String
  contentTo segStart frags end = joinWith "" (Array.snoc frags (slice cs segStart end))

  -- Close the current segment `[segStart, end)` and append a literal fragment.
  pushSeg :: Int -> Array String -> Int -> String -> Array String
  pushSeg segStart frags end lit = Array.snoc (Array.snoc frags (slice cs segStart end)) lit

  -- Flush a content string (prepending to the reversed token list), applying a
  -- pending leading trim and an optional trailing trim (from the following tag).
  -- `span` is the source run `[segStart, i)`; kept even when `~`-trimming shortens
  -- the rendered text (the literal still sits at that source location).
  flush :: Span -> String -> List RawTok -> Boolean -> Boolean -> List RawTok
  flush span s0 acc pend trimR =
    let
      s1 = if pend then trimStartWs s0 else s0
      s2 = if trimR then trimEndWs s1 else s1
    in
      if s2 == "" then acc else RContent span s2 : acc

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
    | matchAt cs i "{{{{#" = readRaw i 5 -- `{{{{#name}}}}` (FlatBars raw block)
    | matchAt cs i "{{{{" = readRaw i 4 -- `{{{{name}}}}` (Handlebars raw block; parser rejects)
    -- `{{ … }}` is OUTPUT-ONLY in MaxBars (ADR-039, `bracesOutputOnly` baked in): a
    -- glued `{{{` is not a tag (unescaped output is `{{ x | safe }}`, a verbatim
    -- region is `{% raw %}`), and the Handlebars comments `{{! }}` / `{{!-- --}}`
    -- are not recognized — they fall through to `{{` output (`{{! x}}` ⇒ `not x`).
    -- The comment form is `{# … #}` (`readInlineComment`, in the `go` scan). This
    -- `{{{` guard also covers the triple-brace `{{{^`/`{{{/` variants (they start
    -- `{{{`), so those Handlebars shapes are rejected here too.
    | matchAt cs i "{{{" =
        Left
          ( LexError
              "`{{{ … }}}` is not a tag here — unescaped output is `{{ x | safe }}`, a verbatim region is `{% raw %}`"
              i
          )
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

  -- The explicit whitespace-control marker. The Handlebars family spells it `~`
  -- (`{{~ … ~}}`); the Django/Jinja/Liquid `{% %}` family spells it `-`
  -- (`{%- … -%}` / `{{- … -}}`, ADR-039 item 3). The two are mutually exclusive by
  -- dialect — `statementTags` selects which one the scanner trims on — so the `~`
  -- spelling is simply inert in the statement-tag dialects (the ADR's "`~` not
  -- adopted"), and `-` is inert (an ordinary operator char) everywhere else.
  trimMark :: String
  trimMark = if cfg.statementTags then "-" else "~"

  -- A left-trim marker may sit immediately after the braces, before the sigil.
  leadTrimAt :: Int -> Boolean
  leadTrimAt i = matchAt cs (i + 2) trimMark

  -- Split a tag interior on a leading/trailing trim marker, returning
  -- (trimL, trimR, core). The marker must be *glued* to the delimiter (it is the
  -- interior's first/last char), so a spaced operator (`{{ a - b }}`, `{{ -x }}`)
  -- never trims — exactly the Jinja rule.
  splitTrims :: String -> { trimL :: Boolean, trimR :: Boolean, core :: String }
  splitTrims raw =
    let
      trimL = SCU.take 1 raw == trimMark
      r1 = if trimL then SCU.drop 1 raw else raw
      trimR = SCU.takeRight 1 r1 == trimMark
      core = if trimR then SCU.dropRight 1 r1 else r1
    in
      { trimL, trimR, core }

  -- A Django/Jinja inline comment `{# [~] … [~] #}` (the MaxBars comment form).
  -- Kept as an `RComment` carrying its interior and offset (so the parser can lift
  -- any `@key` directives); it renders nothing — the parser drops it after
  -- directive extraction. Comments are prose: the close is the plain first-match
  -- `#}` (never brace-aware).
  readInlineComment :: Int -> Either ParseError TagResult
  readInlineComment i =
    let
      start = i + 2
    in
      case findFrom cs start "#}" of
        Nothing -> Left (UnterminatedComment i)
        Just q ->
          Right
            { mtok: Just (RComment { start: i, end: q + 2 } start (slice cs start q))
            , next: q + 2
            , trimL: false
            , trimR: false
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
      case closeFrom start close of
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
      case closeFrom start close of
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
      case closeFrom start "}}" of
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
      case closeFrom start "}}" of
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

  -- A Django-style statement tag `{% [~] head args [~] %}` (docs-19), lexed into the
  -- structural token its `{{ }}` counterpart would yield, so the parser/engine never see
  -- `{% %}`: `{% endX %}` → `RClose X`; `{% else %}` / `{% elif … %}` / `{% when … %}` → a
  -- clause `RSep`; anything else (`{% if … %}`, `{% each … %}`, host block heads) →
  -- `ROpen Section`. The leading/trailing `~` trim works as for any tag.
  readStatementTag :: Int -> Either ParseError TagResult
  readStatementTag i =
    let
      start = if leadTrimAt i then i + 3 else i + 2
    in
      case closeFrom start "%}" of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice cs start q)
            core = t.core
            headWord = firstWord core
            span = { start: i, end: q + 2 }
            mk tok = Right
              { mtok: Just tok, next: q + 2, trimL: leadTrimAt i || t.trimL, trimR: t.trimR }
          in
            if headWord == "" then Left (LexError "empty statement tag '{% %}'" i)
            -- The verbatim region `{% raw %}…{% endraw %}` (ADR-039 item 2). It is NOT a
            -- section open: the body is captured untouched (to the matching `{% endraw %}`),
            -- reusing the very `RRaw`/`RawBlock "raw"` pipeline the `{{{{#raw}}}}` spelling
            -- feeds — pure surface sugar. Only the bare head `raw` (no args) opens a region.
            else if trim core == "raw" then readRawBody i start (q + 2)
            else if isStmtClose headWord then
              let
                name = SCU.drop 3 headWord
              in
                mk (RClose span start name (interiorAt start name))
            -- a clause separator (`else`/`elif`/`when`) OR a block-LESS statement that
            -- lexes to a name-agnostic `RSep` (no `{% end… %}` to pair): the forward
            -- binding `{% set … %}` (docs-17, reparented by `Kernel.SetSugar`), the
            -- block-partial placeholder `{% yield %}` (ADR-039 item 5 — the surface
            -- outputs the scoped `yield` op, exactly as the retired `{{yield}}`), and the
            -- inheritance parent-body splice `{% super %}` (ADR-040 — the named-block
            -- sibling of `{% yield %}`, consumed by `Kernel.Inherit`).
            else if
              isStmtSep headWord || headWord == "set" || trim core == "yield"
                || trim core == "super" then
              mk (RSep span start core (interiorAt start core))
            -- the inheritance directive `{% extends "base" %}` (ADR-040): a block-LESS
            -- statement (no `{% endextends %}`) consumed by the `Kernel.Inherit` flatten
            -- pre-pass; it never reaches the engine. Lexed to a name-agnostic `RSep` whose
            -- name is `extends` and whose one argument is the base name (a string literal).
            else if headWord == "extends" then
              mk (RSep span start core (interiorAt start core))
            -- the partial include `{% include "name" [ctx] [k=v] %}` (ADR-039 item 5).
            -- It lexes to the SAME `>`-prefixed `RSep` the retired `{{> name …}}` does —
            -- pure surface sugar, reusing the existing partial reinterpretation — by
            -- prefixing a `> ` to the args *as they sit in the source*: the interior is
            -- lexed with the args' real source offset so its spans stay accurate (a
            -- synthetic offset mis-resolves the partial name).
            else if headWord == "include" then
              let
                skipSp j =
                  if j < q && maybe false isSpace (Array.index cs j) then skipSp (j + 1) else j
                argsOff = skipSp (skipSp start + SCU.length headWord)
                pcore = "> " <> slice cs argsOff q
              in
                mk (RSep span start pcore (interiorAt (argsOff - 2) pcore))
            else
              mk (ROpen span Section start core (interiorAt start core))

  -- Capture a `{% raw %}…{% endraw %}` body verbatim (ADR-039 item 2): from the
  -- opening tag's close (`bodyStart`) to the matching `{% endraw %}`. Emits the same
  -- `RRaw` the FlatBars `{{{{#raw}}}}` spelling does (`isHash` = `true`, so it clears
  -- the statement-tag dialects' `rawBlockHash` gate) → `RawBlock "raw"` → `rawH`.
  readRawBody :: Int -> Int -> Int -> Either ParseError TagResult
  readRawBody i headStart bodyStart = case findEndrawFrom bodyStart of
    Nothing -> Left (UnterminatedRaw i)
    Just close -> Right
      { mtok: Just
          ( RRaw { start: i, end: close.tagEnd } true headStart "raw"
              (interiorAt headStart "raw")
              (slice cs bodyStart close.tagStart)
          )
      , next: close.tagEnd
      , trimL: leadTrimAt i
      , trimR: false
      }

  -- Scan for the first `{% endraw %}` from `j0`. A `{% … %}` that is not `endraw`
  -- (and a `{%` with no `%}` close) is verbatim body, scanned past — `{% raw %}` does
  -- not nest, exactly as Liquid: the first `{% endraw %}` closes the region.
  findEndrawFrom :: Int -> Maybe { tagStart :: Int, tagEnd :: Int }
  findEndrawFrom = scan
    where
    scan j
      | j >= len = Nothing
      | matchAt cs j "{%" = case closeFrom (j + 2) "%}" of
          Just q
            | firstWord (splitTrims (slice cs (j + 2) q)).core == "endraw" ->
                Just { tagStart: j, tagEnd: q + 2 }
            | otherwise -> scan (q + 2)
          Nothing -> scan (j + 1)
      | otherwise = scan (j + 1)

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
