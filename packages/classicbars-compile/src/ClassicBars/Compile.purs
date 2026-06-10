-- | The **ClassicBars surface** compile path: desugar surface syntax to the core
-- | skeleton, hoist `{{#inline}}` into the partial registry, then run the shared
-- | emit rules (`FlatBars.Compile.Emit`) through the driver. This module is the
-- | only compile piece that depends on the ClassicBars dialect (for the desugar);
-- | the emit rules themselves are dialect-free, so RawBars compiles without it.
-- | It lives in its own package (`classicbars-compile`) so the dialect-free
-- | `flatbars-compile` (driver + emit) carries no ClassicBars dependency.
module ClassicBars.Compile
  ( compileSurface
  , compileSurfaceWith
  , compileSurfaceWithPartials
  ) where

import Prelude

import ClassicBars (LoopVars, checkSurfaceStrict, desugarSurfaceWith, hoistInline, noLoopVars)
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either)
import Data.Map as Map
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Compile (compile)
import FlatBars.Compile.Emit (classicbarsEmit, metaFor)
import FlatBars.Error (ParseError)
import FlatBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import FlatBars.Syntax (Template)

-- | Compile *surface* ClassicBars source: desugar (paths, `{{ }}` auto-escape,
-- | `@data`, hash args, block params, `else if`) to the core skeleton, hoist
-- | `{{#inline}}` definitions into the partial registry (as `renderSurfaceWith`
-- | does), then emit. The emit rules are dialect-pure — they only ever see core.
compileSurface :: String -> Either ParseError String
compileSurface = compileSurfaceWith true noLoopVars defaultParseOptions "rt.truthyHandlebars"

-- | `compileSurface` with explicit parse options, a dialect `LoopVars` resolver,
-- | and the runtime truthiness *callback* to seed (`"rt.truthyHandlebars"` for
-- | ClassicBars, `"rt.truthyNonEmpty"` for MaxBars). The leading `strict` flag gates
-- | the bare-`{{#inline}}` rejection (ClassicBars requires the `{{#*inline}}`
-- | decorator; MaxBars passes `false`).
compileSurfaceWith
  :: Boolean -> LoopVars -> ParseOptions -> String -> String -> Either ParseError String
compileSurfaceWith strict lv opts truthyCallback = compileSurfaceWithPartials strict lv opts
  truthyCallback
  []

-- | `compileSurfaceWith` plus a set of named *external* partials (each given as
-- | dialect-surface source). Mirrors the interpreter's `renderSurfaceWith` /
-- | `renderSurfaceWithHelpersWith`: each external partial is parsed + desugared
-- | with the dialect's options and folded into the compiled module's partial
-- | registry, alongside the template's own hoisted `{{#inline}}` definitions
-- | (inline wins on a name clash, left-biased — matching render). So `{{> name}}`
-- | resolves a host-threaded partial in the compiled output, not only an inline one.
compileSurfaceWithPartials
  :: Boolean
  -> LoopVars
  -> ParseOptions
  -> String
  -> Array (Tuple String String)
  -> String
  -> Either ParseError String
compileSurfaceWithPartials strict lv opts truthyCallback partialSrcs src = do
  externals <- traverse compilePartial partialSrcs
  { nodes } <- lmap NEA.head (parseWith opts src)
  checkSurfaceStrict strict nodes
  let
    h = hoistInline (desugarSurfaceWith lv nodes)
    externalT = Map.fromFoldable externals
    -- inline definitions win over same-named externals (left-biased), as render does.
    registry = Map.union h.partials externalT
  -- ADR-005 amendment: ClassicBars (Handlebars `{{#> }}`, `opts.partialBlocks`)
  -- exposes a block partial's body as `partial-block`; MaxBars (same emit) uses `yield`.
  pure
    ( compile (metaFor truthyCallback (if opts.partialBlocks then "partial-block" else "yield"))
        classicbarsEmit
        (Map.toUnfoldable registry)
        h.template
    )
  where
  -- a named external partial: parse + desugar its body with the dialect's options
  -- + loop-var map (so a MaxBars partial sees infix/pipes/loop vars).
  compilePartial :: Tuple String String -> Either ParseError (Tuple String Template)
  compilePartial (Tuple name s) = do
    { nodes } <- lmap NEA.head (parseWith opts s)
    pure (Tuple name (desugarSurfaceWith lv nodes))
