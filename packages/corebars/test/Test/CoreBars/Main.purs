-- | CoreBars dialect tests (`spago test -p corebars`): rendering and compiling
-- | the austere *core* syntax (explicit calls, no surface sugar).
module Test.CoreBars.Main where

import Prelude

import BareBars.Value (Value(..))
import CoreBars (compileJs, render)
import Data.Either (Either(..), isLeft)
import Data.Map as Map
import Data.String (Pattern(..), contains)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import Test.Assert (assert')

obj :: Array (Tuple String Value) -> Value
obj = VObject <<< Map.fromFoldable

main :: Effect Unit
main = do
  log "CoreBars dialect tests"

  -- core syntax renders against the shared engine (explicit lookup, raw output).
  assert' "render: lookup"
    (render "{{{lookup this \"x\"}}}" (obj [ Tuple "x" (VString "hi") ]) == Right "hi")
  assert' "render: if/else block"
    ( render "{{#if (lookup this \"a\")}}Y{{else}}N{{/if}}" (obj [ Tuple "a" (VBool false) ])
        == Right "N"
    )
  -- @truthiness applies in the core dialect too (shared engine).
  assert' "render: @truthiness:minimal (0 truthy)"
    ( render "{{! @truthiness:minimal }}{{#if (lookup this \"n\")}}y{{else}}m{{/if}}"
        (obj [ Tuple "n" (VNumber 0.0) ]) == Right "y"
    )
  -- a parse error surfaces as Left.
  assert' "render: parse error" (isLeft (render "{{ oops" (obj [])))

  -- CoreBars is austere: the Handlebars-only shapes are rejected (DisallowedShape).
  assert' "reject: inverse {{^}}" (isLeft (render "{{^a}}x{{/a}}" (obj [])))
  assert' "reject: triple inverse {{{^}}}" (isLeft (render "{{{^a}}}x{{{/a}}}" (obj [])))
  assert' "reject: unescaped {{&}}" (isLeft (render "{{&a}}" (obj [])))
  assert' "reject: raw block {{{{}}}}" (isLeft (render "{{{{r}}}}body{{{{/r}}}}" (obj [])))
  -- the same rejection in the compiled path.
  assert' "reject (compile): inverse" (isLeft (compileJs "{{^a}}x{{/a}}"))

  -- compile core syntax to a JS module.
  case compileJs "{{{this}}}" of
    Left e -> assert' ("compileJs: unexpected error " <> show e) false
    Right js -> assert' ("compileJs: expected a module\n" <> js)
      (contains (Pattern "rt.scope(data") js && contains (Pattern "rt.out(c0.ctx)") js)

  log "all CoreBars tests passed"
