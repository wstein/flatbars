-- | The **FullBars surface** compile path: desugar surface syntax to the core
-- | skeleton, hoist `{{#inline}}` into the partial registry, then run the shared
-- | emit rules (`FlatBars.Compile.Emit`) through the driver. This module is the
-- | only compile piece that depends on the FullBars dialect (for the desugar);
-- | the emit rules themselves are dialect-free, so RawBars compiles without it.
-- | It lives in its own package (`fullbars-compile`) so the dialect-free
-- | `flatbars-compile` (driver + emit) carries no FullBars dependency.
module FullBars.Compile
  ( compileSurface
  , compileSurfaceWith
  ) where

import Prelude

import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either)
import Data.Map as Map
import FlatBars.Compile (compile)
import FlatBars.Compile.Emit (fullbarsEmit, metaFor)
import FlatBars.Error (ParseError)
import FlatBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import FullBars (LoopVars, checkBareInline, desugarSurfaceWith, hoistInline, noLoopVars)

-- | Compile *surface* FullBars source: desugar (paths, `{{ }}` auto-escape,
-- | `@data`, hash args, block params, `else if`) to the core skeleton, hoist
-- | `{{#inline}}` definitions into the partial registry (as `renderSurfaceWith`
-- | does), then emit. The emit rules are dialect-pure — they only ever see core.
compileSurface :: String -> Either ParseError String
compileSurface = compileSurfaceWith true noLoopVars defaultParseOptions "rt.truthyHandlebars"

-- | `compileSurface` with explicit parse options, a dialect `LoopVars` resolver,
-- | and the runtime truthiness *callback* to seed (`"rt.truthyHandlebars"` for
-- | FullBars, `"rt.truthyNonEmpty"` for MaxBars). The leading `strict` flag gates
-- | the bare-`{{#inline}}` rejection (FullBars requires the `{{#*inline}}`
-- | decorator; MaxBars passes `false`).
compileSurfaceWith
  :: Boolean -> LoopVars -> ParseOptions -> String -> String -> Either ParseError String
compileSurfaceWith strict lv opts truthyCallback src = do
  { nodes } <- lmap NEA.head (parseWith opts src)
  checkBareInline strict nodes
  let h = hoistInline (desugarSurfaceWith lv nodes)
  pure (compile (metaFor truthyCallback) fullbarsEmit (Map.toUnfoldable h.partials) h.template)
