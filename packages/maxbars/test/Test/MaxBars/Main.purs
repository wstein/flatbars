-- | MaxBars dialect tests (`spago test -p maxbars`): the infix-operator + pipe
-- | surface desugaring to FullBars/core, rendered through the reused engine, and
-- | a compile-shape check.
-- |
-- | Infix works in output expressions (`{{ a && b }}` / `{{{ … }}}`), pipes, and
-- | — via the core `parseHead` seam — bare block conditions (`{{#if a && b}}`) and
-- | drop-pipes block params (`as a b c`: element, index, 1-based index — the head
-- | ladder omits the pipe rung and MaxBars rejects a head bar, so the Handlebars
-- | `as |x|` form is a parse error here). Clause separators (`{{elif …}}` /
-- | `{{else if …}}`) still take a parenthesised condition; a pipe in a block head
-- | must also be parenthesised.
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
import MaxBars (compileMaxJs, maxbarsWarnings, renderMax)
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
  -- MaxBars uses the `nonEmpty` rule: 0 is truthy, so not·not 0 = true.
  expectM "pipe-chain" "{{{ n | not | not }}}" (obj [ Tuple "n" (num 0.0) ]) "true"

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

  -- the ternary `cond ? a : b` (desugars to `ternary`): an inline conditional
  -- picking a/b by the engine's truthiness rule.
  expectM "ternary-true" "{{ ok ? yes : no }}"
    (obj [ Tuple "ok" (VBool true), Tuple "yes" (VString "Y"), Tuple "no" (VString "N") ])
    "Y"
  expectM "ternary-false" "{{ ok ? yes : no }}"
    (obj [ Tuple "ok" (VBool false), Tuple "yes" (VString "Y"), Tuple "no" (VString "N") ])
    "N"
  -- the condition is a full expression: comparison binds tighter than `?`.
  expectM "ternary-cmp" "{{ n > 3 ? \"big\" : \"small\" }}" (obj [ Tuple "n" (num 5.0) ]) "big"
  -- right-associative: a ? b : c ? d : e parses as a ? b : (c ? d : e).
  expectM "ternary-chain" "{{ a ? \"A\" : b ? \"B\" : \"none\" }}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool true) ])
    "B"
  -- "" is falsy under MaxBars' nonEmpty rule, so the false branch is taken.
  expectM "ternary-empty-cond" "{{ s ? s : \"fallback\" }}" (obj [ Tuple "s" (VString "") ])
    "fallback"
  -- a missing `:` is a parse error.
  assert' "reject: ternary without ':'" (isLeft (renderMax "{{ a ? b }}" (obj [])))
  -- compiled path: `? :` desugars to the `ternary` helper call.
  case compileMaxJs "{{ c ? a : b }}" of
    Left e -> assert' ("compile ternary: unexpected error " <> show e) false
    Right js -> assert' ("compile ternary: expected rt.call(\"ternary\" in\n" <> js)
      (contains (Pattern "rt.call(\"ternary\"") js)

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
  -- under MaxBars' `nonEmpty` rule a bare 0 is truthy, so the elif fires even
  -- without the flag (`includeZero` is a no-op here — 0 is already truthy). An
  -- empty string, by contrast, IS falsy under nonEmpty → falls through.
  expectM "elif-bare-0-fires" "{{#if score >= 100}}P{{elif 0}}Z{{/if}}"
    (obj [ Tuple "score" (num 50.0) ])
    "Z"
  expectM "elif-empty-string-falls-through" "{{#if score >= 100}}P{{elif s}}Z{{/if}}"
    (obj [ Tuple "score" (num 50.0), Tuple "s" (VString "") ])
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

  -- loop variables through the `loop` object (ADR-021): index0/index1/rindex0/
  -- rindex1/length.
  let xs3 = obj [ Tuple "xs" (VArray [ VString "a", VString "b", VString "c" ]) ]
  expectM "loopvars-all"
    "{{#each xs}}[{{loop.index0}}/{{loop.index1}}/{{loop.rindex0}}/{{loop.rindex1}}/{{loop.length}}]{{/each}}"
    xs3
    "[0/1/2/3/3][1/2/1/2/3][2/3/0/1/3]"
  -- first/last via the loop object.
  expectM "loopvars-first" "{{#each xs}}{{#if loop.first}}F{{else}}-{{/if}}{{/each}}" xs3 "F--"
  expectM "loopvars-last" "{{#each xs}}{{#if loop.last}}L{{else}}-{{/if}}{{/each}}" xs3 "--L"
  -- object iteration exposes `loop.key`; array iteration's key is null
  -- (Handlebars parity — use loop.index0 for the array position).
  expectM "loopvars-key" "{{#each o}}{{loop.key}}{{/each}}"
    (obj [ Tuple "o" (obj [ Tuple "x" (num 1.0), Tuple "y" (num 2.0) ]) ])
    "xy"
  expectM "loopvars-key-array-null" "{{#each xs}}[{{loop.key}}]{{/each}}" xs3 "[][][]"
  -- a data field named `first` is read with an explicit path; `loop.first` is the
  -- loop variable (the names never collide — one is `loop.`-namespaced).
  expectM "loopvar-data-field" "{{#each xs}}{{this.first}}{{/each}}"
    (obj [ Tuple "xs" (VArray [ obj [ Tuple "first" (VString "D") ] ]) ])
    "D"
  -- block params drop the pipes (`as a b`): the bare identifiers after `as` are
  -- the binding names. `each` binds element + 0-based index (+ a 1-based index).
  expectM "blockparams-each" "{{#each xs as item i}}[{{i}}:{{item}}]{{/each}}" xs3
    "[0:a][1:b][2:c]"
  -- `with` binds the shifted context to a name.
  expectM "blockparams-with" "{{#with o as c}}{{c.n}}{{/with}}"
    (obj [ Tuple "o" (obj [ Tuple "n" (VString "Z") ]) ])
    "Z"
  -- a block param binds a bare name directly (there are no bare loop variables in
  -- ADR-021, so nothing to shadow): `as x` binds the element.
  expectM "blockparams-bind" "{{#each xs as x}}{{x}}{{/each}}" xs3 "abc"
  -- outer block param stays in scope inside a nested block.
  expectM "blockparams-nested"
    "{{#each rows as row}}{{#each row.cells}}{{row.id}}{{this}} {{/each}}{{/each}}"
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
  -- ladder, and a trailing `as x` still binds. Here `(xs | reverse)` pipes.
  expectM "blockparams-paren-pipe" "{{#each (xs | reverse) as x}}{{x}}{{/each}}" xs3 "cba"

  -- labelled loops (ADR-013): `label NAME` binds the loop frame as an object, so
  -- an inner body reads `NAME.index1`/`NAME.length`/`NAME.first`/… of THIS loop.
  expectM "label-fields"
    "{{#each xs label l}}{{l.index1}}/{{l.length}}{{#if l.first}}<{{/if}}{{#if l.last}}>{{/if}} {{/each}}"
    xs3
    "1/3< 2/3 3/3> "
  -- the point: an inner loop reaches the *outer* loop's metadata through the label.
  expectM "label-outer-from-inner"
    "{{#each rows as row label outer}}{{#each row}}{{outer.index0}}:{{this}} {{/each}}{{/each}}"
    (obj [ Tuple "rows" (VArray [ VArray [ VString "a", VString "b" ], VArray [ VString "c" ] ]) ])
    "0:a 0:b 1:c "
  -- the label's `this` is the element; `key` is the object key when iterating one.
  expectM "label-this-key" "{{#each o label l}}{{l.key}}={{l.this}} {{/each}}"
    (obj [ Tuple "o" (obj [ Tuple "a" (num 1.0), Tuple "b" (num 2.0) ]) ])
    "a=1 b=2 "

  -- compiled path reaches the loop variable through the `loop` object (ADR-021).
  case compileMaxJs "{{#each xs}}{{loop.index1}}{{/each}}" of
    Left e -> assert' ("compile loopvar: unexpected error " <> show e) false
    Right js -> assert' ("compile loopvar: expected rt.call(\"loop\" in\n" <> js)
      (contains (Pattern "rt.call(\"loop\"") js)

  -- MaxBars also rejects the Handlebars-only shapes (not the Handlebars-compat
  -- dialect): inverse {{^}}, unescaped {{&}}, and raw blocks {{{{}}}}.
  assert' "reject: inverse {{^}}" (isLeft (renderMax "{{^a}}x{{/a}}" (obj [])))
  assert' "reject: unescaped {{&}}" (isLeft (renderMax "{{&a}}" (obj [])))
  assert' "reject: raw block {{{{}}}}" (isLeft (renderMax "{{{{r}}}}body{{{{/r}}}}" (obj [])))

  -- block-partial yield: the reserved `{{yield}}` (the `partial-block` synonym)
  -- renders the caller's block body. It is `{{ }}`-escaped by MaxBars' rule but
  -- the body is a `VSafe` value, so escapeHtml is the identity — no double-escape.
  expectM "yield"
    "{{#inline \"layout\"}}<{{yield}}>{{/inline}}{{#partial \"layout\"}}HI{{/partial}}"
    (obj [])
    "<HI>"
  -- the Handlebars `@partial-block` spelling is rejected (MaxBars reserves `@`); the
  -- hyphenated bare `partial-block` is `partial - block` (subtraction), not a name.
  assert' "reject: @partial-block (reserved @ sigil)"
    (isLeft (renderMax "{{> @partial-block}}" (obj [])))
  -- a data field named `yield` is shadowed by the reserved name everywhere (like
  -- loop/root/parent — even `{{this.yield}}` resolves the reserved name, since the
  -- path reduces to the segment `yield`). The escape hatch is an explicit lookup.
  expectM "yield-field-escape-hatch"
    "{{lookup this \"yield\"}}"
    (obj [ Tuple "yield" (VString "5%") ])
    "5%"

  -- compilation reuses the FullBars compiler: && desugars to the `and` helper.
  case compileMaxJs "{{ a && b }}" of
    Left e -> assert' ("compile: unexpected error " <> show e) false
    Right js -> assert' ("compile: expected rt.call(\"and\" in\n" <> js)
      (contains (Pattern "rt.call(\"and\"") js)

  -- there are no bare loop variables (ADR-021): a bare {{first}}/{{length}} is an
  -- ordinary data field, so it does NOT warn (the old shadow lint is retired).
  let
    warnNames src = case maxbarsWarnings src of
      Left _ -> [ "<parse error>" ]
      Right is -> map _.name is
  assert' "no-shadow-warn: bare {{first}} is a data field, no warning"
    (Array.null (warnNames "{{#each xs}}{{first}}{{length}}{{key}}{{/each}}"))

  -- block params drop the pipes (ADR-021 amendment): a bar in a block head is a
  -- parse error — whether the author meant the old `as |…|` delimiter or an
  -- unparenthesised pipe. The parenthesised pipe is still a pipe.
  assert' "head-bar: {{#each xs | reverse}} is a parse error (parenthesise to pipe)"
    ( isLeft
        ( renderMax "{{#each xs | reverse}}{{this}}{{/each}}"
            (obj [ Tuple "xs" (VArray [ VString "a" ]) ])
        )
    )
  assert' "head-bar: the Handlebars {{#each xs as |x|}} pipe form is rejected"
    ( isLeft
        ( renderMax "{{#each xs as |x|}}{{x}}{{/each}}"
            (obj [ Tuple "xs" (VArray [ VString "a" ]) ])
        )
    )
  expectM "head-bar: {{#each (xs | reverse)}} (parenthesised) is a real pipe"
    "{{#each (xs | reverse)}}{{this}}{{/each}}"
    (obj [ Tuple "xs" (VArray [ VString "a", VString "b" ]) ])
    "ba"

  -- drop-pipes block params bind a *third* name to the 1-based index — MaxBars'
  -- extension over the two Handlebars bindings (`as elem index0 index1`).
  expectM "drop-pipes: as binds element + index0 + index1"
    "{{#each xs as item i0 i1}}{{i0}}/{{i1}}:{{item}} {{/each}}"
    (obj [ Tuple "xs" (VArray [ VString "a", VString "b" ]) ])
    "0/1:a 1/2:b "
  -- over an object the second name is the key (matching Handlebars `as |v k|`).
  expectM "drop-pipes: over an object the second name is the key"
    "{{#each o as v k}}{{k}}={{v}};{{/each}}"
    (obj [ Tuple "o" (obj [ Tuple "x" (num 1.0), Tuple "y" (num 2.0) ]) ])
    "x=1;y=2;"

  -- label-shadow lint (ADR-021): a loop `label NAME` whose name is a reserved root
  -- (this/loop/root/parent/yield) shadows it for the whole body, so it warns; a
  -- fresh name does not.
  assert' "label-warn: {{#each xs label loop}} warns"
    (warnNames "{{#each xs label loop}}{{this}}{{/each}}" == [ "loop" ])
  assert' "label-warn: {{#each xs label parent}} warns"
    (warnNames "{{#each xs label parent}}{{this}}{{/each}}" == [ "parent" ])
  assert' "label-warn: {{#each xs label yield}} warns"
    (warnNames "{{#each xs label yield}}{{this}}{{/each}}" == [ "yield" ])
  assert' "label-warn: {{#each xs label outer}} (fresh name) does not warn"
    (Array.null (warnNames "{{#each xs label outer}}{{outer.index0}}{{/each}}"))

  -- boolean-in-output lint (the ?:/??/|| debate): a bare `||`/`&&` in OUTPUT
  -- position yields true/false, almost always a mistake — warn and point at
  -- ?? / ?:. Conditions, value-coalesce, and nested args are NOT flagged.
  assert' "bool-output-warn: {{ a || b }} warns with 'or'"
    (warnNames "{{ a || b }}" == [ "or" ])
  assert' "bool-output-warn: {{ a && b }} warns with 'and'"
    (warnNames "{{ a && b }}" == [ "and" ])
  assert' "bool-output-warn: {{#if a || b}}…{{/if}} (condition) does not warn"
    (Array.null (warnNames "{{#if a || b}}Y{{/if}}"))
  assert' "bool-output-warn: {{ a ?? b }} (null-coalesce) does not warn"
    (Array.null (warnNames "{{ a ?? b }}"))
  assert' "bool-output-warn: {{ a ?: b }} (truthy-coalesce) does not warn"
    (Array.null (warnNames "{{ a ?: b }}"))
  assert' "bool-output-warn: {{ pick (a || b) }} (nested arg) does not warn"
    (Array.null (warnNames "{{ pick (a || b) }}"))

  -- ── Set delimiters (ADR-015 amendment): MinBars-exclusive ─────────────────
  -- MaxBars REJECTS set-delim. The inline `{{=A B=}}` form is a hard parse
  -- error; the `{{! @delimiters: …}}` long-comment form parses as a normal
  -- comment and the directive inside is silently ignored (no delimiter switch
  -- happens, so `<%name%>` reads as plain content). The dialect ladder has
  -- one consistent answer to "does delimiter switching work here?" — yes only
  -- on the Mustache surface.
  assert' "set-delim: inline `{{=A B=}}` is rejected"
    (isLeft (renderMax "{{=<% %>=}}<%name%>" (obj [])))
  assert' "set-delim: `{{! @delimiters: …}}` directive is ignored — `<%name%>` stays content"
    (renderMax "{{! @delimiters: <% %> }}<%name%>" (obj []) == Right "<%name%>")

  -- range + cycle (the Liquid-inspired iteration helpers).
  expectM "range: inclusive integer range as an array"
    "{{#each (range 1 4) as n}}{{n}}{{/each}}"
    (obj [])
    "1234"
  expectM "range: descending bounds yield the empty array"
    "[{{#each (range 4 1) as n}}{{n}}{{/each}}]"
    (obj [])
    "[]"
  expectM "cycle: wraps over its values by the loop index"
    "{{#each xs as x i}}{{ cycle i \"a\" \"b\" }}{{/each}}"
    (obj [ Tuple "xs" (VArray [ VBool true, VBool true, VBool true ]) ])
    "aba"
  assert' "range: a span past the budget is a located error"
    (isLeft (renderMax "{{#each (range 1 200000) as n}}{{n}}{{/each}}" (obj [])))

  -- the `..` range operator (sugar for `(range a b)`): literal and dynamic bounds.
  expectM "range op: 1..4 iterates the inclusive span"
    "{{#each 1..4}}{{this}}{{/each}}"
    (obj [])
    "1234"
  expectM "range op: bounds are expressions (additive binds tighter than ..)"
    "{{#each lo..hi+1}}{{this}}{{/each}}"
    (obj [ Tuple "lo" (num 2.0), Tuple "hi" (num 4.0) ])
    "2345"
  expectM "range op: a value-position range stringifies the array"
    "{{ 1..3 }}"
    (obj [])
    "1,2,3"
  expectM "range op: a single dot stays a decimal (not a range)"
    "{{ 1.5 }}"
    (obj [])
    "1.5"
  expectM "range op: a dotted path is untouched by .."
    "{{ a.b }}"
    (obj [ Tuple "a" (obj [ Tuple "b" (VString "ok") ]) ])
    "ok"

  log "all MaxBars tests passed"
