-- | RawBars dialect tests (`spago test -p rawbars`): rendering and compiling
-- | the austere *core* syntax (explicit calls, no surface sugar).
module Test.RawBars.Main where

import Prelude

import Data.Either (Either(..), isLeft, isRight)
import Data.Map as Map
import Data.String (Pattern(..), contains)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Value (Value(..))
import RawBars (compileJs, render, renderWithOperations)
import Test.Assert (assert')

obj :: Array (Tuple String Value) -> Value
obj = VObject <<< Map.fromFoldable

main :: Effect Unit
main = do
  log "RawBars dialect tests"

  -- core syntax renders against the shared engine (explicit lookup, raw output).
  assert' "render: lookup"
    (render "{{{lookup this \"x\"}}}" (obj [ Tuple "x" (VString "hi") ]) == Right "hi")
  assert' "render: if/else block"
    ( render "{{#if (lookup this \"a\")}}Y{{else}}N{{/if}}" (obj [ Tuple "a" (VBool false) ])
        == Right "N"
    )
  -- RawBars uses the `nonEmpty` rule: 0 is TRUTHY (test magnitude with `gt`),
  -- but "" and the empty array/object are falsy.
  assert' "render: 0 is truthy (nonEmpty rule)"
    ( render "{{#if (lookup this \"n\")}}y{{else}}m{{/if}}"
        (obj [ Tuple "n" (VNumber 0.0) ]) == Right "y"
    )
  assert' "render: empty string is falsy (nonEmpty rule)"
    ( render "{{#if (lookup this \"s\")}}y{{else}}m{{/if}}"
        (obj [ Tuple "s" (VString "") ]) == Right "m"
    )
  assert' "render: empty array is falsy (nonEmpty rule)"
    ( render "{{#if (lookup this \"xs\")}}y{{else}}m{{/if}}"
        (obj [ Tuple "xs" (VArray []) ]) == Right "m"
    )
  -- a parse error surfaces as Left.
  assert' "render: parse error" (isLeft (render "{{ oops" (obj [])))

  -- RawBars is austere: the Handlebars-only shapes are rejected (DisallowedShape).
  assert' "reject: inverse {{^}}" (isLeft (render "{{^a}}x{{/a}}" (obj [])))
  assert' "reject: triple inverse {{{^}}}" (isLeft (render "{{{^a}}}x{{{/a}}}" (obj [])))
  assert' "reject: unescaped {{&}}" (isLeft (render "{{&a}}" (obj [])))
  assert' "reject: raw block {{{{}}}}" (isLeft (render "{{{{r}}}}body{{{{/r}}}}" (obj [])))
  -- the same rejection in the compiled path.
  assert' "reject (compile): inverse" (isLeft (compileJs "{{^a}}x{{/a}}"))

  -- ── Set delimiters (ADR-015 amendment): MinBars-exclusive ─────────────────
  -- RawBars REJECTS set-delim. The Mustache `{{=A B=}}` inline directive is a
  -- hard parse error in RawBars/MaxBars/FullBars; the `{{! @delimiters: …}}`
  -- long-comment form parses as a normal comment and the directive inside is
  -- silently ignored (no delimiter switch happens, so `<%name%>` reads as
  -- plain content). The dialect ladder has one consistent answer to "does
  -- delimiter switching work here?" — yes only on the Mustache surface.
  assert' "set-delim: inline `{{=A B=}}` is rejected"
    (isLeft (render "{{=<% %>=}}<%a%>" (obj [])))
  assert' "set-delim: `{{! @delimiters: …}}` directive is ignored — `<%a%>` stays content"
    (render "{{! @delimiters: <% %> }}<%a%>" (obj []) == Right "<%a%>")

  -- block-partial yield: the native RawBars `yield` operation (FullBars uses `partial-block`)
  -- renders the caller's block body. RawBars has no surface, so it is the explicit
  -- raw spelling `{{{yield}}}` inside a registered partial, invoked as a block
  -- partial (the ctx is passed explicitly — no surface to default it to `this`).
  assert' "yield: block-partial body via {{{yield}}}"
    ( renderWithOperations [] [ Tuple "layout" "<{{{yield}}}>" ]
        "{{#partial \"layout\" this}}HI{{/partial}}"
        (obj [])
        == Right "<HI>"
    )

  -- Inline-partial hoisting — parity with FullBars/MaxBars (ADR-005/008): a bare
  -- {{#inline "x"}} in the template defines a partial (hoisted by the shared
  -- Kernel.Hoist.hoistInline), invoked by {{#partial "x" this}} with {{{yield}}}
  -- the caller's body. Same engine; only the surface syntax differs.
  assert' "inline: {{#inline}} is hoisted, {{{yield}}} renders the caller body"
    ( render
        "{{#inline \"frame\"}}<{{{yield}}}>{{/inline}}{{#partial \"frame\" this}}HI{{/partial}}"
        (obj [])
        == Right "<HI>"
    )
  -- ...and the same template compiles to JS (the hoisted partial is emitted),
  -- where it was previously a no-op inline + an unregistered-partial runtime error.
  assert' "compile: {{#inline}} is hoisted into the compiled module"
    ( isRight
        ( compileJs
            "{{#inline \"frame\"}}<{{{yield}}}>{{/inline}}{{#partial \"frame\" this}}HI{{/partial}}"
        )
    )

  -- compile core syntax to a JS module.
  case compileJs "{{{this}}}" of
    Left e -> assert' ("compileJs: unexpected error " <> show e) false
    Right js -> assert' ("compileJs: expected a module\n" <> js)
      (contains (Pattern "rt.scope(data") js && contains (Pattern "rt.out(c0.ctx)") js)

  log "all RawBars tests passed"
