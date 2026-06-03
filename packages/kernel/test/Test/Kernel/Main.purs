-- | Kernel test suite (`spago test -p kernel`) — the shared engine substrate:
-- | value policy (truthiness), the walk toolkit (foldTemplate/clauses/validate),
-- | and the host `ToValue` binding. (End-to-end rendering is exercised by the
-- | dialect suites; this pins the kernel pieces in isolation.)
module Test.Kernel.Main where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Map as Map
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars (Node(..), Value(..), parse)
import Kernel.ToValue (toValue)
import Kernel.Value (handlebars, isFalsy, minimal, mustache, truthy)
import Kernel.Walk (Arity(..), foldTemplate, splitClauses, validate)
import Test.Assert (assert')

-- foldTemplate node counter (descends into block bodies).
nodeCount :: String -> Int
nodeCount src = case parse src of
  Left _ -> -1
  Right { nodes } -> foldTemplate
    { content: \_ -> 1
    , output: \_ -> 1
    , raw: \_ _ _ -> 1
    , sep: \_ _ -> 1
    , block: \b -> 1 + b.recurse b.children
    , nodeError: \_ _ -> 1
    , concat: Array.foldl (+) 0
    }
    nodes

main :: Effect Unit
main = do
  log "Kernel tests"

  -- value policy: truthiness under a falsy-set.
  assert' "truthy: false is falsy (handlebars)" (truthy handlebars (VBool false) == false)
  assert' "truthy: 0 is falsy (handlebars)" (truthy handlebars (VNumber 0.0) == false)
  assert' "truthy: 0 is truthy (minimal)" (truthy minimal (VNumber 0.0) == true)
  assert' "truthy: non-empty string truthy" (truthy handlebars (VString "x") == true)
  -- mustache set: false/null/[] falsy; 0/""/{}  truthy (the Mustache rule)
  assert' "mustache: 0 is truthy" (truthy mustache (VNumber 0.0) == true)
  assert' "mustache: empty string truthy" (truthy mustache (VString "") == true)
  assert' "mustache: empty object truthy" (truthy mustache (VObject Map.empty) == true)
  assert' "mustache: empty array falsy" (isFalsy mustache (VArray []) == true)
  assert' "mustache: false falsy" (isFalsy mustache (VBool false) == true)
  -- ADR-022: truthiness is a fixed per-engine rule (these named rules are the
  -- data-backed menu), no per-file @truthiness resolver anymore.

  -- walk: foldTemplate descends into block bodies.
  assert' "foldTemplate node count" (nodeCount "a{{#each x}}b{{{this}}}{{/each}}c" == 5)

  -- walk: splitClauses splits a body at separators.
  case parse "{{#if c}}A{{else}}B{{/if}}" of
    Right { nodes: [ Block _ _ _ _ body ] } ->
      assert' "splitClauses before" ((splitClauses body).before == [ Content "A" ])
    _ -> assert' "splitClauses: unexpected parse" false

  -- walk: schema validation flags an unknown helper.
  let
    schema =
      { allowUnknown: false
      , helpers: Map.fromFoldable [ Tuple "if" { block: true, arity: Exactly 1 } ]
      }
  case parse "{{{nope}}}" of
    Right { nodes } -> assert' "validate flags unknown" (not (Array.null (validate schema nodes)))
    Left e -> assert' ("validate: " <> show e) false

  -- ToValue host binding.
  assert' "toValue String" (toValue "x" == VString "x")
  assert' "toValue Int" (toValue (3 :: Int) == VNumber 3.0)

  log "all kernel tests passed"
