-- | `barebars-js` facade test suite (`spago test -p barebars-js`).
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
import FullBars.JS (Result, render, renderSurface)
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

  -- The Result type really is a plain { ok, value, error } record.
  let probe = { ok: true, value: "v", error: "" } :: Result
  assert' "Result shape" (probe.ok && probe.value == "v" && probe.error == "")

  log "all facade tests passed"
