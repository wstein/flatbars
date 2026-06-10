-- | Emitter unit tests for the ClassicBars **surface** compile path
-- | (`ClassicBars.Compile.compileSurface`): desugar + `{{#*inline}}` hoist + emit.
-- | These cover codegen that only exists after surface desugaring (inline
-- | partials, `@truthiness` falsy-set threading); the dialect-free driver/emit
-- | shape tests live in the `flatbars-compile` package, and byte-for-byte
-- | execution conformance is the Node harness `packages/compile/conformance.mjs`.
module Test.ClassicBars.Compile.Main where

import Prelude

import ClassicBars.Compile (compileSurface)
import Data.Either (Either(..))
import Data.Foldable (for_)
import Data.String (Pattern(..), contains)
import Effect (Effect)
import Effect.Console (log)
import Test.Assert (assert')

-- assert surface `src` compiles and the JS contains every fragment in `needles`.
expectJsS :: String -> String -> Array String -> Effect Unit
expectJsS name src needles = case compileSurface src of
  Left e -> assert' (name <> ": unexpected compile error: " <> show e) false
  Right js -> for_ needles \n ->
    assert' (name <> ": expected JS to contain " <> show n <> "\n--- JS ---\n" <> js)
      (contains (Pattern n) js)

main :: Effect Unit
main = do
  log "ClassicBars.Compile surface emitter tests"

  expectJsS "surface inline def becomes a partial registry; {{> }} calls rt.partial"
    "{{#*inline \"row\"}}[{{ this }}]{{/inline}}{{#each items}}{{> row}}{{/each}}"
    [ "partials = Object.assign({}, partials, {"
    , "\"row\": function (data, rt, partials)"
    , "rt.partial(\"row\", c1.ctx, null, partials, rt)"
    ]

  -- ADR-022: truthiness is the engine's fixed `handlebars` rule, emitted as a
  -- callback ($truthy = rt.truthyHandlebars) and threaded — no falsy-set data.
  expectJsS "seeds + threads the handlebars truthiness callback"
    "{{#if n}}y{{else}}m{{/if}}"
    [ "rt.scope(data, rt.truthyHandlebars, ", "rt.truthy(c0.truthy," ]

  log "all ClassicBars.Compile surface emitter tests passed"
