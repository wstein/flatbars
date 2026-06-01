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
-- | of truth, projected from `HelperDef.alias`), so adding an alias to the
-- | prelude automatically teaches this lint about it.
module Linter.Aliases
  ( aliasWarnings
  , aliasWarningsOf
  ) where

import Prelude

import BareBars.Error (ParseError)
import BareBars.Parser (parse)
import BareBars.Syntax (Template)
import Data.Array as Array
import Data.Either (Either)
import Data.Foldable (lookup)
import Data.Maybe (Maybe(..))
import Kernel.Prelude (preludeAliasWarnings)
import Kernel.Walk (Issue, Severity(..), helperRefs)

-- | Warn on every use of a *warned* alias helper in a (parsed) template, pointing
-- | at its canonical name. Dialect-agnostic: the caller parses with whatever
-- | dialect it wants and passes the `Template` (mirrors
-- | `MaxBars.loopVarShadowWarnings`). One `Warn` per occurrence. The silent
-- | escaper aliases (`esc_html`/`esc_json`, §8) are excluded — `preludeAliasWarnings`
-- | already drops them — so they are never nagged about.
aliasWarnings :: Template -> Array Issue
aliasWarnings = Array.mapMaybe warnOf <<< helperRefs
  where
  warnOf ref = case lookup ref.name preludeAliasWarnings of
    Just canonical -> Just
      { severity: Warn
      , name: ref.name
      , message:
          "`" <> ref.name <> "` is a deprecated alias of `" <> canonical
            <> "` — prefer `"
            <> canonical
            <> "` (the lift/migrate assist rewrites it)"
      }
    Nothing -> Nothing

-- | Parse `src` with the default (core) parser and warn on any alias use — the
-- | convenience entry point for the RawBars/FullBars explicit-call form
-- | (`{{plus a b}}` / `(plus a b)`). A MaxBars caller parses with `maxOptions`
-- | and uses `aliasWarnings` directly.
aliasWarningsOf :: String -> Either ParseError (Array Issue)
aliasWarningsOf src = (aliasWarnings <<< _.nodes) <$> parse src
