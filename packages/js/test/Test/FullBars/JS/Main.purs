-- | `flatbars-js` facade test suite (`spago test -p flatbars-js`).
-- |
-- | Exercises the public JS boundary `FullBars.JS.render` / `renderSurface`
-- | exactly as a JS host would call them (uncurried, over a `Json` value),
-- | checking the `{ ok, value, error }` result shape, auto-escaping, and that
-- | parse failures come back located rather than thrown.
module Test.FullBars.JS.Main where

import Prelude

import Data.Argonaut (Json, jsonParser)
import Data.Either (Either(..))
import Data.Function.Uncurried (runFn2)
import Data.String (contains)
import Data.String.Pattern (Pattern(..))
import Effect (Effect)
import Effect.Console (log)
import FullBars.JS (Result, compileFor, render, renderSurface)
import Test.Assert (assert')

-- Parse a JSON literal for use as render data, failing the test on a bad fixture.
json :: String -> String -> (Json -> Effect Unit) -> Effect Unit
json label src k = case jsonParser src of
  Left e -> assert' (label <> ": bad JSON fixture: " <> e) false
  Right j -> k j

main :: Effect Unit
main = do
  log "FullBars.JS facade tests"

  -- Surface dialect: paths resolve and {{ }} auto-escapes.
  json "surface-escape" "{\"name\": \"Ada & <b>\"}" \j -> do
    let r = runFn2 renderSurface "<h1>{{ name }}</h1>" j
    assert' "surface ok flag" r.ok
    assert' ("surface escaped value: " <> r.value) (r.value == "<h1>Ada &amp; &lt;b&gt;</h1>")
    assert' "surface empty error" (r.error == "")

  -- Core syntax: explicit helpers, {{{ }}} is output.
  json "core" "{\"x\": \"<i>\"}" \j -> do
    let r = runFn2 render "{{{ escapeHtml (lookup this \"x\") }}}" j
    assert' "core ok flag" r.ok
    assert' ("core value: " <> r.value) (r.value == "&lt;i&gt;")

  -- Parse failure: returned (not thrown) and located as line:column.
  json "parse-error" "{}" \j -> do
    let r = runFn2 renderSurface "line1\nline2 {{ oops" j
    assert' "parse error not ok" (not r.ok)
    assert' "parse error empty value" (r.value == "")
    assert' ("parse error located: " <> r.error) (contains (Pattern "2:7:") r.error)

  -- Eval failure (unknown helper) is also returned, not thrown.
  json "eval-error" "{}" \j -> do
    let r = runFn2 render "{{{ nope }}}" j
    assert' "eval error not ok" (not r.ok)
    assert' ("eval error message: " <> r.error) (contains (Pattern "nope") r.error)

  -- compileFor dispatches to each dialect's compiler; every one emits a JS
  -- module (default export), so a host has a single call site.
  let
    compiles label dialect src =
      let
        r = runFn2 compileFor dialect src
      in
        do
          assert' (label <> " compiles ok: " <> r.error) r.ok
          assert' (label <> " emits a module") (contains (Pattern "export default") r.value)
  compiles "rawbars" "rawbars" "{{{ escapeHtml (lookup this \"x\") }}}"
  compiles "fullbars" "fullbars" "<h1>{{ name }}</h1>"
  compiles "maxbars" "maxbars" "{{ score >= 50 }}" -- infix desugars to core, then shared driver
  compiles "minbars" "minbars" "{{name}}"
  compiles "unknown→fullbars" "wat" "{{ name }}" -- unknown dialect falls back to surface
  -- parse failures come back as a (positioned) error result, not thrown.
  let bad = runFn2 compileFor "fullbars" "line1\nline2 {{ oops"
  assert' "compileFor parse error not ok" (not bad.ok)
  assert' ("compileFor parse error reported: " <> bad.error)
    (contains (Pattern "Unterminated") bad.error)

  -- The Result type really is a plain { ok, value, error } record.
  let probe = { ok: true, value: "v", error: "" } :: Result
  assert' "Result shape" (probe.ok && probe.value == "v" && probe.error == "")

  log "all facade tests passed"
