-- | **Linter.Lower** — the *lower* entrypoint (loopvars-linter-spec.md §B.2,
-- | phase X0): take MaxBars surface source, run the front-end forward to the
-- | meaning-free core `Template` (`parseWith maxOptions` → `desugarSurfaceWith
-- | maxLoopVars`), then pretty-print that core AST as RawBars source text
-- | (`Linter.Print`). The result is a lossless, mechanical lowering — re-parsing
-- | it with the default core parser yields the same real AST as the desugared
-- | MaxBars source (the round-trip oracle in the tests).
-- |
-- | Inheritance shapes (`{{<name}}` / `{{$name}}`) cannot appear in a desugared
-- | MaxBars template — MaxBars parses with `extras = false` and does not opt
-- | into `ParseOptions.inheritance`, so the parser never produces a `Parent`/
-- | `BlockDef` sigil. The guard here is therefore defensive: if such a node ever
-- | reaches `lowerNodes`, it is refused with a clear `Left` rather than silently
-- | re-spelled as a section. Truthiness materialization (non-`handlebars` modes)
-- | is phase X1; X0 is scoped to truthiness-default files, which lower cleanly.
module Linter.Lower
  ( lowerToRawBars
  , lowerReport
  , LowerReport
  ) where

import Prelude

import BareBars.Error (ParseError(..))
import BareBars.Parser (parseWith)
import BareBars.Syntax (Directive, Node(..), Sigil(..), Template)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.Set as Set
import Data.String as String
import FullBars (desugarSurfaceWith)
import Linter.Print (printDirectives, printRawBars)
import MaxBars (maxLoopVars, maxOptions)

-- | The result of lowering, with the metadata a host/CLI needs to *report* a
-- | truthiness materialization (loopvars-linter-spec.md §B.5):
-- |
-- |  * `source` — the lowered RawBars source text.
-- |  * `truthiness` — the file's `@truthiness` directive value carried forward
-- |    (`Nothing` ⇒ none present, i.e. the engine `handlebars` default).
-- |  * `materialized` — `true` exactly when a non-default `@truthiness` was
-- |    carried into the output. This is the warn signal a strict host can refuse
-- |    on; the carried directive itself makes the lowering render-exact, so the
-- |    default behaviour is safe rather than refusing (the spec's safe default
-- |    was premised on the directive *not* surviving — here it does).
type LowerReport =
  { source :: String
  , truthiness :: Maybe String
  , materialized :: Boolean
  }

-- | Lower MaxBars source to RawBars (core) source. Header `@`-directives —
-- | including `@truthiness` — are carried forward, so a non-`handlebars`-mode
-- | file renders identically after lowering (X1 materialization). A parse
-- | failure is propagated; an inheritance sigil (unreachable for MaxBars) is
-- | reported as a located internal error.
lowerToRawBars :: String -> Either ParseError String
lowerToRawBars src = _.source <$> lowerReport src

-- | Lower with the truthiness-materialization report (see `LowerReport`).
lowerReport :: String -> Either ParseError LowerReport
lowerReport src = do
  { directives, nodes } <- parseWith maxOptions src
  let desugared = desugarSurfaceWith maxLoopVars nodes
  case findInheritance desugared of
    Just sigil ->
      Left
        (DisallowedShape ("inheritance sigil " <> show sigil <> " cannot be lowered to RawBars") 0)
    Nothing ->
      let
        truthiness = _.value <$> Array.find (\d -> d.key == "truthiness") directives
      in
        Right
          { source: printDirectives directives <> printRawBars desugared
          , truthiness
          , materialized: isNonDefault truthiness
          }

-- | A `@truthiness` value is *non-default* unless it is absent or names the
-- | engine default — the `handlebars`/`empty` aliases, or the explicit shape
-- | list for the default set (the five `handlebars` shapes in any order/spacing).
-- | Only a non-default mode needs carrying for render-equivalence; the flag lets
-- | a host report/refuse on those.
isNonDefault :: Maybe String -> Boolean
isNonDefault = case _ of
  Nothing -> false
  Just v -> case Set.fromFoldable (words v) of
    shapes
      | shapes == Set.singleton "empty" -> false
      | shapes == Set.singleton "handlebars" -> false
      | shapes == defaultShapes -> false
      | otherwise -> true
  where
  defaultShapes = Set.fromFoldable [ "false", "null", "\"\"", "0", "[]" ]

-- | Split on ASCII whitespace, dropping empties (so directive spacing/order is
-- | irrelevant when comparing the explicit shape list).
words :: String -> Array String
words =
  Array.filter (_ /= "")
    <<< String.split (String.Pattern " ")
    <<< String.replaceAll (String.Pattern "\t") (String.Replacement " ")
    <<< String.replaceAll (String.Pattern "\n") (String.Replacement " ")

-- | Find any inheritance sigil (`Parent`/`BlockDef`) the printer cannot lower,
-- | recursing into block bodies. (Unreachable for MaxBars; a defensive guard.)
findInheritance :: Template -> Maybe Sigil
findInheritance = Array.findMap nodeSigil
  where
  nodeSigil = case _ of
    Block _ sig _ _ body -> case sig of
      Parent -> Just Parent
      BlockDef -> Just BlockDef
      _ -> findInheritance body
    _ -> Nothing
