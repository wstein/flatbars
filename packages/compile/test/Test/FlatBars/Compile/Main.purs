-- | Emitter unit tests for the dialect-free `FlatBars.Compile` driver + the
-- | `FlatBars.Compile.Emit` rules, exercised through the RawBars dialect's
-- | `compileJs` (no surface desugar — so `{{{item}}}`/scoped vars stay
-- | scoped-helper calls, not lookups). They check the *shape* of the generated
-- | JS (native control flow, inlined hot helpers, the runtime header);
-- | byte-for-byte execution conformance against the interpreter is the Node
-- | harness `packages/compile/conformance.mjs`. Surface-only codegen
-- | (`compileSurface`) is tested in the `fullbars-compile` package.
module Test.FlatBars.Compile.Main where

import Prelude

import Data.Either (Either(..))
import Data.Foldable (for_)
import Data.String (Pattern(..), contains)
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Error (ParseError)
import RawBars (compileJs) as RawBars
import Test.Assert (assert')

-- assert `src` compiles and the JS contains every fragment in `needles`.
expectJs :: String -> String -> Array String -> Effect Unit
expectJs = expectWith RawBars.compileJs

expectWith
  :: (String -> Either ParseError String) -> String -> String -> Array String -> Effect Unit
expectWith compileFn name src needles = case compileFn src of
  Left e -> assert' (name <> ": unexpected compile error: " <> show e) false
  Right js -> for_ needles \n ->
    assert' (name <> ": expected JS to contain " <> show n <> "\n--- JS ---\n" <> js)
      (contains (Pattern n) js)

main :: Effect Unit
main = do
  log "FlatBars.Compile emitter tests"

  expectJs "header + scope seeded with the truthiness callback" "hi"
    [ "runtime 0.1.0"
    , "function (data, rt, partials)"
    , "rt.scope(data, rt.truthyHandlebars)" -- handlebars rule, as a callback (ADR-022)
    , "out += \"hi\""
    ]

  expectJs "output + inlined escapeHtml/lookup/this"
    "{{{escapeHtml (lookup this \"name\")}}}"
    [ "rt.out(rt.esc(rt.lookup(c0.ctx, \"name\")))" ]

  expectJs "if/else compiles to native control flow"
    "{{#if (lookup this \"a\")}}X{{else}}Y{{/if}}"
    [ "if (rt.truthy(c0.truthy, rt.lookup(c0.ctx, \"a\"))) {"
    , "} else {"
    , "out += \"X\""
    , "out += \"Y\""
    ]

  expectJs "elif chains to else-if"
    "{{#if (lookup this \"a\")}}A{{elif (lookup this \"b\")}}B{{else}}C{{/if}}"
    [ "} else if (rt.truthy(c0.truthy, rt.lookup(c0.ctx, \"b\"))) {" ]

  expectJs "unless negates the test"
    "{{#unless (lookup this \"a\")}}N{{/unless}}"
    [ "if (!(rt.truthy(c0.truthy, rt.lookup(c0.ctx, \"a\")))) {" ]

  expectJs "each compiles to a frame loop with a child scope"
    "{{#each (lookup this \"xs\")}}{{{this}}}{{/each}}"
    [ "rt.each(rt.lookup(c0.ctx, \"xs\"), c0, [], null, function (c1)", "rt.out(c1.ctx)" ]

  expectJs "each passes block-param names to the runtime"
    "{{#each (lookup this \"xs\") \"item\" \"i\"}}{{{item}}}{{/each}}"
    [ "rt.each(rt.lookup(c0.ctx, \"xs\"), c0, [\"item\", \"i\"], null, function (c1)"
    , "rt.call(\"item\", [], c1)"
    ]

  expectJs "with shifts the frame"
    "{{#with (lookup this \"o\")}}{{{this}}}{{/with}}"
    [ "rt.with(rt.lookup(c0.ctx, \"o\"), c0, [], null, function (c1)" ]

  expectJs "unknown helper routes through the runtime registry"
    "{{{eq (lookup this \"a\") (lookup this \"b\")}}}"
    [ "rt.call(\"eq\", [rt.lookup(c0.ctx, \"a\"), rt.lookup(c0.ctx, \"b\")], c0)" ]

  -- a malformed template is a compile (parse) error, not a crash.
  case RawBars.compileJs "{{ oops" of
    Left _ -> pure unit
    Right _ -> assert' "expected a parse error for an unterminated tag" false

  log "all compile emitter tests passed"
