-- | `flatbars-js` facade test suite (`spago test -p flatbars-js`).
-- |
-- | Exercises the public JS boundary `FullBars.JS.render` / `renderSurface`
-- | exactly as a JS host would call them (uncurried, over a `Json` value),
-- | checking the `{ ok, value, error }` result shape, auto-escaping, and that
-- | parse failures come back located rather than thrown.
module Test.FullBars.JS.Main where

import Prelude

import Data.Argonaut (Json, jsonParser)
import Data.Array (any, head, length)
import Data.Either (Either(..))
import Data.Function.Uncurried (runFn1, runFn2)
import Data.Maybe (maybe)
import Data.String (contains)
import Data.String.Pattern (Pattern(..))
import Effect (Effect)
import Effect.Console (log)
import FullBars.JS (Result, compileFor, lint, migrate, render, renderSurface)
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
  -- parse failures come back located as `line:column:` (like render), not thrown.
  let bad = runFn2 compileFor "fullbars" "line1\nline2 {{ oops"
  assert' "compileFor parse error not ok" (not bad.ok)
  assert' ("compileFor parse error located: " <> bad.error) (contains (Pattern "2:7:") bad.error)

  -- The Result type really is a plain { ok, value, error } record.
  let probe = { ok: true, value: "v", error: "" } :: Result
  assert' "Result shape" (probe.ok && probe.value == "v" && probe.error == "")

  -- lint: RawBars/MaxBars flag a non-canonical scoped variable + a deprecated
  -- alias; the report mirrors the CLI ("warning: …" lines).
  let lr = runFn2 lint "{{#each xs}}{{index}}{{/each}}{{ plus a b }}" "maxbars"
  assert' "lint ok flag" lr.ok
  assert' ("lint flags index → index0: " <> lr.report) (contains (Pattern "index0") lr.report)
  assert' ("lint flags the plus alias: " <> lr.report) (contains (Pattern "add") lr.report)
  assert' "lint report uses the CLI severity word" (contains (Pattern "warning:") lr.report)
  assert' "lint findings are structured" (length lr.findings == 2)
  -- FullBars keeps @index canonical, so only the alias is flagged there.
  let lf = runFn2 lint "{{ plus a b }}" "fullbars"
  assert' "fullbars lint flags the alias" (length lf.findings == 1)
  -- A clean template reports the CLI's no-findings line.
  let lc = runFn2 lint "{{ name }}" "rawbars"
  assert' "clean lint report" (lc.report == "ok: no lint findings")
  -- findings carry the source location of the offending tag (line/column), so a
  -- host can jump to them (the Lab's Lint panel click-to-jump).
  let ll = runFn2 lint "ok\n{{ plus a b }}" "maxbars"
  assert' "lint finding carries its line"
    (maybe false (\f -> f.line == 2 && f.column == 1) (head ll.findings))

  -- migrate: Handlebars → MaxBars. `{{^x}}` → `{{#unless x}}`, `@index` →
  -- `loop.index0`; an ambiguous bare section surfaces as a residual.
  let mr = runFn1 migrate "{{#each xs}}{{@index}}{{/each}}{{^done}}todo{{/done}}"
  assert' "migrate ok flag" mr.ok
  assert' ("migrate rewrites @index: " <> mr.source) (contains (Pattern "loop.index0") mr.source)
  assert' ("migrate rewrites inverted section: " <> mr.source)
    (contains (Pattern "{{#unless done}}") mr.source)
  let mres = runFn1 migrate "{{#widget}}x{{/widget}}"
  assert' "migrate surfaces an ambiguous-section residual"
    (any (\r -> r.kind == "ambiguous-section") mres.residuals)

  log "all facade tests passed"
