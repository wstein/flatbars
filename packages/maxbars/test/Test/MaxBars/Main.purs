-- | MaxBars dialect tests (`spago test -p maxbars`): the infix-operator + pipe
-- | surface desugaring to FullBars/core, rendered through the reused engine, and
-- | a compile-shape check.
-- |
-- | Infix works in output expressions (`{{ a && b }}` / `{{{ … }}}`), pipes, and
-- | — via the core `parseHead` seam — bare block conditions (`{{#if a && b}}`) and
-- | `as |x|` block params (the head ladder omits the pipe rung, so a bar there is
-- | structural). Clause separators (`{{elif …}}` / `{{else if …}}`) still take a
-- | parenthesised condition; a pipe in a block head must also be parenthesised.
module Test.MaxBars.Main where

import Prelude

import Data.Array as Array
import Data.Either (Either(..), isLeft)
import Data.Map as Map
import Data.String (Pattern(..), contains)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Value (Value(..))
import MaxBars (compileMaxJs, loopVarWarnings, renderMax)
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

  -- arithmetic operators (desugar to add/subtract/multiply/divide/modulo).
  expectM "arith-add" "{{ a + b }}" (obj [ Tuple "a" (num 2.0), Tuple "b" (num 3.0) ]) "5"
  expectM "arith-sub" "{{ a - b }}" (obj [ Tuple "a" (num 7.0), Tuple "b" (num 4.0) ]) "3"
  expectM "arith-mul" "{{ a * b }}" (obj [ Tuple "a" (num 6.0), Tuple "b" (num 7.0) ]) "42"
  expectM "arith-div" "{{ a / b }}" (obj [ Tuple "a" (num 9.0), Tuple "b" (num 2.0) ]) "4.5"
  expectM "arith-mod" "{{ a % b }}" (obj [ Tuple "a" (num 17.0), Tuple "b" (num 5.0) ]) "2"
  -- precedence: `*` binds tighter than `+`; comparison looser than both.
  expectM "arith-precedence" "{{ a + b * c }}"
    (obj [ Tuple "a" (num 2.0), Tuple "b" (num 3.0), Tuple "c" (num 4.0) ])
    "14"
  expectM "arith-parens" "{{ (a + b) * c }}"
    (obj [ Tuple "a" (num 2.0), Tuple "b" (num 3.0), Tuple "c" (num 4.0) ])
    "20"
  expectM "arith-in-cmp" "{{#if n + 1 > 5}}big{{else}}small{{/if}}" (obj [ Tuple "n" (num 5.0) ])
    "big"
  -- a dotted path operand stays a path; `*` is unambiguously multiply.
  expectM "arith-path" "{{ price.net * qty }}"
    (obj [ Tuple "price" (obj [ Tuple "net" (num 10.0) ]), Tuple "qty" (num 3.0) ])
    "30"

  -- null-coalescing `??` (desugars to coalesce): first non-null, NOT truthiness.
  expectM "coalesce-null" "{{ a ?? b }}" (obj [ Tuple "a" VNull, Tuple "b" (VString "fb") ]) "fb"
  expectM "coalesce-zero" "{{ a ?? b }}" (obj [ Tuple "a" (num 0.0), Tuple "b" (VString "fb") ]) "0"
  expectM "coalesce-chain" "{{ a ?? b ?? \"x\" }}" (obj [ Tuple "a" VNull, Tuple "b" VNull ]) "x"
  expectM "coalesce-path" "{{ user.nick ?? user.name }}"
    (obj [ Tuple "user" (obj [ Tuple "name" (VString "Ada") ]) ])
    "Ada"

  -- compiled path: `+` desugars to the `add` helper call.
  case compileMaxJs "{{ a + b }}" of
    Left e -> assert' ("compile arith: unexpected error " <> show e) false
    Right js -> assert' ("compile arith: expected rt.call(\"add\" in\n" <> js)
      (contains (Pattern "rt.call(\"add\"") js)
  -- compiled path: `??` desugars to the `coalesce` helper call.
  case compileMaxJs "{{ a ?? b }}" of
    Left e -> assert' ("compile coalesce: unexpected error " <> show e) false
    Right js -> assert' ("compile coalesce: expected rt.call(\"coalesce\" in\n" <> js)
      (contains (Pattern "rt.call(\"coalesce\"") js)

  -- `elif` honours an `includeZero=true` options hash, like the head `if`: a
  -- bare 0 is falsy normally, truthy with the flag (so the elif fires).
  expectM "elif-includeZero-pass"
    "{{#if score >= 100}}<b>pass</b>{{elif 0 includeZero=true}}<b>fail</b>{{/if}}"
    (obj [ Tuple "score" (num 150.0) ])
    "<b>pass</b>"
  expectM "elif-includeZero-fire"
    "{{#if score >= 100}}<b>pass</b>{{elif 0 includeZero=true}}<b>fail</b>{{/if}}"
    (obj [ Tuple "score" (num 50.0) ])
    "<b>fail</b>"
  -- without the flag, the bare-0 elif is falsy → falls through (empty here).
  expectM "elif-no-includeZero" "{{#if score >= 100}}P{{elif 0}}Z{{/if}}"
    (obj [ Tuple "score" (num 50.0) ])
    ""
  -- the hash works on a data-driven elif condition + an else fallback too.
  expectM "elif-includeZero-data" "{{#if a}}A{{elif n includeZero=true}}Z{{else}}E{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "n" (num 0.0) ])
    "Z"

  -- parenthesised infix in a block condition.
  expectM "if-paren-infix" "{{#if (a && b)}}Y{{else}}N{{/if}}"
    (obj [ Tuple "a" (VBool true), Tuple "b" (VBool false) ])
    "N"
  expectM "if-paren-comparison" "{{#if (x >= 18)}}adult{{else}}minor{{/if}}"
    (obj [ Tuple "x" (num 21.0) ])
    "adult"
  -- bare (un-parenthesised) infix block conditions, via the `parseHead` seam.
  expectM "if-bare-infix" "{{#if a && b}}Y{{else}}N{{/if}}"
    (obj [ Tuple "a" (VBool true), Tuple "b" (VBool false) ])
    "N"
  expectM "if-bare-comparison" "{{#if x >= 18}}adult{{else}}minor{{/if}}"
    (obj [ Tuple "x" (num 21.0) ])
    "adult"
  expectM "unless-bare-infix" "{{#unless a || b}}none{{/unless}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool false) ])
    "none"
  expectM "if-bare-precedence" "{{#if x > 0 && x < 10}}in{{else}}out{{/if}}"
    (obj [ Tuple "x" (num 5.0) ])
    "in"
  -- a block head with a single subject still works (each over a bare path).
  expectM "each-bare-subject" "{{#each xs}}{{this}}{{/each}}"
    (obj [ Tuple "xs" (VArray [ VString "a", VString "b" ]) ])
    "ab"

  -- a plain path still works (FullBars surface reused unchanged).
  expectM "path" "{{ user.name }}" (obj [ Tuple "user" (obj [ Tuple "name" (VString "Ada") ]) ])
    "Ada"

  -- bare loop variables (MaxBars-only): index0/index1/rindex0/rindex1/length.
  let xs3 = obj [ Tuple "xs" (VArray [ VString "a", VString "b", VString "c" ]) ]
  expectM "loopvars-all"
    "{{#each xs}}[{{index0}}/{{index1}}/{{rindex0}}/{{rindex1}}/{{length}}]{{/each}}"
    xs3
    "[0/1/2/3/3][1/2/1/2/3][2/3/0/1/3]"
  -- aliases: index⇒index0, rindex⇒rindex0, size⇒length.
  expectM "loopvars-aliases" "{{#each xs}}{{index}}{{rindex}}{{size}}{{/each}}" xs3 "023113203"
  -- first/last as bare names.
  expectM "loopvars-first" "{{#each xs}}{{#if first}}F{{else}}-{{/if}}{{/each}}" xs3 "F--"
  expectM "loopvars-last" "{{#each xs}}{{#if last}}L{{else}}-{{/if}}{{/each}}" xs3 "--L"
  -- object iteration exposes the bare `key`; array iteration's `key` is null
  -- (Handlebars parity — use index0 for the array position).
  expectM "loopvars-key" "{{#each o}}{{key}}{{/each}}"
    (obj [ Tuple "o" (obj [ Tuple "x" (num 1.0), Tuple "y" (num 2.0) ]) ])
    "xy"
  expectM "loopvars-key-array-null" "{{#each xs}}[{{key}}]{{/each}}" xs3 "[][][]"
  -- the escape hatch: `{{this.first}}` reads the *data field* `first`, not the
  -- loop variable (a path is never loop-var-resolved — only a whole bare name).
  expectM "loopvar-escape-this-dot" "{{#each xs}}{{this.first}}{{/each}}"
    (obj [ Tuple "xs" (VArray [ obj [ Tuple "first" (VString "D") ] ]) ])
    "D"
  -- block params (`as |a b|`): the head ladder omits the pipe rung, so the bars
  -- are structure the surface desugar strips. `each` binds element + index.
  expectM "blockparams-each" "{{#each xs as |item i|}}[{{i}}:{{item}}]{{/each}}" xs3
    "[0:a][1:b][2:c]"
  -- `with` binds the shifted context to a name.
  expectM "blockparams-with" "{{#with o as |c|}}{{c.n}}{{/with}}"
    (obj [ Tuple "o" (obj [ Tuple "n" (VString "Z") ]) ])
    "Z"
  -- a block param shadows a loop variable: `as |index0|` binds the *element*, not
  -- the loop index (the surface `pathExpr` checks scope before loop vars).
  expectM "blockparams-shadow-loopvar" "{{#each xs as |index0|}}{{index0}}{{/each}}" xs3 "abc"
  -- outer block param stays in scope inside a nested block.
  expectM "blockparams-nested"
    "{{#each rows as |row|}}{{#each row.cells}}{{row.id}}{{this}} {{/each}}{{/each}}"
    ( obj
        [ Tuple "rows"
            ( VArray
                [ obj
                    [ Tuple "id" (VString "A")
                    , Tuple "cells" (VArray [ VString "1", VString "2" ])
                    ]
                ]
            )
        ]
    )
    "A1 A2 "
  -- a pipe in a block head must be parenthesised; `(xs | f)` re-enters the full
  -- ladder, and a trailing `as |x|` still binds. Here `(xs | reverse)` pipes.
  expectM "blockparams-paren-pipe" "{{#each (xs | reverse) as |x|}}{{x}}{{/each}}" xs3 "cba"

  -- compiled path names the loop variable as a scoped helper call.
  case compileMaxJs "{{#each xs}}{{index1}}{{/each}}" of
    Left e -> assert' ("compile loopvar: unexpected error " <> show e) false
    Right js -> assert' ("compile loopvar: expected rt.call(\"index1\" in\n" <> js)
      (contains (Pattern "rt.call(\"index1\"") js)

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

  -- loop-var shadow lint (ADR-006 warn-always tier): a bare shadow-prone loop
  -- variable warns; an unambiguous one and an explicit `this.` path do not.
  let
    warnNames src = case loopVarWarnings src of
      Left _ -> [ "<parse error>" ]
      Right is -> map _.name is
  assert' "shadow-warn: bare {{first}} warns"
    (warnNames "{{#each xs}}{{first}}{{/each}}" == [ "first" ])
  assert' "shadow-warn: {{length}}+{{key}} both warn"
    (warnNames "{{#each xs}}{{length}}{{key}}{{/each}}" == [ "length", "key" ])
  assert' "shadow-warn: {{index0}} (unambiguous) does not warn"
    (Array.null (warnNames "{{#each xs}}{{index0}}{{/each}}"))
  assert' "shadow-warn: {{this.first}} (explicit data path) does not warn"
    (Array.null (warnNames "{{#each xs}}{{this.first}}{{/each}}"))
  -- warn-always: it fires with no schema and even outside a loop (the name is a
  -- loop variable wherever it appears bare).
  assert' "shadow-warn: fires with no loop/schema" (warnNames "{{first}}" == [ "first" ])

  -- ── Set delimiters (ADR-015): MaxBars enables `mustacheDelims` ─────────────
  expectM "set-delim: inline switch" "{{=<% %>=}}<%name%>"
    (obj [ Tuple "name" (VString "Ada") ])
    "Ada"
  expectM "set-delim: @delimiters directive" "{{! @delimiters: <% %> }}<%name%>"
    (obj [ Tuple "name" (VString "Ada") ])
    "Ada"
  expectM "set-delim: switch back to default" "{{=<% %>=}}<%={{ }}=%>{{name}}"
    (obj [ Tuple "name" (VString "Ada") ])
    "Ada"

  log "all MaxBars tests passed"
