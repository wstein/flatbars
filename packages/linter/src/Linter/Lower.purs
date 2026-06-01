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
  ) where

import Prelude

import BareBars.Error (ParseError(..))
import BareBars.Parser (parseWith)
import BareBars.Syntax (Node(..), Sigil(..), Template)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import FullBars (desugarSurfaceWith)
import Linter.Print (printRawBars)
import MaxBars (maxLoopVars, maxOptions)

-- | Lower MaxBars source to RawBars (core) source. A parse failure is
-- | propagated; an inheritance sigil (unreachable for MaxBars) is reported as a
-- | located internal error.
lowerToRawBars :: String -> Either ParseError String
lowerToRawBars src = do
  { nodes } <- parseWith maxOptions src
  let desugared = desugarSurfaceWith maxLoopVars nodes
  case findInheritance desugared of
    Just sigil ->
      Left
        (DisallowedShape ("inheritance sigil " <> show sigil <> " cannot be lowered to RawBars") 0)
    Nothing -> Right (printRawBars desugared)

-- | Detect any `Parent`/`BlockDef` block sigil anywhere in the template (these
-- | are the inheritance shapes the printer cannot faithfully lower). Returns the
-- | first one found, recursing into block bodies.
findInheritance :: Template -> Maybe Sigil
findInheritance = Array.findMap nodeSigil
  where
  nodeSigil = case _ of
    Block _ sig _ _ body -> case sig of
      Parent -> Just Parent
      BlockDef -> Just BlockDef
      _ -> findInheritance body
    _ -> Nothing
