-- | **MaxBars** — the top tier of the dialect ladder (CoreBars ⊂ FullBars ⊂
-- | MaxBars). It is FullBars plus a richer *surface*: infix operators and pipes
-- | (`MaxBars.Expr`). Because that surface desugars to the same core `Expr` that
-- | FullBars already understands, MaxBars reuses FullBars wholesale by
-- | dependency — the engine, prelude, value policy, surface desugar, and the
-- | compiler — swapping only the interior expression grammar through the
-- | `ParseOptions.parseExpr` seam. (A shared semantic *kernel* is extracted
-- | lazily, only for proven overlaps; see the project notes.)
module MaxBars
  ( maxOptions
  , renderMax
  , compileMaxJs
  ) where

import BareBars.Compile.FullBars (compileSurfaceWith)
import BareBars.Error (ParseError)
import BareBars.Parser (ParseOptions, defaultParseOptions)
import BareBars.Value (Value)
import Data.Either (Either)
import FullBars (renderSurfaceDiagWith)
import MaxBars.Expr (parseMaxExpr)

-- | Parse options for the MaxBars dialect: the default front-end knobs
-- | (standalone trimming, …) with the interior grammar swapped for
-- | `MaxBars.Expr` (infix operators + pipes), and the Handlebars-only tag shapes
-- | (`{{{{…}}}}`, `{{^…}}`, `{{&…}}`) rejected (`extras` off) — MaxBars is not the
-- | Handlebars-compatibility dialect.
maxOptions :: ParseOptions
maxOptions = defaultParseOptions { parseExpr = parseMaxExpr, extras = false }

-- | Render MaxBars surface source against data, reusing FullBars' surface
-- | pipeline (desugar → hoist → @truthiness → engine) with located errors.
renderMax :: String -> Value -> Either String String
renderMax = renderSurfaceDiagWith maxOptions

-- | Compile MaxBars surface source to a JS ES module, reusing the FullBars
-- | compiler (`BareBars.Compile`) — infix/pipe desugar to the same core helpers
-- | the emit rules already handle.
compileMaxJs :: String -> Either ParseError String
compileMaxJs = compileSurfaceWith maxOptions
