-- | MaxBars dialect tests (`spago test -p maxbars`): the infix-operator + pipe
-- | surface desugaring to FullBars/core, rendered through the reused engine, and
-- | a compile-shape check.
-- |
-- | Infix works in output expressions (`{{ a && b }}` / `{{{ … }}}`), pipes, and
-- | — via the core `parseHead` seam — bare block conditions (`{{#if a && b}}`) and
-- | the Liquid-style loop bindings (`{{#each a i j in xs}}`: element, index,
-- | 1-based index; `with` keeps a drop-pipes `as p`). The head ladder omits the
-- | pipe rung and MaxBars rejects a head bar, so the Handlebars `as |x|` form is a
-- | parse error here. Clause separators (`{{elif …}}` / `{{else if …}}`) still take
-- | a parenthesised condition; a pipe in a block head must also be parenthesised.
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
import MaxBars.Compat (compatReport, compatReportWith)
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

-- | Assert the Trussbars AOT-compat verdict and the exact set of finding `rule`s.
expectCompat :: String -> String -> Value -> Boolean -> Array String -> Effect Unit
expectCompat name = expectCompatWith name []

-- | `expectCompat` with named external partials threaded into the compat check.
expectCompatWith
  :: String
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Boolean
  -> Array String
  -> Effect Unit
expectCompatWith name partials src dat compatible rules =
  case compatReportWith partials src dat of
    Left err -> assert' (name <> ": unexpected parse error: " <> show err) false
    Right r -> do
      assert' (name <> ": expected compatible=" <> show compatible <> " got " <> show r.compatible)
        (r.compatible == compatible)
      let got = map _.rule r.findings
      assert' (name <> ": expected rules " <> show rules <> " got " <> show got) (got == rules)

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
  -- `each` binds Liquid-style — names before `in`: element + 0-based index
  -- (+ a 1-based index).
  expectM "each-in-each" "{{#each item i in xs}}[{{i}}:{{item}}]{{/each}}" xs3
    "[0:a][1:b][2:c]"
  -- `with` binds the shifted context to a name (drop-pipes `as`).
  expectM "with-as-binding" "{{#with o as c}}{{c.n}}{{/with}}"
    (obj [ Tuple "o" (obj [ Tuple "n" (VString "Z") ]) ])
    "Z"
  -- a loop binding is a bare name directly (there are no bare loop variables in
  -- ADR-021, so nothing to shadow): `x in xs` binds the element.
  expectM "each-in-bind" "{{#each x in xs}}{{x}}{{/each}}" xs3 "abc"
  -- an outer loop binding stays in scope inside a nested block.
  expectM "each-in-nested"
    "{{#each row in rows}}{{#each row.cells}}{{row.id}}{{this}} {{/each}}{{/each}}"
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
  -- the collection after `in` is a full expression; `(xs | reverse)` pipes, and
  -- the binding `x` still binds the (reversed) element.
  expectM "each-in-paren-pipe" "{{#each x in (xs | reverse)}}{{x}}{{/each}}" xs3 "cba"

  -- labelled loops (ADR-013): `label NAME` binds the loop frame as an object, so
  -- an inner body reads `NAME.index1`/`NAME.length`/`NAME.first`/… of THIS loop.
  expectM "label-fields"
    "{{#each xs label l}}{{l.index1}}/{{l.length}}{{#if l.first}}<{{/if}}{{#if l.last}}>{{/if}} {{/each}}"
    xs3
    "1/3< 2/3 3/3> "
  -- the point: an inner loop reaches the *outer* loop's metadata through the label.
  expectM "label-outer-from-inner"
    "{{#each row in rows label outer}}{{#each row}}{{outer.index0}}:{{this}} {{/each}}{{/each}}"
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

  -- a bar in a block head is a parse error — whether the author meant the
  -- Handlebars `as |…|` delimiter or an unparenthesised pipe. The parenthesised
  -- pipe is still a pipe.
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

  -- the removed trailing-`as` loop-binding form on `each` is a located error, not a
  -- silent no-op — MaxBars binds `{{#each x in xs}}` now. `with`/custom `as` stay.
  assert' "each-as: {{#each xs as a}} is rejected (use `x in xs`)"
    ( isLeft
        (renderMax "{{#each xs as a}}{{a}}{{/each}}" (obj [ Tuple "xs" (VArray [ VString "x" ]) ]))
    )
  assert' "each-as: a nested {{#each y as z}} is rejected too"
    ( isLeft
        ( renderMax "{{#each x in xs}}{{#each y as z}}{{/each}}{{/each}}"
            (obj [ Tuple "xs" (VArray []) ])
        )
    )
  -- `with … as` and `{{#each x in xs}}` are unaffected (only `each … as` is gone).
  expectM "each-as: {{#with o as p}} keeps `as`"
    "{{#with o as p}}{{p.n}}{{/with}}"
    (obj [ Tuple "o" (obj [ Tuple "n" (VString "Z") ]) ])
    "Z"

  -- `each … in` binds a *third* name to the 1-based index — MaxBars' extension
  -- over the two Handlebars bindings (`item index0 index1 in xs`).
  expectM "each-in: binds element + index0 + index1"
    "{{#each item i0 i1 in xs}}{{i0}}/{{i1}}:{{item}} {{/each}}"
    (obj [ Tuple "xs" (VArray [ VString "a", VString "b" ]) ])
    "0/1:a 1/2:b "
  -- over an object the second name is the key.
  expectM "each-in: over an object the second name is the key"
    "{{#each v k in o}}{{k}}={{v}};{{/each}}"
    (obj [ Tuple "o" (obj [ Tuple "x" (num 1.0), Tuple "y" (num 2.0) ]) ])
    "x=1;y=2;"
  -- a loop binding named like a prelude value op shadows the op: `{{t}}`/`{{t.name}}`
  -- read the binding, not the `t` (translate) helper. Short op-shaped names like
  -- `t` are common with `in`, so this is the everyday case.
  expectM "shadow: a loop binding `t` shadows the translate helper"
    "{{#each t in rows}}[{{t.name}}]{{/each}}"
    ( obj
        [ Tuple "rows"
            (VArray [ obj [ Tuple "name" (VString "A") ], obj [ Tuple "name" (VString "B") ] ])
        ]
    )
    "[A][B]"
  expectM "shadow: a bare block param `add` shadows the add helper"
    "{{#each add in xs}}[{{add}}]{{/each}}"
    (obj [ Tuple "xs" (VArray [ VString "x", VString "y" ]) ])
    "[x][y]"

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

  -- range (the Liquid-inspired counted-loop helper).
  expectM "range: inclusive integer range as an array"
    "{{#each n in (range 1 4)}}{{n}}{{/each}}"
    (obj [])
    "1234"
  expectM "range: descending bounds yield the empty array"
    "[{{#each n in (range 4 1)}}{{n}}{{/each}}]"
    (obj [])
    "[]"
  assert' "range: a span past the budget is a located error"
    (isLeft (renderMax "{{#each n in (range 1 200000)}}{{n}}{{/each}}" (obj [])))

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

  -- collection literals: `[…]` ⇒ (list …), `{k: v}` ⇒ (dict …).
  expectM "list literal: iterates its elements"
    "{{#each [10, 20, 30]}}{{this}} {{/each}}"
    (obj [])
    "10 20 30 "
  expectM "list literal: elements are full expressions"
    "{{#each [1, n + 1, n * 2]}}{{this}} {{/each}}"
    (obj [ Tuple "n" (num 5.0) ])
    "1 6 10 "
  expectM "list literal: empty []"
    "[{{#each []}}x{{/each}}]"
    (obj [])
    "[]"
  -- the structural scanner is brace-aware (collectionLiterals): a dict's own `}`
  -- is balanced before the tag close, so NO disambiguating space is needed even
  -- when the dict abuts `}}`.
  expectM "dict literal: bare-ident keys, no space before }}"
    "{{#with {name: who, age: 30}}}{{name}}/{{age}}{{/with}}"
    (obj [ Tuple "who" (VString "Ada") ])
    "Ada/30"
  expectM "dict literal: a string key, no space"
    "{{#with {\"full name\": who}}}{{lookup this \"full name\"}}{{/with}}"
    (obj [ Tuple "who" (VString "Ada L") ])
    "Ada L"
  -- the scanner skips strings, so a `}}` inside a dict value's string is not a tag
  -- close.
  expectM "dict literal: a `}}` inside a string value is not the tag close"
    "{{#with {msg: \"a}}b\"}}}{{msg}}{{/with}}"
    (obj [])
    "a}}b"
  -- an empty dict `{}` abutting the close (falsy under nonEmpty).
  expectM "dict literal: empty {} with no space"
    "{{#if {}}}t{{else}}f{{/if}}"
    (obj [])
    "f"
  expectM "collection literals nest"
    "{{#each [{tags: [1, 2]}, {tags: [3]}]}}{{#each tags}}{{this}}{{/each}};{{/each}}"
    (obj [])
    "12;3;"
  -- a mid-identifier `[seg]` path-bracket is untouched (only a *leading* `[` is a list).
  expectM "list literal: a.[k] path-bracket is not a list"
    "{{ a.[home town] }}"
    (obj [ Tuple "a" (obj [ Tuple "home town" (VString "Lübeck") ]) ])
    "Lübeck"

  -- block-scoped `{{#let}}` (ADR-024): aliases, sequential, never re-roots.
  expectM "let: a single binding is in scope for the body"
    "{{#let greeting=\"Hi\"}}{{greeting}}!{{/let}}"
    (obj [])
    "Hi!"
  expectM "let: a binding reads from the (unchanged) data context"
    "{{#let n=count}}{{n}} left{{/let}}"
    (obj [ Tuple "count" (num 3.0) ])
    "3 left"
  expectM "let: bindings are sequential — b sees a"
    "{{#let a=1 b=(add a 1) c=(add b 1)}}{{a}}{{b}}{{c}}{{/let}}"
    (obj [])
    "123"
  -- the defining guarantee: `let` aliases but does NOT re-root, so a bare name
  -- still resolves against the current context, unlike `with`.
  expectM "let: does not re-root the context"
    "{{#let u=user}}{{name}}/{{u.name}}{{/let}}"
    (obj [ Tuple "name" (VString "ROOT"), Tuple "user" (obj [ Tuple "name" (VString "Ada") ]) ])
    "ROOT/Ada"
  expectM "let: a binding's value can be a dict literal"
    "{{#let cfg={theme: \"dark\", size: 12}}}{{cfg.theme}}/{{cfg.size}}{{/let}}"
    (obj [])
    "dark/12"
  -- inside a loop the binding coexists with the loop's scoped vars.
  expectM "let: inside a loop, loop.* still resolves"
    "{{#each items}}{{#let u=(uppercase this)}}{{u}}@{{loop.index1}} {{/let}}{{/each}}"
    (obj [ Tuple "items" (VArray [ VString "a", VString "b" ]) ])
    "A@1 B@2 "
  -- a binding named like a prelude op shadows it inside the body (isScopedBinding).
  expectM "let: a binding shadows a same-named prelude op"
    "{{#let add=\"shadowed\"}}{{add}}{{/let}}"
    (obj [])
    "shadowed"

  -- ── Trussbars AOT-compat lint (MaxBars.Compat) ────────────────────────────
  log "Trussbars AOT-compat lint"
  -- a plain boolean condition + field output compiles under AOT.
  expectCompat "compat: boolean if + field output"
    "{{#if active}}{{name}}{{/if}}"
    (obj [ Tuple "active" (VBool true), Tuple "name" (VString "Ada") ])
    true
    []
  -- data-driven: a numeric condition is a compile error under AOT (no Truthy for f64).
  expectCompat "compat: numeric truthiness"
    "{{#if count}}some{{/if}}"
    (obj [ Tuple "count" (num 3.0) ])
    false
    [ "numeric-truthiness" ]
  -- even 0 trips it (the rule is the *type*, not the value).
  expectCompat "compat: numeric truthiness on 0"
    "{{#if count}}x{{/if}}"
    (obj [ Tuple "count" (num 0.0) ])
    false
    [ "numeric-truthiness" ]
  -- data-driven: a bare struct/object in output has no text form under AOT.
  expectCompat "compat: struct output"
    "{{user}}"
    (obj [ Tuple "user" (obj [ Tuple "name" (VString "Ada") ]) ])
    false
    [ "struct-output" ]
  -- structural (drift-proof, from the real front-end): a host i18n helper.
  expectCompat "compat: host helper is structural-reject"
    "{{t \"hello\"}}"
    (obj [])
    false
    [ "aot-structural" ]
  -- the drift trap: a `{{#let}}` hash desugars to `dict`, yet binding a *scalar/path*
  -- compiles under AOT — so the lint must NOT flag the let-hash `dict` (the verdict
  -- delegates to the real compiler, which consumes it structurally).
  expectCompat "compat: let-binding a path is NOT flagged"
    "{{#let label=name}}Hi {{label}}{{/let}}"
    (obj [ Tuple "name" (VString "Ada") ])
    true
    []
  -- binding a dict *literal value* compiles under AOT (the emitter synthesizes a
  -- typed struct for it), so the lint treats it as compatible.
  expectCompat "compat: let-binding a dict literal value is AOT-compatible"
    "{{#let cfg={theme: \"dark\"}}}{{cfg.theme}}{{/let}}"
    (obj [])
    true
    []

  -- a `{{> name}}` resolving to a provided external partial is AOT-compatible
  -- (threaded into the structural check, so not a false "unknown partial").
  expectCompatWith "compat: external partial resolves (not 'unknown partial')"
    [ Tuple "styles" "<b>styled</b>" ]
    "{{> styles}} {{name}}"
    (obj [ Tuple "name" (VString "A") ])
    true
    []
  -- without the partial provided, the same template IS flagged structural.
  expectCompat "compat: an unprovided partial is flagged"
    "{{> styles}} {{name}}"
    (obj [ Tuple "name" (VString "A") ])
    false
    [ "aot-structural" ]

  log "all MaxBars tests passed"
