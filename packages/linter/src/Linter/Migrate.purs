-- | **Linter.Migrate** — the *migrate* job (loopvars-linter-spec.md §B.4, phase
-- | X2): a **Handlebars → MaxBars source migrator** with a per-file residual
-- | report. Unlike `Linter.Lower` (which parse-and-reprints), this is a
-- | *minimal-diff source rewrite over the token stream*: it lexes the Handlebars
-- | source with the Handlebars-compatible lexer (`FlatBars.Lexer.tokenizeTemplate`,
-- | which the FullBars `defaultParseOptions` parser uses), rewrites only the
-- | tokens that change, and rebuilds the rest from the *original source slice* —
-- | so the author's formatting, spacing, and `~` whitespace-control are preserved
-- | verbatim on every untouched tag.
-- |
-- | ## Rewrites (mechanical, meaning-preserving)
-- |
-- |  * `{{^x}}` (inverted section) → `{{#unless x}}`; its matching `{{/x}}` →
-- |    `{{/unless}}`. Pairing uses an open/close **stack** so nested same-named
-- |    sections close correctly.
-- |  * `{{&x}}` (amp-unescaped) → `{{{x}}}`. (`{{&x}}` and `{{{x}}}` already lex
-- |    to the same skeleton — this is a cosmetic source normalization.)
-- |  * inside ANY tag interior: the whole-token `@`-data names
-- |    `@index`→`index0`, `@first`→`first`, `@last`→`last`, `@key`→`key`
-- |    (word-boundary; `@root`, `@../…`, `@partial-block`, `@index0` are left
-- |    alone).
-- |  * `{{else if c}}` → `{{elif c}}`.
-- |
-- | ## Residuals (detected + reported, NOT rewritten — each carries a span,
-- | a message, and a suggested fix):
-- |
-- |  * `parent-data` — any interior mentioning `@../` or `@root` (needs a manual
-- |    `as |x i|` outer-loop binding; cannot be done mechanically — §B.4 row).
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
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.String (Pattern(..))
import Data.String as String
import Data.String.CodeUnits as SCU
import Data.Tuple (Tuple(..))
import FlatBars.Error (ParseError)
import FlatBars.Lexer (RawTok(..), defaultLexConfig, tokenizeTemplate)
import FlatBars.Span (Span)
import FlatBars.Syntax (Sigil(..))

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
knownBlockHelpers =
  [ "if", "unless", "each", "with", "raw", "apply", "inline", "partial" ]

-- | Migrate Handlebars source to MaxBars source, collecting a residual report.
-- | A lex failure is propagated as `Left`.
migrateToMaxBars :: String -> Either ParseError MigrateResult
migrateToMaxBars src = do
  toks <- tokenizeTemplate defaultLexConfig src
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
data CloseRule = CloseUnless | CloseVerbatim

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
  RContent s -> emit acc s

  ROutput span _ _ -> emit acc (mapDataInTag (sliceSpan src span))

  -- `{{&x}}` (amp-unescaped) → `{{{x}}}` (cosmetic normalization). The interior
  -- still gets the `@`-data mapping (e.g. `{{&@key}}` → `{{{key}}}`).
  RAmp _ _ interior ->
    emit acc ("{{{" <> mapDataNames interior <> "}}}")

  ROpen span sigil _ interior ->
    let
      acc1 = addResiduals acc (openResiduals span sigil interior)
    in
      case sigil of
        Inverse ->
          -- `{{^e}}` → `{{#unless <e>}}`; keep the interior verbatim (incl. a
          -- leading `~`), map its `@`-data names; mark the close for `{{/unless}}`.
          push (emit acc1 ("{{#unless " <> mapDataNames interior <> "}}")) CloseUnless
        _ ->
          -- a `{{#…}}` (or inheritance) open: keep the source slice verbatim
          -- (only `@`-data names mapped) and pair its close verbatim.
          push (emit acc1 (mapDataInTag (sliceSpan src span))) CloseVerbatim

  RClose span _ _ ->
    case Array.head acc.stack of
      Just CloseUnless ->
        emit (popStack acc) "{{/unless}}"
      _ ->
        emit (popStack acc) (mapDataInTag (sliceSpan src span))

  -- A separator. `{{else if c}}` → `{{elif c}}`; otherwise verbatim (with
  -- `@`-data mapping). Parent-data residuals are detected on its interior too.
  RSep span _ interior ->
    let
      acc1 = addResiduals acc (parentDataResidual span interior)
    in
      case rewriteElseIf interior of
        Just rebuilt -> emit acc1 ("{{" <> rebuilt <> "}}")
        Nothing -> emit acc1 (mapDataInTag (sliceSpan src span))

  RComment span _ _ -> emit acc (sliceSpan src span)

  RRaw span _ _ _ -> emit acc (sliceSpan src span)

  -- Migrate runs under default delimiters, so a set-delimiter tag never appears;
  -- pass it through verbatim if one ever does (minimal-diff rewrite).
  RSetDelim span -> emit acc (sliceSpan src span)

  -- Migrate leaves `keepLongComments` off, so a long-comment token never appears;
  -- emit it verbatim if one ever does (minimal-diff rewrite).
  RLongComment span -> emit acc (sliceSpan src span)

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
matchData cs i = Array.findMap tryOne mapped
  where
  tryOne (Tuple name repl) =
    let
      nameChars = SCU.toCharArray name
      nlen = Array.length nameChars
      after = i + 1 + nlen
    in
      if Array.slice (i + 1) after cs == nameChars && not (continues after) then
        Just (Tuple repl (1 + nlen))
      else
        Nothing
  continues j = maybe false isIdentChar (Array.index cs j)
  -- longest first so `@index` is preferred where applicable; `@index0` never
  -- matches `@index` because the trailing `0` is an ident-continuation char.
  -- ADR-021: Handlebars `@`-vars migrate to the MaxBars `loop` object (no bare
  -- loop variables). `@index` → `loop.index0`, `@first` → `loop.first`, etc.
  mapped =
    [ Tuple "index" "loop.index0"
    , Tuple "first" "loop.first"
    , Tuple "last" "loop.last"
    , Tuple "key" "loop.key"
    ]

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
      Just rest ->
        let
          cond = mapDataNames (String.trim rest)
          tildeL = if lead then "~" else ""
          tildeR = if trail then "~" else ""
        in
          Just (tildeL <> "elif " <> cond <> tildeR)
      Nothing -> Nothing

--------------------------------------------------------------------------------
-- Residual detection
--------------------------------------------------------------------------------

-- | Residuals for an `ROpen`: a parent-data flag on its interior, plus an
-- | ambiguous-section flag for a bare `{{#name}}` whose name is not a known
-- | block helper and carries no arguments.
openResiduals :: Span -> Sigil -> String -> Array Residual
openResiduals span sigil interior =
  parentDataResidual span interior <> ambiguousSection span sigil interior

-- | A `parent-data` residual when the interior mentions `@../` or `@root`.
parentDataResidual :: Span -> String -> Array Residual
parentDataResidual span interior
  | String.contains (Pattern "@../") interior || String.contains (Pattern "@root") interior =
      [ { kind: "parent-data"
        , span
        , message:
            "parent-or-root data reference (`@../` / `@root`) is left for review — "
              <> "MaxBars reaches outer and root state through the reserved variable "
              <> "model (ADR-021), not by walking up the `@` data tree."
        , suggestion:
            "Use `parent` / `root` for the enclosing and root context (`{{parent.x}}`, "
              <> "`{{root.y}}`), and `loop.parent` for the enclosing loop's state "
              <> "(`{{loop.parent.index0}}`), instead of `@../…` / `@root`."
        }
      ]
  | otherwise = []

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
