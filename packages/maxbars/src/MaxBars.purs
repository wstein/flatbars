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
  ) where

import BareBars.Error (ParseError)
import BareBars.Parser (ParseOptions, defaultParseOptions)
import BareBars.Value (Value)
import Data.Either (Either)
import Data.Maybe (Maybe(..))
import FullBars (LoopVars, renderSurfaceDiagWith)
import FullBars.Compile (compileSurfaceWith)
import MaxBars.Expr (parseMaxExpr)

-- | Parse options for the MaxBars dialect: the default front-end knobs
-- | (standalone trimming, …) with the interior grammar swapped for
-- | `MaxBars.Expr` (infix operators + pipes), and the Handlebars-only tag shapes
-- | (`{{{{…}}}}`, `{{^…}}`, `{{&…}}`) rejected (`extras` off) — MaxBars is not the
-- | Handlebars-compatibility dialect.
maxOptions :: ParseOptions
maxOptions = defaultParseOptions { parseExpr = parseMaxExpr, extras = false }

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
-- | compiler (`BareBars.Compile`) — infix/pipe and loop vars desugar to the same
-- | core helpers the emit rules already handle.
compileMaxJs :: String -> Either ParseError String
compileMaxJs = compileSurfaceWith maxLoopVars maxOptions
