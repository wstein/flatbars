-- | BareBars *framework* test suite (`spago test -p barebars`).
-- |
-- | Structural only — parsing shapes, the foldTemplate catamorphism, clause
-- | splitting, schema validation, and source spans. No rendering: that is the
-- | engine's job and is tested in `flatbars`.
module Test.BareBars.Main where

import Prelude

import BareBars (Arity(..), Expr(..), Node(..), foldExpr, foldTemplate, parse, parseErrorAt, spanText, splitClause, splitClauses, validate)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Monoid (power)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import Test.Assert (assert')

-- A tiny engine schema: `if` is a 1-arg block, `c`/`x` are nullary.
schema
  :: { allowUnknown :: Boolean, helpers :: Map.Map String { block :: Boolean, arity :: Arity } }
schema =
  { allowUnknown: false
  , helpers: Map.fromFoldable
      [ Tuple "if" { block: true, arity: Exactly 1 }
      , Tuple "c" { block: false, arity: Exactly 0 }
      , Tuple "x" { block: false, arity: Exactly 0 }
      ]
  }

-- foldTemplate node counter (descends into block bodies).
nodeCount :: String -> Int
nodeCount src = case parse src of
  Left _ -> -1
  Right t -> foldTemplate
    { content: \_ -> 1
    , output: \_ -> 1
    , raw: \_ _ _ -> 1
    , sep: \_ _ -> 1
    , block: \b -> 1 + b.recurse b.children
    , concat: Array.foldl (+) 0
    }
    t

main :: Effect Unit
main = do
  log "BareBars framework tests"

  -- Well-formed parse, and the structural shapes the parser emits.
  case parse "a{{{x}}}{{#if c}}t{{else}}e{{/if}}" of
    Left e -> assert' ("parse: unexpected error " <> show e) false
    Right t -> do
      assert' "parse: content/output/block shapes"
        ( t ==
            [ Content "a"
            , Output { start: 1, end: 8 } (App "x" [])
            , Block { start: 8, end: 17 } "if" [ App "c" [] ]
                [ Content "t", Sep { start: 18, end: 26 } "else" [], Content "e" ]
            ]
        )

  -- foldTemplate counts every node, recursing into bodies.
  assert' "foldTemplate node count" (nodeCount "a{{#each x}}b{{{this}}}{{/each}}c" == 5)

  -- foldExpr: a catamorphism over an expression. Count App nodes in a nested
  -- subexpression, descending into application arguments.
  case parse "{{{lookup this \"x\"}}}" of
    Right [ Output _ e ] ->
      let
        appCount = foldExpr { lit: \_ -> 0, app: \_ kids -> 1 + Array.foldl (+) 0 kids } e
      in
        assert' "foldExpr counts App nodes" (appCount == 2) -- (lookup …) and (this)
    _ -> assert' "foldExpr: unexpected parse" false

  -- splitClause shallowly splits a body at the first {{else}} separator.
  case parse "{{#if c}}A{{else}}B{{/if}}" of
    Right [ Block _ _ _ body ] ->
      let
        s = splitClause "else" body
      in
        assert' "splitClause before/after"
          (s.before == [ Content "A" ] && s.clause == Just [ Content "B" ])
    _ -> assert' "splitClause: unexpected parse" false

  -- splitClauses returns every separator-delimited section; splitClause bounds a
  -- clause at the next separator (a second {{else}} opens its own clause and
  -- does not leak into the first).
  case parse "{{#if c}}A{{else}}B{{else}}C{{/if}}" of
    Right [ Block _ _ _ body ] -> do
      let
        cs = splitClauses body
      assert' "splitClauses before" (cs.before == [ Content "A" ])
      assert' "splitClauses yields both clauses"
        (map _.body cs.clauses == [ [ Content "B" ], [ Content "C" ] ])
      assert' "splitClause bounds at next separator"
        ((splitClause "else" body).clause == Just [ Content "B" ])
    _ -> assert' "splitClauses: unexpected parse" false

  -- Schema validation flags an unknown helper; a known-arity call is clean.
  case parse "{{#if c}}{{{x}}}{{/if}}" of
    Right t -> assert' "validate clean" (Array.null (validate schema t))
    Left e -> assert' ("validate: " <> show e) false
  case parse "{{{nope}}}" of
    Right t -> assert' "validate flags unknown" (not (Array.null (validate schema t)))
    Left e -> assert' ("validate: " <> show e) false

  -- Stack safety: a large flat template (long content run + many output tags)
  -- must lex and parse without overflowing — the tokenizer and the sibling
  -- scan are tail-recursive. (Regression: a ~6 KB template used to overflow.)
  let
    big = power "x{{{a}}}y " 20000 -- ~180 KB, ~40000 content/output nodes
  case parse big of
    Right t -> assert' "large template parses without overflow" (Array.length t > 40000)
    Left e -> assert' ("large template overflowed/failed: " <> show e) false

  -- Source spans on tag-level nodes + spanText.
  case parse "  {{{this}}}" of
    Right [ _, Output sp _ ] ->
      assert' "span offsets + spanText"
        (sp.start == 2 && sp.end == 12 && spanText "  {{{this}}}" sp == "{{{this}}}")
    _ -> assert' "span: unexpected parse" false

  -- Parse-error line/column (P8): `{{{}}}` (empty output) starts at line 2, col 7.
  let
    bad = "hello\nworld {{{}}}"
  case parse bad of
    Left e ->
      let
        d = parseErrorAt bad e
      in
        assert' ("parseErrorAt: " <> show d.line <> ":" <> show d.column <> " " <> d.message)
          (d.line == 2 && d.column == 7)
    Right _ -> assert' "parseErrorAt: expected a parse error" false

  log "all framework tests passed"
