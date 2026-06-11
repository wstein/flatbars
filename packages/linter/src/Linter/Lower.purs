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
-- | re-spelled as a section. (ADR-022 removed the old truthiness-materialization
-- | phase X1: with no per-file `@truthiness`, MaxBars and RawBars share the one
-- | engine rule, so the lowering is render-exact without carrying a mode.)
module Linter.Lower
  ( lowerToRawBars
  ) where

import Prelude

import ClassicBars (desugarSurfaceWith, renameSurfaceHeads)
import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import FlatBars.Error (ParseError(..))
import FlatBars.Syntax (Node(..), Sigil(..), Template)
import Linter.Print (printDirectives, printRawBars)
import MaxBars (maxLoopVars)
import MaxBars.Parser as MBP

-- | Lower MaxBars source to RawBars (core) source. Header `@`-directives are
-- | carried forward verbatim (source fidelity); truthiness no longer needs
-- | materializing — every dialect renders under the same engine rule (ADR-022).
-- | A parse failure is propagated; an inheritance sigil (unreachable for MaxBars)
-- | is reported as a located internal error.
lowerToRawBars :: String -> Either ParseError String
lowerToRawBars src = do
  { directives, nodes } <- lmap NEA.head (MBP.parse src)
  -- `renameSurfaceHeads`: the MaxBars surface keywords `for`/`scope` → their canonical
  -- operation heads `each`/`with` (ADR-039) — RawBars (the lowering target) uses the
  -- op-name heads, so a `{% for %}` must print as `{% each %}`.
  let desugared = desugarSurfaceWith maxLoopVars (renameSurfaceHeads nodes)
  case findInheritance desugared of
    Just sigil ->
      Left
        (DisallowedShape ("inheritance sigil " <> show sigil <> " cannot be lowered to RawBars") 0)
    Nothing -> Right (printDirectives directives <> printRawBars desugared)

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
