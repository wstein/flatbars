-- | The **FullBars surface** compile path: desugar surface syntax to the core
-- | skeleton, hoist `{{#inline}}` into the partial registry, then run the shared
-- | emit rules (`BareBars.Compile.Emit`) through the driver. This module is the
-- | only compile piece that depends on the FullBars dialect (for the desugar);
-- | the emit rules themselves are dialect-free, so RawBars compiles without it.
module BareBars.Compile.FullBars
  ( compileSurface
  , compileSurfaceWith
  ) where

import Prelude

import BareBars.Compile (compile)
import BareBars.Compile.Emit (fullbarsEmit, metaFor, resolveForCompile)
import BareBars.Error (ParseError)
import BareBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import Data.Either (Either)
import Data.Map as Map
import FullBars (desugarSurface, hoistInline)

-- | Compile *surface* FullBars source: desugar (paths, `{{ }}` auto-escape,
-- | `@data`, hash args, block params, `else if`) to the core skeleton, hoist
-- | `{{#inline}}` definitions into the partial registry (as `renderSurfaceWith`
-- | does), then emit. The emit rules are dialect-pure — they only ever see core.
compileSurface :: String -> Either ParseError String
compileSurface = compileSurfaceWith defaultParseOptions

-- | `compileSurface` with explicit parse options (CLI/config: standalone trim).
compileSurfaceWith :: ParseOptions -> String -> Either ParseError String
compileSurfaceWith opts src = do
  { directives, nodes } <- parseWith opts src
  fs <- resolveForCompile directives
  let h = hoistInline (desugarSurface nodes)
  pure (compile (metaFor fs) fullbarsEmit (Map.toUnfoldable h.partials) h.template)
