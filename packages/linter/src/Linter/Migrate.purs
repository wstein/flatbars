-- | **Linter.Migrate** — the *migrate* job (loopvars-linter-spec.md §B.4, phase
-- | X2): a **Handlebars → MaxBars source migrator** with a per-file residual
-- | report. Unlike `Linter.Lower` (which parse-and-reprints), this is a
-- | *minimal-diff source rewrite over the token stream*: it lexes the Handlebars
-- | source with the Handlebars-compatible lexer (`FlatBars.Lexer.tokenizeTemplate`,
-- | which the ClassicBars `defaultParseOptions` parser uses), rewrites only the
-- | tokens that change, and rebuilds the rest from the *original source slice* —
-- | so the author's formatting, spacing, and `~` whitespace-control are preserved
-- | verbatim on every untouched tag.
-- |
-- | ## Rewrites (mechanical, meaning-preserving)
-- |
-- |  * **Control flow re-delimits to Django-style `{% … %}` statement tags**
-- |    (docs-19) — the only control surface MaxBars accepts (`{{ … }}` is output-
-- |    only there). A `{{#name …}}` open → `{% name … %}`, its `{{/name}}` close →
-- |    `{% endname %}`, and a clause separator (`{{else}}` → `{% else %}`,
-- |    `{{else if c}}` → `{% elif c %}`) → a `{% … %}` tag. `~` whitespace-control
-- |    is preserved as `{%~ … ~%}`.
-- |  * `{{^x}}` (inverted section) → `{% unless x %}`; its matching `{{/x}}` →
-- |    `{% endunless %}`. Pairing uses an open/close **stack** so nested same-named
-- |    sections close correctly.
-- |  * `{{&x}}` (amp-unescaped) → `{{{x}}}`. (`{{&x}}` and `{{{x}}}` already lex
-- |    to the same skeleton — this is a cosmetic source normalization.)
-- |  * inside ANY tag interior: the `@`-data names migrate to the MaxBars reserved
-- |    variable model (ADR-021): `@index`→`loop.index0`, `@first`→`loop.first`,
-- |    `@key`→`loop.key`, …; `@root.x`→`root.x`; and `../` runs climb —
-- |    `@../index`→`loop.parent.index0`, `@../../x`→`parent.parent.x`.
-- |  * the block-partial reference `{{> @partial-block}}` → `{{yield}}` (MaxBars'
-- |    spelling; the bare `@partial-block` name is otherwise left alone).
-- |
-- | ## Residuals (detected + reported, NOT rewritten — each carries a span,
-- | a message, and a suggested fix):
-- |
-- |  * `ambiguous-section` — a bare Mustache section `{{#name}}` where `name` is
-- |    not a known block helper and carries no arguments (`{{#if name}}` vs
-- |    `{{#each name}}`?).
-- |  * `set-delimiters` — a `{{=<% %>=}}` set-delimiters directive (unsupported);
-- |    scanned from the raw source *before* lexing (it would otherwise lex as a
-- |    bare separator and break) and reported; the migration then proceeds
-- |    best-effort on the rest.
module Linter.Migrate
  ( migrateToMaxBars
  , MigrateResult
  , Residual
  , knownBlockHelpers
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either)
import Data.Foldable (lookup)
import Data.Maybe (Maybe(..), fromMaybe, isJust)
import Data.String (Pattern(..))
import Data.String as String
import Data.String.CodeUnits as SCU
import Data.Tuple (Tuple(..))
import FlatBars.Error (ParseError)
import FlatBars.Lexer (RawTok(..), defaultLexConfig, tokenizeTemplate)
import FlatBars.Span (Span)
import FlatBars.Syntax (Sigil(..))
import FlatBars.Token (defaultLexOptions)
import Kernel.Prelude (blockHelperNames, loopFieldCanonical)

-- | One flagged construct the migrator could not (or should not) rewrite
-- | mechanically. `kind` is a stable tag (`"parent-data"`, `"ambiguous-section"`,
-- | `"set-delimiters"`); `span` locates it in the *original* source; `message`
-- | describes the problem and `suggestion` the manual fix.
type Residual =
  { kind :: String
  , span :: Span
  , message :: String
  , suggestion :: String
  }

-- | The migration result: the rewritten MaxBars `source` and the per-file list
-- | of `residuals` for human review.
type MigrateResult =
  { source :: String
  , residuals :: Array Residual
  }

-- | The known block helpers, used by the ambiguous-section detector. A bare
-- | `{{#name}}` whose `name` is *not* in this set and carries no arguments is a
-- | Mustache truthy/list section whose MaxBars intent is ambiguous
-- | (`{{#if name}}` vs `{{#each name}}`). This is the prelude's block-helper set
-- | (`Kernel.Prelude.prelude`, the entries with `block = true`): `if`, `unless`,
-- | `each`, `with`, `raw`, `apply`, `inline`, `partial`. (`let` is NOT a prelude
-- | helper — there is no `let` block — so it is intentionally absent.)
knownBlockHelpers :: Array String
knownBlockHelpers = blockHelperNames

-- | Migrate Handlebars source to MaxBars source, collecting a residual report.
-- | A lex failure is propagated as `Left`.
migrateToMaxBars :: String -> Either ParseError MigrateResult
migrateToMaxBars src = do
  -- NB: this rewrites from source slices + interior *strings* only; the pre-lexed
  -- interior tokens `tokenizeTemplate` populates are unused here (it has no
  -- structure-only mode). Wasted work, but the migrator is a rare offline tool —
  -- not a bug to "fix" by dropping the interior.
  toks <- tokenizeTemplate defaultLexConfig defaultLexOptions src
  let
    delimResiduals = scanSetDelimiters src
    walk = rewrite src toks
  pure
    { source: walk.source
    , residuals: delimResiduals <> walk.residuals
    }

--------------------------------------------------------------------------------
-- The token-stream rewrite
--------------------------------------------------------------------------------

-- | A close-pairing decision pushed by an `ROpen`: when its matching `RClose`
-- | arrives, was the open rewritten to a `{{#unless …}}` (so the close becomes
-- | `{{/unless}}`), or kept verbatim (so the close is sliced verbatim)?
data CloseRule = CloseUnless | CloseEnd

-- | The fold accumulator: the emitted source so far (reversed list of chunks),
-- | the residuals so far (reversed), and the open/close stack of pairing rules.
type Acc =
  { chunks :: Array String
  , residuals :: Array Residual
  , stack :: Array CloseRule
  }

rewrite :: String -> Array RawTok -> { source :: String, residuals :: Array Residual }
rewrite src toks =
  let
    final = Array.foldl (step src) { chunks: [], residuals: [], stack: [] } toks
  in
    { source: String.joinWith "" (Array.reverse final.chunks)
    , residuals: Array.reverse final.residuals
    }

-- | The original source slice for a span, used to preserve formatting on
-- | untouched tags (including `~` whitespace-control and interior spacing).
sliceSpan :: String -> Span -> String
sliceSpan src span = SCU.slice span.start span.end src

step :: String -> Acc -> RawTok -> Acc
step src acc = case _ of
  RContent _ s -> emit acc s

  ROutput span _ _ _ -> emit acc (mapDataInTag (sliceSpan src span))

  -- `{{&x}}` (amp-unescaped) → `{{{x}}}` (cosmetic normalization). The interior
  -- still gets the `@`-data mapping (e.g. `{{&@key}}` → `{{{key}}}`).
  RAmp _ _ interior _ ->
    emit acc ("{{{" <> mapDataNames interior <> "}}}")

  -- Control flow migrates to Django-style `{% … %}` statement tags (docs-19), the
  -- only control surface MaxBars accepts; `~` whitespace-control is read off the
  -- original slice and re-emitted as `{%~ … ~%}`.
  ROpen span sigil _ interior _ ->
    let
      acc1 = addResiduals acc (openResiduals span sigil interior)
      tr = trimsOf (sliceSpan src span)
    in
      case sigil of
        Inverse ->
          -- `{{^e}}` → `{% unless <e> %}`; map the interior's `@`-data names and
          -- mark the close for `{% endunless %}`.
          push (emit acc1 (stmtTag tr ("unless " <> mapDataNames interior))) CloseUnless
        _ ->
          -- a `{{#name …}}` open → `{% name … %}`; the matching close emits
          -- `{% end<name> %}` (the name comes from the `RClose` token).
          push (emit acc1 (stmtTag tr (mapDataNames interior))) CloseEnd

  RClose span _ name _ ->
    let
      tr = trimsOf (sliceSpan src span)
    in
      case Array.head acc.stack of
        Just CloseUnless ->
          emit (popStack acc) (stmtTag tr "endunless")
        _ ->
          emit (popStack acc) (stmtTag tr ("end" <> name))

  -- A separator. A clause separator (`{{else}}` / `{{else if c}}` → `{% elif c %}` /
  -- `{{when …}}`) becomes a `{% … %}` tag; the Handlebars block-partial reference
  -- `{{> @partial-block}}` → `{{yield}}` (an output, stays `{{ }}`); a bare `{{name}}`
  -- output is verbatim (with `@`-data mapping — `@../`/`@root`, ADR-021).
  RSep span _ interior _ ->
    case rewriteElseIf interior of
      Just rebuilt -> emit acc (stmtTag (trimsOf (sliceSpan src span)) rebuilt)
      Nothing
        | isPartialBlockRef interior -> emit acc "{{yield}}"
        | isClauseSep interior -> emit acc
            (stmtTag (trimsOf (sliceSpan src span)) (mapDataNames interior))
        | otherwise -> emit acc (mapDataInTag (sliceSpan src span))

  RComment span _ _ -> emit acc (sliceSpan src span)

  RRaw span _ _ _ _ _ -> emit acc (sliceSpan src span)

  -- Migrate runs under default delimiters, so a set-delimiter tag never appears;
  -- pass it through verbatim if one ever does (minimal-diff rewrite).
  RSetDelim span -> emit acc (sliceSpan src span)

  -- Migrate leaves `keepLongComments` off, so a long-comment token never appears;
  -- emit it verbatim if one ever does (minimal-diff rewrite).
  RLongComment span -> emit acc (sliceSpan src span)

  -- An unterminated construct (recovering lexer): a broken tag can't be safely
  -- rewritten, so preserve the orphan source verbatim (minimal-diff).
  RError span _ -> emit acc (sliceSpan src span)

emit :: Acc -> String -> Acc
emit acc s = acc { chunks = Array.cons s acc.chunks }

addResiduals :: Acc -> Array Residual -> Acc
addResiduals acc rs = acc { residuals = Array.foldl (flip Array.cons) acc.residuals rs }

push :: Acc -> CloseRule -> Acc
push acc r = acc { stack = Array.cons r acc.stack }

popStack :: Acc -> Acc
popStack acc = acc { stack = fromMaybe [] (Array.tail acc.stack) }

--------------------------------------------------------------------------------
-- Interior rewriting
--------------------------------------------------------------------------------

-- | Is this separator interior the Handlebars block-partial reference
-- | `{{> @partial-block}}` (interior `> @partial-block`)? It migrates to the
-- | MaxBars `{{yield}}` rather than a partial *named* `@partial-block`.
isPartialBlockRef :: String -> Boolean
isPartialBlockRef interior = case String.stripPrefix (Pattern ">") (String.trim interior) of
  Just rest -> String.trim rest == "@partial-block"
  Nothing -> false

-- | Map the `@`-data names inside the *interior* of a tag's source slice. The
-- | slice still has its braces/sigil/`~`, so we operate over the whole slice but
-- | the mapping is word-boundary safe (only whole `@name` identifiers change),
-- | so braces and surrounding punctuation are untouched.
mapDataInTag :: String -> String
mapDataInTag = mapDataNames

-- | Replace the Handlebars `@`-data names with their bare MaxBars loop-var
-- | spellings, on whole-identifier boundaries:
-- |
-- |   `@index` → `index0`, `@first` → `first`, `@last` → `last`, `@key` → `key`
-- |
-- | `@index0` (already correct), `@root`, `@../…`, and `@partial-block` are NOT
-- | touched — the longest-match ordering and the word-boundary check ensure
-- | `@index0`/`@../index` are never partially rewritten to `index0...`.
mapDataNames :: String -> String
mapDataNames s = go 0 [] (SCU.toCharArray s)
  where
  go :: Int -> Array String -> Array Char -> String
  go _ out cs = String.joinWith "" (Array.reverse (scan 0 out cs))

  scan :: Int -> Array String -> Array Char -> Array String
  scan i out cs = case Array.index cs i of
    Nothing -> out
    Just c
      | c == '@' && precededByBoundary cs i ->
          case matchData cs i of
            Just (Tuple repl consumed) ->
              scan (i + consumed) (Array.cons repl out) cs
            Nothing -> scan (i + 1) (Array.cons (charStr c) out) cs
      | otherwise -> scan (i + 1) (Array.cons (charStr c) out) cs

-- | Does the `@` at index `i` start a *fresh* identifier — i.e. the char before
-- | it is not part of a word/path? `@` only ever begins an identifier in
-- | Handlebars, so this guards against rewriting an `@` embedded after an
-- | identifier char (defensive; `@` is not an identifier continuation anyway).
precededByBoundary :: Array Char -> Int -> Boolean
precededByBoundary cs i = case Array.index cs (i - 1) of
  Nothing -> true
  Just p -> not (isIdentChar p)

-- | At a `@` (index `i`), try to match one of the mapped data names as a *whole*
-- | identifier — the following char must not be an identifier-continuation char
-- | (so `@index0` and `@index-x` do not match `@index`). Returns the replacement
-- | text and the number of source chars consumed (`@` + name length).
matchData :: Array Char -> Int -> Maybe (Tuple String Int)
matchData cs i =
  let
    -- the whole `@name` run (`.`/`/` are identifier chars, so `@root.title` and
    -- `@../index` come out as one blob).
    run = Array.takeWhile isIdentChar (Array.drop (i + 1) cs)
  in
    case migrateAtName (SCU.fromCharArray run) of
      Just repl -> Just (Tuple repl (1 + Array.length run))
      Nothing -> Nothing

-- | Migrate one Handlebars `@`-name (without the `@`) to the MaxBars reserved
-- | variable model (ADR-021), or `Nothing` to leave it. The full *model*:
-- |
-- |  * loop vars → the `loop` object: `index`/`index0` → `loop.index0`,
-- |    `first` → `loop.first`, … (`index`/`rindex`/`size` are ADR-006 aliases).
-- |  * `root[.…]` → `root[.…]` (the `@` is dropped; root is a reserved name).
-- |  * `../…` runs climb: a loop var → `loop.parent…`, anything else → the
-- |    `parent` context chain. `@../index` → `loop.parent.index0`,
-- |    `@../../x` → `parent.parent.x`, `@../user.name` → `parent.user.name`.
migrateAtName :: String -> Maybe String
migrateAtName name =
  let
    { depth, rest } = stripDotDot name 0
  in
    if depth > 0 then Just
      ( case loopField rest of
          Just f -> "loop" <> joinReplicate depth ".parent" <> "." <> f
          Nothing ->
            let
              chain = String.joinWith "." (Array.replicate depth "parent")
            in
              if rest == "" then chain else chain <> "." <> rest
      )
    else case loopField name of
      Just f -> Just ("loop." <> f)
      _
        | name == "root" || isJust (String.stripPrefix (Pattern "root.") name)
            || isJust (String.stripPrefix (Pattern "root/") name) -> Just name
        | otherwise -> Nothing

-- | A loop-variable name (and the ADR-006 aliases) → its canonical bare `loop`
-- | field, from the shared `Kernel.Prelude.loopFieldCanonical` table (the lifter
-- | reads the same table for its `loop.`-scoped form).
loopField :: String -> Maybe String
loopField name = lookup name loopFieldCanonical

-- | Strip leading `../` runs, counting the depth.
stripDotDot :: String -> Int -> { depth :: Int, rest :: String }
stripDotDot s depth = case String.stripPrefix (Pattern "../") s of
  Just more -> stripDotDot more (depth + 1)
  Nothing -> { depth, rest: s }

-- | `joinReplicate 2 ".parent"` ⇒ `".parent.parent"`.
joinReplicate :: Int -> String -> String
joinReplicate n sep = String.joinWith "" (Array.replicate n sep)

-- | Identifier-continuation characters for Handlebars paths/data names: letters,
-- | digits, `_`, `-`, `.`, `/` (the path/segment characters). `@` is excluded so
-- | a name boundary is detected correctly.
isIdentChar :: Char -> Boolean
isIdentChar c =
  (c >= 'a' && c <= 'z')
    || (c >= 'A' && c <= 'Z')
    || (c >= '0' && c <= '9')
    || c == '_'
    || c == '-'
    || c == '.'
    || c == '/'

charStr :: Char -> String
charStr = SCU.singleton

-- | `{{else if c}}` (interior `else if c`, modulo `~` and spacing) → `elif c`.
-- | Returns `Nothing` for any other separator (left verbatim). The leading `~`
-- | (if any) is preserved on the rebuilt interior; the trailing `~` likewise.
-- | `{{else if c}}` → the bare `elif c` interior (whitespace-control trims are
-- | re-applied by `stmtTag` from the source slice, so this returns no `~`).
rewriteElseIf :: String -> Maybe String
rewriteElseIf interior =
  let
    -- peel an optional leading `~` and trailing `~`, operate on the core.
    lead = SCU.take 1 interior == "~"
    afterLead = if lead then SCU.drop 1 interior else interior
    trail = SCU.takeRight 1 afterLead == "~"
    core = if trail then SCU.dropRight 1 afterLead else afterLead
    trimmed = String.trim core
  in
    case String.stripPrefix (Pattern "else if ") trimmed of
      Just rest -> Just ("elif " <> mapDataNames (String.trim rest))
      Nothing -> Nothing

-- | The leading/trailing `~` whitespace-control flags of a tag, read off its raw
-- | source slice (`{{~…~}}`), so a re-delimited `{% … %}` keeps them faithfully.
trimsOf :: String -> { l :: Boolean, r :: Boolean }
trimsOf slice = { l: SCU.take 3 slice == "{{~", r: SCU.takeRight 3 slice == "~}}" }

-- | Build a `{% … %}` statement tag for a (trimmed) head, re-applying `~` trims as
-- | `{%~ … ~%}`. The head is already `@`-data-mapped by the caller.
stmtTag :: { l :: Boolean, r :: Boolean } -> String -> String
stmtTag tr head =
  "{%" <> (if tr.l then "~" else "") <> " " <> String.trim head <> " "
    <> (if tr.r then "~" else "")
    <> "%}"

-- | A `RSep` interior is a *clause* separator (vs a bare output) when its head name
-- | is one of the engine's clause keywords (`else`/`elif`/`when`).
isClauseSep :: String -> Boolean
isClauseSep interior = Array.elem (firstWord interior) [ "else", "elif", "when" ]

-- | The first whitespace-delimited word of an interior (a leading `~` stripped).
firstWord :: String -> String
firstWord s =
  let
    core = String.trim (if SCU.take 1 s == "~" then SCU.drop 1 s else s)
  in
    case Array.head (String.split (Pattern " ") core) of
      Just w -> w
      Nothing -> ""

--------------------------------------------------------------------------------
-- Residual detection
--------------------------------------------------------------------------------

-- | Residuals for an `ROpen`: an ambiguous-section flag for a bare `{{#name}}`
-- | whose name is not a known block helper and carries no arguments. (`@../` /
-- | `@root` are no longer residuals — they auto-migrate to the reserved variable
-- | model, ADR-021: `@root.x` → `root.x`, `@../index` → `loop.parent.index0`,
-- | `@../x` → `parent.x`.)
openResiduals :: Span -> Sigil -> String -> Array Residual
openResiduals span sigil interior = ambiguousSection span sigil interior

-- | An `ambiguous-section` residual for a bare Mustache section `{{#name}}`: a
-- | `Section` open whose interior is a single bare identifier that is NOT a known
-- | block helper and carries no arguments. Such a tag is truthy-vs-list ambiguous
-- | in MaxBars (`{{#if name}}` vs `{{#each name}}`).
ambiguousSection :: Span -> Sigil -> String -> Array Residual
ambiguousSection span sigil interior = case sigil of
  Section ->
    let
      core = stripTildes interior
      name = String.trim core
    in
      if isBareName name && not (Array.elem name knownBlockHelpers) then
        [ { kind: "ambiguous-section"
          , span
          , message:
              "bare Mustache section `{{#" <> name <> "}}` is ambiguous in MaxBars: a "
                <> "Handlebars `{{#"
                <> name
                <> "}}` renders its body when truthy AND "
                <> "iterates when `"
                <> name
                <> "` is a list — MaxBars splits these into "
                <> "`{{#if "
                <> name
                <> "}}` and `{{#each "
                <> name
                <> "}}`."
          , suggestion:
              "Choose the intended form: `{{#if " <> name <> "}}…{{/if}}` for a truthy "
                <> "guard, or `{{#each "
                <> name
                <> "}}…{{/each}}` to iterate a list."
          }
        ]
      else []
  _ -> []

-- | A bare name: a single whitespace-free identifier token (no arguments, no
-- | parens, no path-internal call). Path-dotted names (`a.b`) still count as a
-- | single bare section head, which is the ambiguous case.
isBareName :: String -> Boolean
isBareName s =
  s /= ""
    && not (String.contains (Pattern " ") s)
    && not (String.contains (Pattern "\t") s)
    && not (String.contains (Pattern "(") s)

stripTildes :: String -> String
stripTildes s =
  let
    a = fromMaybe s (String.stripPrefix (Pattern "~") s)
  in
    fromMaybe a (String.stripSuffix (Pattern "~") a)

--------------------------------------------------------------------------------
-- Set-delimiters scan (pre-lex, raw source)
--------------------------------------------------------------------------------

-- | Scan the raw source for Mustache set-delimiters directives `{{= … =}}` and
-- | report each as a `set-delimiters` residual with the span of the directive.
-- | This runs *before* lexing because `{{=<% %>=}}` would otherwise lex as a
-- | bare separator (and the changed delimiters would desync the rest); we report
-- | it and migrate the rest best-effort under the *default* `{{ }}` delimiters.
scanSetDelimiters :: String -> Array Residual
scanSetDelimiters src = go 0 []
  where
  cs = SCU.toCharArray src
  len = Array.length cs

  go :: Int -> Array Residual -> Array Residual
  go i acc
    | i >= len = Array.reverse acc
    | matchAt cs i "{{=" =
        case findFrom cs (i + 3) "=}}" of
          Just q ->
            let
              span = { start: i, end: q + 3 }
              body = SCU.slice (i + 3) q src
            in
              go (q + 3)
                ( Array.cons
                    { kind: "set-delimiters"
                    , span
                    , message:
                        "Mustache set-delimiters directive `{{=" <> body <> "=}}` is "
                          <> "unsupported in MaxBars (delimiters are fixed `{{ }}` / "
                          <> "`{{{ }}}`); the rest of the file was migrated under the "
                          <> "default delimiters and may be wrong past this point."
                    , suggestion:
                        "Remove the set-delimiters directive and rewrite the affected "
                          <> "tags to the standard `{{ }}` / `{{{ }}}` delimiters by hand."
                    }
                    acc
                )
          Nothing -> go (i + 1) acc
    | otherwise = go (i + 1) acc

matchAt :: Array Char -> Int -> String -> Boolean
matchAt cs i pat =
  let
    pcs = SCU.toCharArray pat
  in
    Array.slice i (i + Array.length pcs) cs == pcs

findFrom :: Array Char -> Int -> String -> Maybe Int
findFrom cs from pat = goF from
  where
  len = Array.length cs
  goF i
    | i > len = Nothing
    | matchAt cs i pat = Just i
    | otherwise = goF (i + 1)
