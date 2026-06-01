-- | Linter tests (`spago test -p linter`): the **round-trip property** is the
-- | acceptance oracle for the lossless lower (loopvars-linter-spec.md §X0).
-- |
-- | For each truthiness-default MaxBars template in the corpus:
-- |   srcAst = lower (desugarSurfaceWith maxLoopVars (parseWith maxOptions src))
-- |   lowered = lowerToRawBars src                       -- RawBars source text
-- |   outAst  = lower (parse lowered).nodes              -- re-parse with the
-- |                                                         default core parser
-- |   assert srcAst == outAst
-- |
-- | i.e. printing the desugared MaxBars AST as RawBars and re-parsing it yields
-- | the same real AST. Plus a couple of direct `printRawBars` shape checks.
module Test.Linter.Main where

import Prelude

import BareBars.Parser (parse, parseWith)
import Data.Either (Either(..))
import Data.String (Pattern(..), contains)
import Effect (Effect)
import Effect.Console (log)
import FullBars (desugarSurfaceWith)
import Kernel.Lower (RNode, lower)
import Linter.Lower (lowerToRawBars)
import MaxBars (maxLoopVars, maxOptions)
import Test.Assert (assert')

-- | The desugared MaxBars source as the reference real AST.
maxAst :: String -> Either String (Array RNode)
maxAst src = case parseWith maxOptions src of
  Left e -> Left ("MaxBars parse failed: " <> show e)
  Right { nodes } -> Right (lower (desugarSurfaceWith maxLoopVars nodes))

-- | The lowered RawBars source, re-parsed with the *default core* parser, as the
-- | reference real AST.
loweredAst :: String -> Either String (Array RNode)
loweredAst src = case lowerToRawBars src of
  Left e -> Left ("lower failed: " <> show e)
  Right lowered -> case parse lowered of
    Left e -> Left ("re-parse of lowered RawBars failed: " <> show e <> "\n  lowered = " <> lowered)
    Right { nodes } -> Right (lower nodes)

-- | Assert the round-trip property for one template.
roundTrips :: String -> String -> Effect Unit
roundTrips name src = case maxAst src, loweredAst src of
  Left e, _ -> assert' (name <> ": " <> e) false
  _, Left e -> assert' (name <> ": " <> e) false
  Right a, Right b ->
    assert' (name <> ": ASTs differ\n  src = " <> show a <> "\n  out = " <> show b) (a == b)

-- | Assert that lowering `src` produces text containing `needle`.
lowersContaining :: String -> String -> String -> Effect Unit
lowersContaining name src needle = case lowerToRawBars src of
  Left e -> assert' (name <> ": lower failed: " <> show e) false
  Right out -> assert' (name <> ": expected " <> show out <> " to contain " <> show needle)
    (contains (Pattern needle) out)

main :: Effect Unit
main = do
  log "Linter lower round-trip tests"

  -- Round-trip corpus: truthiness-default MaxBars templates spanning
  -- interpolation, paths, sections, inverted sections, each + loop vars, infix
  -- operators, and pipes.
  roundTrips "plain text" "hello world"
  roundTrips "simple interpolation" "{{ a }}"
  roundTrips "dotted path" "{{ user.name }}"
  roundTrips "raw output" "{{{ a }}}"
  roundTrips "infix and" "{{ a && b }}"
  roundTrips "infix comparison" "{{ a > b }}"
  roundTrips "pipe unary" "{{ o | json }}"
  roundTrips "pipe with arg" "{{ a | f x }}"
  roundTrips "if/else" "{{#if x > 0}}big{{else}}small{{/if}}"
  roundTrips "if elif else" "{{#if x > 10}}big{{elif x > 0}}small{{else}}none{{/if}}"
  roundTrips "unless" "{{#unless done}}todo{{/unless}}"
  -- MaxBars has no `{{^x}}` syntax (extras off); the inverted-section role is
  -- spelled `{{#unless}}` / negation here.
  roundTrips "unless with else" "{{#unless items}}empty{{else}}has items{{/unless}}"
  roundTrips "not infix" "{{ !done }}"
  roundTrips "each loop vars" "{{#each xs}}[{{index1}}/{{this}}]{{/each}}"
  roundTrips "each first/last"
    "{{#each xs}}{{#if first}}({{/if}}{{this}}{{#if last}}){{/if}}{{/each}}"
  roundTrips "each with infix cond" "{{#each xs}}{{#if index0 > 0}}, {{/if}}{{this}}{{/each}}"
  roundTrips "nested each" "{{#each users}}{{#each this.posts}}{{this}}{{/each}}{{/each}}"
  roundTrips "mixed" "Hi {{ user.name | upper }}!{{#each xs}} {{index1}}={{this}}{{/each}}"

  -- Direct shape assertions on the printer.
  lowersContaining "and shape" "{{ a && b }}"
    "{{{ esc_html (and (lookup this \"a\") (lookup this \"b\")) }}}"
  lowersContaining "gt shape" "{{ a > b }}"
    "{{{ esc_html (gt (lookup this \"a\") (lookup this \"b\")) }}}"
  lowersContaining "pipe shape" "{{{ o | json }}}"
    "{{{ json (lookup this \"o\") }}}"
  lowersContaining "section shape" "{{#unless done}}x{{/unless}}"
    "{{#unless (lookup this \"done\")}}x{{/unless}}"

  log "Linter tests passed"
