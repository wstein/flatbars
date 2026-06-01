-- | MaxBars loop-variable **shadow lint** (ADR-006 §shadowing, the schema-less
-- | *warning* tier agreed in the final review).
-- |
-- | Dropping the `@` sigil lets a bare loop variable whose name reads like a
-- | data field — `first`, `last`, `length`, `key` — silently win over a field of
-- | the same name. ADR-006's schema-present tier makes that an *error* when a
-- | declared field collides; this tier needs no schema: it **always warns** on a
-- | use of such a name as a (bare) loop variable, so a schema-less template can't
-- | shadow a field unnoticed. The fix the message points to — `{{ this.NAME }}` —
-- | desugars to a `lookup` (not a scoped-var call) and so does *not* warn.
-- |
-- | The lint runs over the *desugared* template: a bare `{{first}}` lowered by
-- | MaxBars' loop-variable resolver is a nullary application `(first)`, whereas a
-- | data path `{{this.first}}` is `(lookup this "first")`. So a zero-arity
-- | application whose head is a shadow-prone loop-variable name is exactly a bare
-- | loop-variable use. (The unambiguous spellings `index0`/`index1`/`rindex0`/
-- | `rindex1` never read as data fields, so they are not flagged.)
module MaxBars.Lint
  ( shadowProneNames
  , loopVarShadowWarnings
  ) where

import Prelude

import BareBars.Syntax (Template)
import Data.Array as Array
import Data.Maybe (Maybe(..))
import Kernel.Walk (Issue, RefKind(..), Severity(..), helperRefs)

-- | The loop-variable names that plausibly collide with data fields (ADR-006
-- | calls out `first`/`key`/`length`; `last` rounds out the set). The aliases
-- | (`index`/`rindex`/`size`) have already been resolved to canonical names by
-- | the desugar, and the canonical `index0`/`index1`/`rindex0`/`rindex1` are not
-- | data-like, so neither appears here.
shadowProneNames :: Array String
shadowProneNames = [ "first", "last", "length", "key" ]

-- | Warn on every bare loop-variable use whose name is shadow-prone, over a
-- | *desugared* MaxBars template. One `Warn` issue per occurrence.
loopVarShadowWarnings :: Template -> Array Issue
loopVarShadowWarnings = Array.mapMaybe warnOf <<< helperRefs
  where
  warnOf ref
    | ref.kind == AppRef && ref.argc == 0 && Array.elem ref.name shadowProneNames =
        Just
          { severity: Warn
          , name: ref.name
          , message:
              "bare {{" <> ref.name <> "}} is the loop variable here, not a data field; "
                <> "write {{ this."
                <> ref.name
                <> " }} to read a field named '"
                <> ref.name
                <> "'"
          }
    | otherwise = Nothing
