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
-- | the same real AST. Plus a couple of direct `printRawBars` shape checks. The
-- | comparison is *structural*: source spans are stripped first, since re-printing
-- | relocates every tag (the lift is position-lossy by construction, not lossless
-- | on offsets — only on structure and rendering).
module Test.Linter.Main where

import Prelude

import ClassicBars (desugarSurfaceWith, renderSurface)
import Data.Either (Either(..))
import Data.Map as Map
import Data.String (Pattern(..), contains)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Parser (parse, parseWith)
import FlatBars.Span (Span)
import FlatBars.Value (Value(..))
import Kernel.Lower (RNode(..), lower)
import Linter.Lower (lowerToRawBars)
import Linter.Migrate (migrateToMaxBars)
import MaxBars (maxLoopVars, maxOptions, renderMax)
import RawBars as RawBars
import Test.Assert (assert')
import Test.Linter.Aliases as Aliases
import Test.Linter.Lift as Lift
import Test.Linter.Migrate as Migrate

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

-- | Assert the round-trip property for one template. Compared structurally:
-- | spans are stripped because re-printing relocates every tag.
roundTrips :: String -> String -> Effect Unit
roundTrips name src = case maxAst src, loweredAst src of
  Left e, _ -> assert' (name <> ": " <> e) false
  _, Left e -> assert' (name <> ": " <> e) false
  Right a, Right b ->
    assert' (name <> ": ASTs differ\n  src = " <> show a <> "\n  out = " <> show b)
      (stripSpans a == stripSpans b)

-- | Zero every node's span so two lowered ASTs compare on structure alone.
stripSpans :: Array RNode -> Array RNode
stripSpans = map strip
  where
  z :: Span
  z = { start: 0, end: 0 }
  strip = case _ of
    RText _ s -> RText z s
    ROut _ b e -> ROut z b e
    RIf _ c a b -> RIf z c (stripSpans a) (stripSpans b)
    RUnless _ c a b -> RUnless z c (stripSpans a) (stripSpans b)
    REach _ c a b -> REach z c (stripSpans a) (stripSpans b)
    RWith _ c a b -> RWith z c (stripSpans a) (stripSpans b)
    RCall _ n args ch -> RCall z n args (stripSpans ch)
    RSep _ n args -> RSep z n args
    RRaw _ s -> RRaw z s

-- | Assert that lowering `src` produces text containing `needle`.
lowersContaining :: String -> String -> String -> Effect Unit
lowersContaining name src needle = case lowerToRawBars src of
  Left e -> assert' (name <> ": lower failed: " <> show e) false
  Right out -> assert' (name <> ": expected " <> show out <> " to contain " <> show needle)
    (contains (Pattern needle) out)

-- | The shared truthiness matrix data: one value per falsy *shape* plus a
-- | non-empty witness, so a body can probe how a mode treats each shape.
matrixData :: Value
matrixData = VObject $ Map.fromFoldable
  [ Tuple "zero" (VNumber 0.0)
  , Tuple "empty" (VString "")
  , Tuple "arr" (VArray [])
  , Tuple "ob" (VObject Map.empty)
  , Tuple "yes" (VString "x")
  ]

-- | X1 acceptance: a `@truthiness: <dir>`-mode template renders identically
-- | through the MaxBars interpreter and through its lowered RawBars source
-- | (`renderMax src == RawBars.render (lower src)`), against `matrixData`.
rendersSame :: String -> String -> String -> Effect Unit
rendersSame name dir body =
  let
    src = "{{! @truthiness: " <> dir <> " }}" <> body
  in
    case lowerToRawBars src of
      Left e -> assert' (name <> ": lower failed: " <> show e) false
      Right lowered ->
        let
          want = renderMax src matrixData
          got = RawBars.render lowered matrixData
        in
          assert'
            ( name <> ": MaxBars " <> show want <> " ≠ lowered RawBars " <> show got
                <> "\n  lowered = "
                <> lowered
            )
            (want == got)

-- | The full assist chain end to end: Handlebars --migrate--> MaxBars --lower-->
-- | RawBars must (a) lower without error — proving the migrator's output is
-- | actually lowerable — and (b) render identically to the original Handlebars.
-- | The per-tool suites only proved each hop in isolation; this proves the chain.
migrateThenLower :: String -> Value -> Effect Unit
migrateThenLower hbs dat = case migrateToMaxBars hbs of
  Left e -> assert' ("migrate→lower " <> show hbs <> ": migrate failed: " <> show e) false
  Right mres -> case lowerToRawBars mres.source of
    Left e -> assert'
      ( "migrate→lower " <> show hbs <> ": lower failed: " <> show e <> "\n  maxbars = " <>
          mres.source
      )
      false
    Right lowered ->
      assert'
        ( "migrate→lower " <> show hbs <> ": handlebars " <> show (renderSurface hbs dat)
            <> " ≠ lowered RawBars "
            <> show (RawBars.render lowered dat)
            <> "\n  maxbars = "
            <> mres.source
            <> "\n  rawbars = "
            <> lowered
        )
        (renderSurface hbs dat == RawBars.render lowered dat)

main :: Effect Unit
main = do
  log "Linter lower round-trip tests"

  -- Handlebars → Migrate → Lower → RawBars, render-equivalent to the original.
  let
    chainData = VObject $ Map.fromFoldable
      [ Tuple "items" (VArray [ VString "a", VString "b" ])
      , Tuple "flag" (VBool true)
      , Tuple "name" (VString "Zed")
      , Tuple "empty" (VArray [])
      ]
  migrateThenLower "{{#each items}}{{@index}}:{{this}}|{{/each}}" chainData
  migrateThenLower "{{#each items}}{{@first}}/{{@last}} {{/each}}" chainData
  migrateThenLower "{{^empty}}none{{/empty}}" chainData
  migrateThenLower "{{#if flag}}on{{else}}off{{/if}}" chainData
  migrateThenLower "{{&name}}" chainData
  migrateThenLower "{{#if flag}}x{{else if name}}y{{/if}}" chainData

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

  -- X1 — truthiness materialization. A non-`handlebars`-mode file is lowered by
  -- carrying its `@truthiness` directive forward; the lowered RawBars source must
  -- then render *identically* to the MaxBars interpreter. Each case below picks a
  -- mode + value whose branch DIFFERS from the handlebars default, so the test
  -- fails if the directive is ever dropped (the lowered file would default to
  -- handlebars and diverge).
  --   `minimal` (nil/ruby): 0, "", [], {} are all truthy (only false/null falsy).
  --   `mustache`:            [] is falsy but 0 and "" are truthy.
  rendersSame "minimal: 0 truthy" "minimal" "{{#if zero}}T{{else}}F{{/if}}"
  rendersSame "minimal: \"\" truthy" "minimal" "{{#if empty}}T{{else}}F{{/if}}"
  rendersSame "minimal: [] truthy" "minimal" "{{#if arr}}T{{else}}F{{/if}}"
  rendersSame "minimal: unless 0" "minimal" "{{#unless zero}}U{{else}}-{{/unless}}"
  rendersSame "minimal: && over 0" "minimal" "{{ zero && yes }}"
  rendersSame "nil alias: 0 truthy" "nil" "{{#if zero}}T{{else}}F{{/if}}"
  rendersSame "mustache: \"\" truthy" "mustache" "{{#if empty}}T{{else}}F{{/if}}"
  rendersSame "mustache: [] falsy" "mustache" "{{#if arr}}T{{else}}F{{/if}}"
  rendersSame "presence: 0 truthy, {} falsy" "presence"
    "{{#if zero}}{{#if ob}}A{{else}}B{{/if}}{{/if}}"
  rendersSame "explicit list (minimal shapes)" "false null"
    "{{#if zero}}T{{else}}F{{/if}}"

  -- source fidelity: header directives are carried verbatim into the lowering
  -- (an inert `@truthiness` is preserved like any other directive — ADR-022).
  lowersContaining "carries directives verbatim" "{{! @truthiness: minimal }}{{ a }}"
    "{{! @truthiness: minimal }}"

  -- Direct shape assertions on the printer.
  lowersContaining "and shape" "{{ a && b }}"
    "{{{ escapeHtml (and (lookup this \"a\") (lookup this \"b\")) }}}"
  lowersContaining "gt shape" "{{ a > b }}"
    "{{{ escapeHtml (gt (lookup this \"a\") (lookup this \"b\")) }}}"
  lowersContaining "pipe shape" "{{{ o | json }}}"
    "{{{ json (lookup this \"o\") }}}"
  lowersContaining "section shape" "{{#unless done}}x{{/unless}}"
    "{{#unless (lookup this \"done\")}}x{{/unless}}"

  log "Linter tests passed"

  -- X2 — Handlebars → MaxBars migrator.
  Migrate.main

  -- X3 — heuristic lift RawBars → MaxBars.
  Lift.main

  -- alias warnings (open decision 2: permanent + warn-on-demand).
  Aliases.main
