-- | **Linter.Aliases** — the on-demand *alias warning* lint (open decision 2,
-- | resolved: handlebars-legacy aliases are **permanent + warn-on-demand**).
-- |
-- | `downcase`/`upcase`/`plus`/`minus`/`times` are real registered helpers that
-- | render identically to their canonical forms (`lowercase`/`uppercase`/the
-- | `+ - *` operators), so legacy and mid-migration source keeps working and is
-- | never broken by removal. But they are *second-class*: this lint — invoked by
-- | a host/CI, never at render time, never blocking — emits one `Warn` per use,
-- | pointing at the canonical name. The user-invoked lift/migrate assist is what
-- | actually rewrites them; nothing here (and no on-save tooling) edits source.
-- |
-- | The alias set is read from `Kernel.Prelude.preludeAliases` (the single source
-- | of truth, projected from `OperationDef.alias`), so adding an alias to the
-- | prelude automatically teaches this lint about it.
-- |
-- | This module also carries the *scoped-variable* canonicalization lint
-- | (`scopedCanonWarnings`): the loop/partial variables have a non-canonical legacy
-- | spelling (`index` → `index0`, `partial-block` → `yield`) and a native
-- | RawBars/MaxBars canonical one. The engine installs *both* names (they render
-- | identically — `scopedSpecs`), so this is purely a *lint* preference, not a
-- | render or `synonymOf` concern; it is surface-scoped (run it for RawBars/MaxBars
-- | source, where the native form is canonical — not FullBars, where `@index` /
-- | `@partial-block` are the Handlebars-faithful spelling).
module Linter.Aliases
  ( LintWarning
  , aliasWarnings
  , aliasWarningsOf
  , scopedCanonWarnings
  , scopedCanonWarningsOf
  ) where

import Prelude

import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either)
import Data.Foldable (lookup)
import Data.Maybe (Maybe(..))
import FlatBars.Error (ParseError)
import FlatBars.Parser (parse)
import FlatBars.Span (Span)
import FlatBars.Syntax (Ident, Template)
import Kernel.Prelude (preludeAliases, scopedCanonical)
import Kernel.Walk (Severity(..), operationRefs)

-- | A located lint warning: the `Issue` triple (severity/name/message) plus the
-- | source `span` of the offending tag, so a host can jump to it — the Lab's Lint
-- | panel click-to-jump, mirroring the analyse findings. A superset of
-- | `Kernel.Walk.Issue`; the CLI report reads only severity/message, ignoring span.
type LintWarning = { severity :: Severity, name :: Ident, message :: String, span :: Span }

-- | Warn on every use of an alias helper in a (parsed) template, pointing at its
-- | canonical name. Dialect-agnostic: the caller parses with whatever dialect it
-- | wants and passes the `Template` (mirrors `MaxBars.loopVarShadowWarnings`).
-- | One `Warn` per occurrence.
aliasWarnings :: Template -> Array LintWarning
aliasWarnings = Array.mapMaybe warnOf <<< operationRefs
  where
  warnOf ref = case lookup ref.name preludeAliases of
    Just canonical -> Just
      { severity: Warn
      , name: ref.name
      , message:
          "`" <> ref.name <> "` is a deprecated alias of `" <> canonical
            <> "` — prefer `"
            <> canonical
            <> "` (the lift/migrate assist rewrites it)"
      , span: ref.span
      }
    Nothing -> Nothing

-- | Parse `src` with the default (core) parser and warn on any alias use — the
-- | convenience entry point for the RawBars/FullBars explicit-call form
-- | (`{{plus a b}}` / `(plus a b)`). A MaxBars caller parses with `maxOptions`
-- | and uses `aliasWarnings` directly.
aliasWarningsOf :: String -> Either ParseError (Array LintWarning)
aliasWarningsOf src = (aliasWarnings <<< _.nodes) <$> lmap NEA.head (parse src)

-- | Warn on every use of a non-canonical scoped variable (`index` → `index0`,
-- | `partial-block` → `yield`), pointing at the native spelling. Surface-scoped:
-- | the caller runs it for RawBars/MaxBars source (where the native form is
-- | canonical), not FullBars. Same shape as `aliasWarnings`; one `Warn` per use.
scopedCanonWarnings :: Template -> Array LintWarning
scopedCanonWarnings = Array.mapMaybe warnOf <<< operationRefs
  where
  warnOf ref = case lookup ref.name scopedCanonical of
    Just canonical -> Just
      { severity: Warn
      , name: ref.name
      , message:
          "`" <> ref.name <> "` is the non-canonical scoped variable — prefer `" <> canonical
            <> "` (the native RawBars/MaxBars spelling)"
      , span: ref.span
      }
    Nothing -> Nothing

-- | Parse `src` with the default (core) parser and warn on any non-canonical
-- | scoped-variable use — the convenience entry point for RawBars/MaxBars source.
-- | (Lint reports the first parse error; the recovering parser's full list is for
-- | the render/CLI paths — here `lmap NEA.head` keeps the simpler `ParseError`.)
scopedCanonWarningsOf :: String -> Either ParseError (Array LintWarning)
scopedCanonWarningsOf src = (scopedCanonWarnings <<< _.nodes) <$> lmap NEA.head (parse src)
