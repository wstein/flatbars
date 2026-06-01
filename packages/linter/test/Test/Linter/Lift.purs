-- | **Test.Linter.Lift** — acceptance for the heuristic lift (X3, §B.3):
-- |
-- |  * **Render-equivalence oracle.** For a corpus of RawBars templates, the
-- |    re-sugared MaxBars source must render *identically* to the RawBars input
-- |    across a data matrix: `RawBars.render input d == renderMax (lift input) d`.
-- |    The re-sugar (operators, escaped/raw output, blocks, lookup→path, pipes)
-- |    is render-preserving; flags are advisory.
-- |  * **Round-trip with X0 (lower).** For MaxBars sources, lifting the lowered
-- |    RawBars undoes the lower, render-identically:
-- |    `renderMax src == renderMax (lift (lower src))`.
-- |  * **Flag assertions.** `(lookup this "x")` ⇒ `x` + a `lookup-path` flag; a
-- |    multi-arg call is left as a call + a `multi-arg-call` flag; an unrecognised
-- |    arity-1 helper is left as a call + an `unrecognised-filter` flag; every flag
-- |    has a non-empty message.
-- |  * **Direct shape checks** for the operator table.
module Test.Linter.Lift (main) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), contains)
import Data.String as String
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Value (Value(..))
import Linter.Lift (liftToMaxBars)
import Linter.Lower (lowerToRawBars)
import MaxBars (renderMax)
import RawBars as RawBars
import Test.Assert (assert')

--------------------------------------------------------------------------------
-- Data matrix
--------------------------------------------------------------------------------

-- | A small matrix of data shapes the corpus probes against: objects with
-- | numbers, strings, booleans, lists, and nesting.
matrix :: Array Value
matrix =
  [ obj
      [ Tuple "a" (VString "A")
      , Tuple "b" (VNumber 30.0)
      , Tuple "done" (VBool true)
      , Tuple "o" (obj [ Tuple "k" (VNumber 1.0) ])
      , Tuple "xs" (VArray [ VString "p", VString "q", VString "r" ])
      , Tuple "user" (obj [ Tuple "name" (VString "Ada") ])
      ]
  , obj
      [ Tuple "a" (VString "<b>")
      , Tuple "b" (VNumber 10.0)
      , Tuple "done" (VBool false)
      , Tuple "o" (VArray [ VNumber 9.0 ])
      , Tuple "xs" (VArray [])
      , Tuple "user" (obj [ Tuple "name" (VString "Bo & Co") ])
      ]
  , obj
      [ Tuple "a" VNull
      , Tuple "b" (VNumber 21.0)
      , Tuple "done" (VBool true)
      , Tuple "xs" (VArray [ VString "x" ])
      ]
  ]
  where
  obj = VObject <<< Map.fromFoldable

--------------------------------------------------------------------------------
-- Oracle 1 — render-equivalence: RawBars input ≡ lifted MaxBars
--------------------------------------------------------------------------------

-- | The RawBars test corpus: explicit core syntax exercising every re-sugar path
-- | — paths, escaped/raw output, the operator table (with nested parens), unary
-- | filters, multi-arg calls, sections, separators, loop vars, and nesting.
corpus :: Array (Tuple String String)
corpus =
  [ Tuple "plain text" "hello world"
  , Tuple "escaped path" "{{{ escapeHtml (lookup this \"a\") }}}"
  , Tuple "raw path" "{{{ lookup this \"a\" }}}"
  , Tuple "and" "{{{ escapeHtml (and (lookup this \"done\") (lookup this \"done\")) }}}"
  , Tuple "gt" "{{{ escapeHtml (gt (lookup this \"b\") 21) }}}"
  , Tuple "nested and/gt" "{{{ and (lookup this \"done\") (gt (lookup this \"b\") 21) }}}"
  , Tuple "not" "{{{ not (lookup this \"done\") }}}"
  , Tuple "eq" "{{{ eq (lookup this \"a\") \"A\" }}}"
  , Tuple "or with not" "{{{ or (not (lookup this \"done\")) (lt (lookup this \"b\") 5) }}}"
  , Tuple "unary filter json" "{{{ json (lookup this \"o\") }}}"
  , Tuple "unary filter escapeJson" "{{{ escapeJson (lookup this \"o\") }}}"
  , Tuple "filter over op"
      "{{{ json (and (lookup this \"done\") (gt (lookup this \"b\") 21)) }}}"
  , Tuple "multi-arg lookup" "{{{ lookup (lookup this \"xs\") 0 }}}"
  , Tuple "if section" "{{#if (gt (lookup this \"b\") 21)}}big{{else}}small{{/if}}"
  , Tuple "unless section" "{{#unless (lookup this \"done\")}}todo{{/unless}}"
  , Tuple "each loop vars"
      "{{#each (lookup this \"xs\")}}[{{{index1}}}/{{{ escapeHtml this }}}]{{/each}}"
  , Tuple "each with infix cond"
      "{{#each (lookup this \"xs\")}}{{#if (gt index0 0)}}, {{/if}}{{{ escapeHtml this }}}{{/each}}"
  , Tuple "if elif else"
      "{{#if (gt (lookup this \"b\") 25)}}big{{elif (gt (lookup this \"b\") 15)}}mid{{else}}small{{/if}}"
  , Tuple "nested path output" "{{{ escapeHtml (lookup this \"user\" \"name\") }}}"
  -- arithmetic + coalesce re-sugar (the new operator table rows).
  , Tuple "add" "{{{ add (lookup this \"b\") 1 }}}"
  , Tuple "nested arith" "{{{ add (multiply (lookup this \"b\") 2) 1 }}}"
  , Tuple "modulo" "{{{ modulo (lookup this \"b\") 7 }}}"
  , Tuple "coalesce" "{{{ coalesce (lookup this \"a\") \"fb\" }}}"
  -- value-primitive unary filters re-sugar to pipes (derived from the prelude).
  , Tuple "uppercase filter" "{{{ uppercase (lookup this \"a\") }}}"
  , Tuple "abs filter" "{{{ abs (lookup this \"b\") }}}"
  , Tuple "filter chain" "{{{ uppercase (trim (lookup this \"a\")) }}}"
  ]

-- | Assert render-equivalence across the matrix for one RawBars template.
rendersSame :: String -> String -> Effect Unit
rendersSame name input = case liftToMaxBars input of
  Left e -> assert' (name <> ": lift failed: " <> show e) false
  Right { source } ->
    Array.foldMap
      ( \d ->
          let
            want = RawBars.render input d
            got = renderMax source d
          in
            assert'
              ( name <> ": RawBars " <> show want <> " ≠ lifted MaxBars " <> show got
                  <> "\n  lifted = "
                  <> source
              )
              (want == got)
      )
      matrix

--------------------------------------------------------------------------------
-- Oracle 2 — round-trip with X0 lower
--------------------------------------------------------------------------------

-- | MaxBars sources whose lower→lift round-trip must render identically.
maxCorpus :: Array (Tuple String String)
maxCorpus =
  [ Tuple "interp" "{{ a }}"
  , Tuple "dotted" "{{ user.name }}"
  , Tuple "raw" "{{{ a }}}"
  , Tuple "infix and" "{{ done && done }}"
  , Tuple "infix gt" "{{ b > 21 }}"
  , Tuple "not" "{{ !done }}"
  , Tuple "pipe" "{{ o | json }}"
  , Tuple "nested op" "{{ done && (b > 21) }}"
  , Tuple "if/else" "{{#if b > 21}}big{{else}}small{{/if}}"
  , Tuple "unless" "{{#unless done}}todo{{/unless}}"
  , Tuple "each" "{{#each xs}}[{{index1}}/{{this}}]{{/each}}"
  , Tuple "each cond" "{{#each xs}}{{#if index0 > 0}}, {{/if}}{{this}}{{/each}}"
  , Tuple "mixed" "Hi {{ user.name | escapeHtml }}!{{#each xs}} {{index1}}={{this}}{{/each}}"
  -- arithmetic + `??` round-trip (lower desugars to helpers, lift re-sugars back).
  , Tuple "arith" "{{ b + 1 }}"
  , Tuple "arith precedence" "{{ b * 2 + 1 }}"
  , Tuple "coalesce" "{{ a ?? b }}"
  ]

-- | Assert `renderMax src == renderMax (lift (lower src))` across the matrix.
roundTripsWithLower :: String -> String -> Effect Unit
roundTripsWithLower name src = case lowerToRawBars src of
  Left e -> assert' (name <> ": lower failed: " <> show e) false
  Right lowered -> case liftToMaxBars lowered of
    Left e -> assert' (name <> ": lift failed: " <> show e) false
    Right { source } ->
      Array.foldMap
        ( \d ->
            let
              want = renderMax src d
              got = renderMax source d
            in
              assert'
                ( name <> ": renderMax src " <> show want <> " ≠ lift∘lower " <> show got
                    <> "\n  lowered = "
                    <> lowered
                    <> "\n  lifted  = "
                    <> source
                )
                (want == got)
        )
        matrix

--------------------------------------------------------------------------------
-- Oracle 3 — flag assertions
--------------------------------------------------------------------------------

-- | Assert lifting `input` succeeds, the source contains `needle`, and a flag of
-- | `kind` is present with a non-empty message.
liftsWithFlag :: String -> String -> String -> String -> Effect Unit
liftsWithFlag name input needle kind = case liftToMaxBars input of
  Left e -> assert' (name <> ": lift failed: " <> show e) false
  Right { source, flags } -> do
    assert' (name <> ": expected " <> show source <> " to contain " <> show needle)
      (contains (Pattern needle) source)
    case Array.find (\f -> f.kind == kind) flags of
      Nothing -> assert'
        (name <> ": expected a `" <> kind <> "` flag; got " <> show (map _.kind flags))
        false
      Just f -> assert' (name <> ": `" <> kind <> "` flag has empty message")
        (String.length f.message > 0)

-- | Assert lifting `input` produces source containing `needle` (shape check).
liftsContaining :: String -> String -> String -> Effect Unit
liftsContaining name input needle = case liftToMaxBars input of
  Left e -> assert' (name <> ": lift failed: " <> show e) false
  Right { source } -> assert'
    (name <> ": expected " <> show source <> " to contain " <> show needle)
    (contains (Pattern needle) source)

-- | Assert every flag raised for `input` has a non-empty message and span.
allFlagsWellFormed :: String -> String -> Effect Unit
allFlagsWellFormed name input = case liftToMaxBars input of
  Left e -> assert' (name <> ": lift failed: " <> show e) false
  Right { flags } ->
    Array.foldMap
      ( \f -> do
          assert' (name <> ": flag `" <> f.kind <> "` has empty message")
            (String.length f.message > 0)
          assert' (name <> ": flag `" <> f.kind <> "` has bad span") (f.span.end >= f.span.start)
      )
      flags

main :: Effect Unit
main = do
  log "Linter lift (X3) tests"

  -- Oracle 1 — render-equivalence over the RawBars corpus.
  Array.foldMap (\(Tuple n s) -> rendersSame n s) corpus

  -- Oracle 2 — round-trip with X0 lower (lift undoes lower, render-identically).
  Array.foldMap (\(Tuple n s) -> roundTripsWithLower n s) maxCorpus

  -- Oracle 3 — flag + shape assertions.
  liftsWithFlag "lookup→path flag" "{{{ lookup this \"x\" }}}" "x" "lookup-path"
  liftsWithFlag "multi-arg call flag" "{{{ lookup (lookup this \"xs\") 0 }}}"
    "(lookup"
    "multi-arg-call"
  liftsWithFlag "unrecognised filter flag" "{{{ frobnicate (lookup this \"a\") }}}"
    "(frobnicate"
    "unrecognised-filter"

  -- arithmetic + coalesce re-sugar shapes.
  liftsContaining "add → +" "{{{ add (lookup this \"b\") 1 }}}" "b + 1"
  liftsContaining "multiply → *" "{{{ multiply (lookup this \"b\") 2 }}}" "b * 2"
  liftsContaining "modulo → %" "{{{ modulo (lookup this \"b\") 7 }}}" "b % 7"
  liftsContaining "coalesce → ??" "{{{ coalesce (lookup this \"a\") \"fb\" }}}" "a ?? \"fb\""
  -- nested arithmetic parenthesises the infix operand.
  liftsContaining "nested arith parens" "{{{ add (multiply (lookup this \"b\") 2) 1 }}}"
    "(b * 2) + 1"

  -- `(and a (gt b 21))` lifts to source containing `a && (b > 21)` (inner gt
  -- parenthesised) — the headline acceptance example.
  liftsContaining "and/gt parenthesisation"
    "{{{ and (lookup this \"a\") (gt (lookup this \"b\") 21) }}}"
    "a && (b > 21)"

  -- Direct operator-table shape checks.
  liftsContaining "and op" "{{{ and (lookup this \"a\") (lookup this \"b\") }}}" "a && b"
  liftsContaining "gt op" "{{{ gt (lookup this \"a\") (lookup this \"b\") }}}" "a > b"
  liftsContaining "not op" "{{{ not (lookup this \"a\") }}}" "!a"
  liftsContaining "escaped output" "{{{ escapeHtml (lookup this \"x\") }}}" "{{ x }}"
  liftsContaining "pipe filter" "{{{ json (lookup this \"o\") }}}" "o | json"
  -- handlebars-helpers aliases normalise to the canonical operator on lift.
  liftsContaining "plus alias → +" "{{{ plus (lookup this \"a\") 1 }}}" "a + 1"
  liftsContaining "times alias → *" "{{{ times (lookup this \"a\") 2 }}}" "a * 2"
  -- value-primitive unary helpers re-sugar to pipes (derived from the prelude).
  liftsContaining "uppercase → pipe" "{{{ uppercase (lookup this \"a\") }}}" "a | uppercase"
  liftsContaining "abs → pipe" "{{{ abs (lookup this \"b\") }}}" "b | abs"
  liftsContaining "unique → pipe" "{{{ unique (lookup this \"xs\") }}}" "xs | unique"
  liftsContaining "filter chain → pipes" "{{{ uppercase (trim (lookup this \"a\")) }}}"
    "(a | trim) | uppercase"
  -- an unknown arity-1 helper is still left as a call + flagged.
  liftsWithFlag "unknown still flagged" "{{{ frobnicate (lookup this \"a\") }}}"
    "(frobnicate"
    "unrecognised-filter"

  -- Every flag is well-formed (non-empty message, sane span).
  allFlagsWellFormed "well-formed flags"
    "{{{ lookup this \"x\" }}}{{{ lookup (lookup this \"xs\") 0 }}}{{{ frob (lookup this \"a\") }}}"

  log "Linter lift (X3) tests passed"
