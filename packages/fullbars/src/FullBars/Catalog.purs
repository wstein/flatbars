-- | Generate the helper-catalog documentation from the single source of truth.
-- |
-- | `FullBars.Prelude.preludeSchema` already lists every helper the engine knows
-- | (name, block-ness, arity), projected from `helperDefs`. Rather than maintain
-- | a parallel table by hand in the docs — which is exactly how a phantom helper
-- | like `partial>` slips in — this module renders that schema to an AsciiDoc
-- | fragment. `scripts/generate-helper-catalog.mjs` writes it to a partial the
-- | prelude page includes, and re-runs with `--check` in CI to fail on drift.
module FullBars.Catalog
  ( helperCatalogAdoc
  ) where

import Prelude

import BareBars.Engine (Helper)
import BareBars.Error (Error)
import BareBars.Walk (Arity(..))
import Data.Either (Either)
import Data.Foldable (foldMap)
import Data.Map as Map
import Data.Set as Set
import Data.Tuple (Tuple(..), fst)
import FullBars.Env (RefEnv)
import FullBars.Prelude (prelude, preludeSchema)

-- | The set of *registered* helper names (those with a runtime in `prelude`).
-- | Everything else in the schema is a *scoped* variable a block helper installs.
registeredNames :: Set.Set String
registeredNames =
  Set.fromFoldable
    (map fst (prelude :: Array (Tuple String (Helper (Either Error) (RefEnv (Either Error))))))

renderArity :: Arity -> String
renderArity = case _ of
  Exactly n -> show n
  AtLeast n -> "≥" <> show n
  Between a b -> show a <> "–" <> show b
  AnyArity -> "any"

renderRow :: Tuple String { block :: Boolean, arity :: Arity } -> String
renderRow (Tuple name spec) =
  "|`" <> name <> "` |" <> form <> " |" <> renderArity spec.arity <> " |" <> source
  where
  form = if spec.block then "block" else "value"
  source = if Set.member name registeredNames then "registered" else "scoped"

-- | The full AsciiDoc partial: a generated, do-not-edit table of every helper in
-- | `preludeSchema`, sorted by name (the `Map` is already key-ordered).
helperCatalogAdoc :: String
helperCatalogAdoc =
  header
    <> "[cols=\"2,1,1,1\",options=\"header\"]\n|===\n|Helper |Form |Arity |Source\n\n"
    <> rows
    <> "|===\n"
  where
  header =
    "// Generated from FullBars.preludeSchema by scripts/generate-helper-catalog.mjs — do not edit.\n"
      <> "// Regenerate with `npm run gen:catalog`; CI checks it with `npm run check:catalog`.\n\n"
  rows =
    foldMap (\r -> renderRow r <> "\n")
      ( Map.toUnfoldable preludeSchema.helpers
          :: Array (Tuple String { block :: Boolean, arity :: Arity })
      )
