-- | MaxBars dialect tests (`spago test -p maxbars`): the infix-operator + pipe
-- | surface desugaring to FullBars/core, rendered through the reused engine, and
-- | a compile-shape check.
-- |
-- | v1 note: bare infix works in output expressions (`{{ a && b }}` /
-- | `{{{ … }}}`) and pipes; an infix *block condition* must be parenthesised
-- | (`{{#if (a && b)}}`), since the shared tree-builder reads a block head as a
-- | prefix application. Block-head-aware infix is a follow-up.
module Test.MaxBars.Main where

import Prelude

import BareBars.Value (Value(..))
import Data.Either (Either(..), isLeft)
import Data.Map as Map
import Data.String (Pattern(..), contains)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import MaxBars (compileMaxJs, renderMax)
import Test.Assert (assert')

obj :: Array (Tuple String Value) -> Value
obj = VObject <<< Map.fromFoldable

num :: Number -> Value
num = VNumber

-- | Assert MaxBars source renders to `expected` against `dat`.
expectM :: String -> String -> Value -> String -> Effect Unit
expectM name src dat expected = case renderMax src dat of
  Left err -> assert' (name <> ": unexpected error: " <> err) false
  Right out -> assert' (name <> ": expected " <> show expected <> " got " <> show out)
    (out == expected)

main :: Effect Unit
main = do
  log "MaxBars dialect tests"

  -- infix logic in output expressions (desugar to and/or/not).
  expectM "and-true" "{{ a && b }}" (obj [ Tuple "a" (VBool true), Tuple "b" (VBool true) ]) "true"
  expectM "and-false" "{{ a && b }}" (obj [ Tuple "a" (VBool true), Tuple "b" (VBool false) ])
    "false"
  expectM "or" "{{ a || b }}" (obj [ Tuple "a" (VBool false), Tuple "b" (VBool true) ]) "true"
  expectM "not" "{{ !a }}" (obj [ Tuple "a" (VBool false) ]) "true"

  -- comparisons.
  expectM "gt" "{{ x > 3 }}" (obj [ Tuple "x" (num 5.0) ]) "true"
  expectM "gte-eq" "{{ x >= 18 }}" (obj [ Tuple "x" (num 18.0) ]) "true"
  expectM "lt" "{{ x < 3 }}" (obj [ Tuple "x" (num 5.0) ]) "false"
  expectM "eq" "{{ x == 1 }}" (obj [ Tuple "x" (num 1.0) ]) "true"
  expectM "ne" "{{ x != 1 }}" (obj [ Tuple "x" (num 1.0) ]) "false"

  -- precedence: comparison binds tighter than &&.
  expectM "precedence" "{{ x > 0 && x < 10 }}" (obj [ Tuple "x" (num 5.0) ]) "true"

  -- pipes: `a | f` ⇒ (f a); the piped value is the first argument.
  expectM "pipe-json" "{{{ o | json }}}" (obj [ Tuple "o" (obj [ Tuple "a" (num 1.0) ]) ])
    "{\"a\":1}"
  expectM "pipe-arg" "{{{ xs | lookup 0 }}}"
    (obj [ Tuple "xs" (VArray [ VString "a", VString "b" ]) ])
    "a"
  -- pipe chain is left-assoc: not(not(0)) = false.
  expectM "pipe-chain" "{{{ n | not | not }}}" (obj [ Tuple "n" (num 0.0) ]) "false"

  -- parenthesised infix in a block condition (the v1 block form).
  expectM "if-paren-infix" "{{#if (a && b)}}Y{{else}}N{{/if}}"
    (obj [ Tuple "a" (VBool true), Tuple "b" (VBool false) ])
    "N"
  expectM "if-paren-comparison" "{{#if (x >= 18)}}adult{{else}}minor{{/if}}"
    (obj [ Tuple "x" (num 21.0) ])
    "adult"

  -- a plain path still works (FullBars surface reused unchanged).
  expectM "path" "{{ user.name }}" (obj [ Tuple "user" (obj [ Tuple "name" (VString "Ada") ]) ])
    "Ada"

  -- MaxBars also rejects the Handlebars-only shapes (not the Handlebars-compat
  -- dialect): inverse {{^}}, unescaped {{&}}, and raw blocks {{{{}}}}.
  assert' "reject: inverse {{^}}" (isLeft (renderMax "{{^a}}x{{/a}}" (obj [])))
  assert' "reject: unescaped {{&}}" (isLeft (renderMax "{{&a}}" (obj [])))
  assert' "reject: raw block {{{{}}}}" (isLeft (renderMax "{{{{r}}}}body{{{{/r}}}}" (obj [])))

  -- compilation reuses the FullBars compiler: && desugars to the `and` helper.
  case compileMaxJs "{{ a && b }}" of
    Left e -> assert' ("compile: unexpected error " <> show e) false
    Right js -> assert' ("compile: expected rt.call(\"and\" in\n" <> js)
      (contains (Pattern "rt.call(\"and\"") js)

  log "all MaxBars tests passed"
