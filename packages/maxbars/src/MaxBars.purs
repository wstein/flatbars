-- | **MaxBars** — the top tier of the dialect ladder (RawBars ⊂ FullBars ⊂
-- | MaxBars). It is FullBars plus a richer *surface*: infix operators and pipes
-- | (`MaxBars.Expr`). Because that surface desugars to the same core `Expr` that
-- | FullBars already understands, MaxBars reuses FullBars wholesale by
-- | dependency — the engine, prelude, value policy, surface desugar, and the
-- | compiler — swapping only the interior expression grammar through the
-- | `ParseOptions.parseExpr` seam. (A shared semantic *kernel* is extracted
-- | lazily, only for proven overlaps; see the project notes.)
module MaxBars
  ( maxOptions
  , maxLoopVars
  , renderMax
  , compileMaxJs
  , loopVarWarnings
  ) where

import Prelude

import Data.Either (Either)
import Data.Maybe (Maybe(..))
import FlatBars.Error (ParseError)
import FlatBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import FlatBars.Value (Value)
import FullBars (LoopVars, desugarSurfaceWith, renderSurfaceDiagWith)
import FullBars.Compile (compileSurfaceWith)
import Kernel.Walk (Issue)
import MaxBars.Expr (parseMaxExpr, parseMaxHead)
import MaxBars.Lint (loopVarShadowWarnings)

-- | Parse options for the MaxBars dialect: the default front-end knobs
-- | (standalone trimming, …) with the interior grammar swapped for
-- | `MaxBars.Expr` (infix operators + pipes), and the Handlebars-only tag shapes
-- | (`{{{{…}}}}`, `{{^…}}`, `{{&…}}`) rejected (`extras` off) — MaxBars is not the
-- | Handlebars-compatibility dialect.
maxOptions :: ParseOptions
maxOptions =
  defaultParseOptions
    { parseExpr = parseMaxExpr
    , parseHead = parseMaxHead
    , extras = false
    , lexOptions = { infixArith: true }
    }

-- | MaxBars' loop variables: bare (no-`@`) scoped names usable inside `each`.
-- | The canonical set `index0/index1/rindex0/rindex1/first/last/length/key` maps
-- | to itself; the aliases `index`/`rindex`/`size` map to `index0`/`rindex0`/
-- | `length`. Everything else is a data path (FullBars semantics). This is the
-- | one place the "MaxBars-only" loop variables are *named*; the underlying
-- | frame metadata is shared (`Kernel.Prelude` `iterate`), but only this
-- | resolver turns a bare `{{index0}}` into the scoped call `(index0)`.
maxLoopVars :: LoopVars
maxLoopVars = case _ of
  "index0" -> Just "index0"
  "index1" -> Just "index1"
  "rindex0" -> Just "rindex0"
  "rindex1" -> Just "rindex1"
  "first" -> Just "first"
  "last" -> Just "last"
  "length" -> Just "length"
  "key" -> Just "key"
  "index" -> Just "index0" -- alias
  "rindex" -> Just "rindex0" -- alias
  "size" -> Just "length" -- alias
  _ -> Nothing

-- | Render MaxBars surface source against data, reusing FullBars' surface
-- | pipeline (desugar → hoist → @truthiness → engine) with located errors and
-- | MaxBars' bare loop variables.
renderMax :: String -> Value -> Either String String
renderMax = renderSurfaceDiagWith maxLoopVars maxOptions

-- | Compile MaxBars surface source to a JS ES module, reusing the FullBars
-- | compiler (`FlatBars.Compile`) — infix/pipe and loop vars desugar to the same
-- | core helpers the emit rules already handle.
compileMaxJs :: String -> Either ParseError String
compileMaxJs = compileSurfaceWith maxLoopVars maxOptions

-- | The loop-variable shadow lint (ADR-006, schema-less *warn-always* tier): a
-- | bare loop variable whose name reads like a data field (`first`/`last`/
-- | `length`/`key`) is flagged with a `Warn` `Issue`, since dropping `@` lets it
-- | silently shadow a field. Parses MaxBars `src`, desugars with the loop-var
-- | resolver, then lints (see `MaxBars.Lint`). A parse error short-circuits.
loopVarWarnings :: String -> Either ParseError (Array Issue)
loopVarWarnings src = do
  { nodes } <- parseWith maxOptions src
  pure (loopVarShadowWarnings (desugarSurfaceWith maxLoopVars nodes))
