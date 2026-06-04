-- | Generate the helper-catalog documentation from the single source of truth.
-- |
-- | `Kernel.Prelude.preludeSchema` already lists every helper the engine knows
-- | (name, block-ness, arity), projected from `operationDefs`. Rather than maintain
-- | a parallel table by hand in the docs — which is exactly how a phantom helper
-- | like `partial>` slips in — this module renders that schema to an AsciiDoc
-- | fragment. `scripts/generate-helper-catalog.mjs` writes it to a partial the
-- | prelude page includes, and re-runs with `--check` in CI to fail on drift.
module FullBars.Catalog
  ( helperCatalogAdoc
  , OpInfo
  , operations
  ) where

import Prelude

import Data.Either (Either)
import Data.Foldable (foldMap, lookup)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Set as Set
import Data.Tuple (Tuple(..), fst)
import FlatBars.Error (Error)
import Kernel.Engine (Operation)
import Kernel.Env (RefEnv)
import Kernel.Prelude (OperationDef, operationDefs, prelude, preludeAliases, preludeSchema, preludeSynonyms)
import Kernel.Walk (Arity(..))

-- | The set of *registered* helper names (those with a runtime in `prelude`).
-- | Everything else in the schema is a *scoped* variable a block helper installs.
registeredNames :: Set.Set String
registeredNames =
  Set.fromFoldable
    (map fst (prelude :: Array (Tuple String (Operation (Either Error) (RefEnv (Either Error))))))

-- | Each operation's one-line doc, keyed by name. Scoped variables (installed by
-- | block helpers, not in `operationDefs`) have no entry — they carry no doc.
docByName :: Map.Map String String
docByName =
  Map.fromFoldable
    (map (\d -> Tuple d.name d.doc) (operationDefs :: Array (OperationDef (Either Error))))

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
  source = case lookup name preludeAliases of
    Just canonical -> "alias of `" <> canonical <> "`"
    Nothing -> case lookup name preludeSynonyms of
      Just canonical -> "synonym of `" <> canonical <> "`"
      Nothing -> if Set.member name registeredNames then "registered" else "scoped"

-- | The full AsciiDoc partial: a generated, do-not-edit table of every helper in
-- | `preludeSchema`, sorted by name (the `Map` is already key-ordered).
helperCatalogAdoc :: String
helperCatalogAdoc =
  header
    <> "[cols=\"2,1,1,1\",options=\"header\"]\n|===\n|Operation |Form |Arity |Source\n\n"
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

-- | One operation, projected from the schema for the editor layer (ADR-017
-- | hover/completion). `kind` is the ADR-019 axis derived structurally; `source`
-- | separates callable helpers from the scoped variables blocks install and from
-- | the alias/synonym relationships; `canonical` is the target of an alias/synonym
-- | (empty when none — the generator normalises it to JSON `null`); `doc` is the
-- | operation's one-line description from `OperationDef.doc` (empty for scoped
-- | variables, which carry none).
type OpInfo =
  { name :: String
  , kind :: String
  , arity :: String
  , source :: String
  , canonical :: String
  , doc :: String
  }

-- | The ADR-019 operation kind, derived from the schema (operator is a MaxBars
-- | surface form, not a runtime kind, so it never appears here).
opKind :: { block :: Boolean, arity :: Arity } -> String
opKind spec
  | spec.block = "block"
  | otherwise = case spec.arity of
      Exactly 0 -> "value"
      _ -> "inline"

-- | Every operation in `preludeSchema`, name-ordered (the `Map` is key-ordered),
-- | as plain records the editor tooling consumes. The single source the
-- | `editors/operations.json` gate (scripts/gen-operations.mjs) projects.
operations :: Array OpInfo
operations =
  map toInfo
    ( Map.toUnfoldable preludeSchema.helpers
        :: Array (Tuple String { block :: Boolean, arity :: Arity })
    )
  where
  toInfo (Tuple name spec) =
    let
      classified = classify name
    in
      { name
      , kind: opKind spec
      , arity: renderArity spec.arity
      , source: classified.source
      , canonical: classified.canonical
      , doc: fromMaybe "" (Map.lookup name docByName)
      }
  classify name = case lookup name preludeAliases of
    Just canonical -> { source: "alias", canonical }
    Nothing -> case lookup name preludeSynonyms of
      Just canonical -> { source: "synonym", canonical }
      Nothing ->
        { source: if Set.member name registeredNames then "registered" else "scoped"
        , canonical: ""
        }
