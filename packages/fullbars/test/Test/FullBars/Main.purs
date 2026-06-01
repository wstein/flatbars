-- | FullBars engine test suite (`spago test -p fullbars`).
-- |
-- | Exercises the reference engine end to end — rendering, the `lower` real AST,
-- | the escaping lint, the Aff instantiation, and a pluggable-env engine — over
-- | the BareBars framework (parse/foldTemplate/spans).
module Test.FullBars.Main where

import Prelude

import BareBars (parse, spanText)
import BareBars.Error (Error(..))
import BareBars.Syntax (Expr(..), Node(..))
import BareBars.Value (Value(..))
import Control.Monad.Except.Trans (runExceptT)
import Data.Array as Array
import Data.Either (Either(..), isLeft)
import Data.Foldable (for_)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Number (nan)
import Data.Set as Set
import Data.String (Pattern(..), contains, toUpper)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Aff (launchAff_)
import Effect.Class (liftEffect)
import Effect.Console (log)
import FullBars (FalsySet, FalsyShape(..), RNode(..), RefEnv, crossBoundaryWarnings, desugarSurface, directiveLints, emptyEnv, escapingWarnings, handlebars, lower, minimal, prelude, preludeEnv, preludeSchema, refEngine, renderSurface, renderSurfaceWith, resolveTruthiness, stringify, truthy)
import Kernel.Engine (Ctl, Engine, Helper, runString, runTemplate)
import Kernel.Prelude (coreSchema, preludeSchema) as KP
import Kernel.Walk (arityOk, foldTemplate, validate)
import Test.Assert (assert')

-- A minimal control handle for exercising helpers that ignore it (the value
-- helpers under arity-conformance). Renders nothing; has an empty clause.
dummyCtl :: Ctl (Either Error) (RefEnv (Either Error))
dummyCtl =
  { env: emptyEnv VNull
  , children: []
  , span: { start: 0, end: 0 }
  , render: \_ _ -> Right ""
  , eval: \_ _ -> Right VNull
  , clause: \_ -> { before: [], body: Nothing }
  }

obj :: Array (Tuple String Value) -> Value
obj = VObject <<< Map.fromFoldable

arr :: Array Value -> Value
arr = VArray

str :: String -> Value
str = VString

-- Render core syntax straight through the engine (no dialect layer): this suite
-- tests the FullBars *engine*, so it uses `runString` directly rather than the
-- RawBars dialect (which now owns the `render` convenience).
renderCore :: String -> Value -> Either String String
renderCore src dat = case runString (refEngine (preludeEnv dat)) src of
  Left e -> Left (show e)
  Right out -> Right out

-- | Assert that `src` rendered against `dat` yields `expected`.
expect :: String -> String -> Value -> String -> Effect Unit
expect name src dat expected =
  case renderCore src dat of
    Left err -> assert' (name <> ": unexpected error: " <> err) false
    Right out -> assert' (name <> ": expected " <> show expected <> " got " <> show out)
      (out == expected)

-- | Assert that `src` fails to render (parse or eval error).
expectError :: String -> String -> Value -> Effect Unit
expectError name src dat = case renderCore src dat of
  Left _ -> pure unit
  Right out -> assert' (name <> ": expected an error, got " <> show out) false

-- | Assert that *Surface* source `src` rendered against `dat` yields `expected`.
expectS :: String -> String -> Value -> String -> Effect Unit
expectS name src dat expected = case renderSurface src dat of
  Left err -> assert' (name <> ": unexpected error: " <> err) false
  Right out -> assert' (name <> ": expected " <> show expected <> " got " <> show out)
    (out == expected)

-- | Assert that Surface `src` with the given named partials yields `expected`.
expectP :: String -> Array (Tuple String String) -> String -> Value -> String -> Effect Unit
expectP name partials src dat expected = case renderSurfaceWith partials src dat of
  Left err -> assert' (name <> ": unexpected error: " <> err) false
  Right out -> assert' (name <> ": expected " <> show expected <> " got " <> show out)
    (out == expected)

-- | Assert that `src` parses and validates cleanly against the prelude schema.
expectValid :: String -> String -> Effect Unit
expectValid name src = case parse src of
  Left e -> assert' (name <> ": parse error " <> show e) false
  Right { nodes: t } ->
    let
      issues = validate preludeSchema t
    in
      assert' (name <> ": expected no issues, got " <> show (map _.message issues))
        (Array.null issues)

-- | Assert that `src` parses but the schema validation reports at least one issue.
expectIssue :: String -> String -> Effect Unit
expectIssue name src = case parse src of
  Left e -> assert' (name <> ": expected a validation issue, but got parse error " <> show e) false
  Right { nodes: t } -> assert' (name <> ": expected a validation issue")
    (not (Array.null (validate preludeSchema t)))

-- A *pluggable env*: an engine whose environment is a bare `Value` (not the
-- reference `RefEnv`), with a fixed two-helper resolver. Proves the driver is
-- polymorphic in `env`.
customEngine :: Value -> Engine (Either Error) Value
customEngine root =
  { initial: root
  , resolve: \_ name -> case name of
      "this" -> Right \ctl _ -> Right ctl.env
      "shout" -> Right shoutH
      "at" -> Right \ctl _ -> Right (VString (show ctl.span.start)) -- reads Ctl.span
      _ -> Left (UnknownHelper name)
  , stringify
  }
  where
  shoutH _ args = case args of
    [ v ] -> VString <<< toUpper <$> stringify v
    _ -> Left (ArityError "shout/1")

main :: Effect Unit
main = do
  log "BareBars core tests"

  expect "content" "hello world" VNull "hello world"

  expect "this-string" "{{{this}}}" (str "hi") "hi"

  expect "lookup" "{{{lookup this \"name\"}}}"
    (obj [ Tuple "name" (str "Ada") ])
    "Ada"

  expect "nested-lookup" "{{{lookup this \"user\" \"city\"}}}"
    (obj [ Tuple "user" (obj [ Tuple "city" (str "Lübeck") ]) ])
    "Lübeck"

  -- arithmetic + coalesce prelude helpers (pin the actual values; conformance
  -- only proves compiled ≡ interpreter, not that either is correct).
  let ab a b = obj [ Tuple "a" (VNumber a), Tuple "b" (VNumber b) ]
  expect "add" "{{{add (lookup this \"a\") (lookup this \"b\")}}}" (ab 2.0 3.0) "5"
  expect "subtract" "{{{subtract (lookup this \"a\") (lookup this \"b\")}}}" (ab 7.0 4.0) "3"
  expect "multiply" "{{{multiply (lookup this \"a\") (lookup this \"b\")}}}" (ab 6.0 7.0) "42"
  expect "divide" "{{{divide (lookup this \"a\") (lookup this \"b\")}}}" (ab 9.0 2.0) "4.5"
  expect "modulo" "{{{modulo (lookup this \"a\") (lookup this \"b\")}}}" (ab 17.0 5.0) "2"
  expect "modulo-neg" "{{{modulo (lookup this \"a\") (lookup this \"b\")}}}" (ab (-17.0) 5.0) "-2"
  expect "arith-nested"
    "{{{add (multiply (lookup this \"a\") (lookup this \"b\")) (lookup this \"a\")}}}"
    (ab 3.0 4.0)
    "15"
  expect "coalesce-null" "{{{coalesce (lookup this \"a\") (lookup this \"b\")}}}"
    (obj [ Tuple "a" VNull, Tuple "b" (str "fb") ])
    "fb"
  -- null-coalescing is NOT truthiness: a present 0 wins over the fallback.
  expect "coalesce-zero" "{{{coalesce (lookup this \"a\") (lookup this \"b\")}}}"
    (obj [ Tuple "a" (VNumber 0.0), Tuple "b" (str "fb") ])
    "0"

  -- value primitives — string pack (helper-packs-spec §4). Pin the actual
  -- `{{else if …}}` carries a trailing options hash through to `elif`, so
  -- `includeZero=true` works on it exactly like on `{{elif …}}`.
  expectS "else-if-includeZero" "{{#if a}}A{{else if n includeZero=true}}Z{{else}}E{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "n" (VNumber 0.0) ])
    "Z"
  expectS "else-if-plain" "{{#if a}}A{{else if b}}B{{else}}E{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool true) ])
    "B"

  -- outputs; conformance only proves compiled ≡ interpreter, not correctness.
  let s1 v = obj [ Tuple "s" (str v) ]
  expectS "p-lowercase" "{{{ lowercase s }}}" (s1 "HeLLo") "hello"
  expectS "p-uppercase" "{{{ uppercase s }}}" (s1 "HeLLo") "HELLO"
  -- subject coercion: a number is stringified before transforming.
  expectS "p-uppercase-number" "{{{ uppercase n }}}" (obj [ Tuple "n" (VNumber 42.0) ]) "42"
  expectS "p-capitalize" "{{{ capitalize s }}}" (s1 "hello world") "Hello world"
  expectS "p-capitalize-empty" "[{{{ capitalize s }}}]" (s1 "") "[]"
  expectS "p-trim" "[{{{ trim s }}}]" (s1 "  hi \t\n ") "[hi]"
  expectS "p-trimStart" "[{{{ trimStart s }}}]" (s1 "  hi  ") "[hi  ]"
  expectS "p-trimEnd" "[{{{ trimEnd s }}}]" (s1 "  hi  ") "[  hi]"
  expectS "p-trim-allspace" "[{{{ trimStart s }}}][{{{ trimEnd s }}}]" (s1 "   ") "[][]"
  -- split → VArray VString (stringify joins with ",").
  expectS "p-split" "{{{ split s \",\" }}}" (s1 "a,b,c") "a,b,c"
  expectS "p-split-each" "{{#each (split s \",\")}}<{{ this }}>{{/each}}" (s1 "a,b,c") "<a><b><c>"
  expectS "p-replace" "{{{ replace s \"-\" \"+\" }}}" (s1 "a-b-c") "a+b+c"
  expectS "p-replace-all" "{{{ replace s \"foo\" \"bar\" }}}" (s1 "foo foo foo") "bar bar bar"
  -- slice: JS String.prototype.slice semantics, negative indices allowed.
  expectS "p-slice" "{{{ slice s 1 4 }}}" (s1 "hello") "ell"
  expectS "p-slice-open" "{{{ slice s 2 }}}" (s1 "hello") "llo"
  expectS "p-slice-neg-start" "{{{ slice s (subtract 0 3) }}}" (s1 "hello") "llo"
  expectS "p-slice-neg-end" "{{{ slice s 0 (subtract 0 2) }}}" (s1 "hello") "hel"
  expectS "p-slice-neg-both" "{{{ slice s (subtract 0 4) (subtract 0 1) }}}" (s1 "hello") "ell"
  expectS "p-slice-overshoot" "[{{{ slice s 5 10 }}}]" (s1 "hi") "[]"
  expectS "p-slice-inverted" "[{{{ slice s 4 1 }}}]" (s1 "hello") "[]"
  expectS "p-includes-true" "{{{ includes s \"ell\" }}}" (s1 "hello") "true"
  expectS "p-includes-false" "{{{ includes s \"xyz\" }}}" (s1 "hello") "false"
  expectS "p-startsWith" "{{{ startsWith s \"he\" }}}" (s1 "hello") "true"
  expectS "p-endsWith" "{{{ endsWith s \"lo\" }}}" (s1 "hello") "true"
  -- truncate: longer-than-n ⇒ first n chars + suffix (default ellipsis U+2026).
  expectS "p-truncate-long" "{{{ truncate s 5 }}}" (s1 "hello world") "hello\x2026"
  expectS "p-truncate-short" "{{{ truncate s 5 }}}" (s1 "hi") "hi"
  expectS "p-truncate-boundary" "{{{ truncate s 5 }}}" (s1 "hello") "hello"
  expectS "p-truncate-suffix" "{{{ truncate s 5 \"...\" }}}" (s1 "hello world") "hello..."
  expectS "p-append" "{{{ append s \"bar\" }}}" (s1 "foo") "foobar"
  expectS "p-prepend" "{{{ prepend s \"bar\" }}}" (s1 "foo") "barfoo"
  -- case aliases: downcase/upcase render exactly like lowercase/uppercase.
  expectS "p-downcase-alias" "{{{ downcase s }}}" (s1 "HeLLo") "hello"
  expectS "p-upcase-alias" "{{{ upcase s }}}" (s1 "HeLLo") "HELLO"

  -- value primitives — number pack (helper-packs-spec §4). Pin the actual
  -- outputs; abs/floor/ceil/round are Math.*, toFixed is n.toFixed(d), toInt/
  -- toFloat parse via Data.Number.fromString (parseFloat gated by isFinite).
  let n1 v = obj [ Tuple "n" (VNumber v) ]
  expectS "p-abs" "{{{ abs n }}}" (n1 (-7.0)) "7"
  expectS "p-abs-frac" "{{{ abs n }}}" (n1 (-4.5)) "4.5"
  expectS "p-floor" "{{{ floor n }}}" (n1 3.9) "3"
  expectS "p-floor-neg" "{{{ floor n }}}" (n1 (-3.1)) "-4"
  expectS "p-ceil" "{{{ ceil n }}}" (n1 3.1) "4"
  expectS "p-round-half" "{{{ round n }}}" (n1 2.5) "3"
  expectS "p-round-down" "{{{ round n }}}" (n1 2.4) "2"
  expectS "p-toFixed" "{{{ toFixed n 2 }}}" (n1 3.14159) "3.14"
  expectS "p-toFixed-pad" "{{{ toFixed n 3 }}}" (n1 1.0) "1.000"
  -- toInt: parse then truncate toward zero; non-parsing input ⇒ null (empty).
  expectS "p-toInt" "{{{ toInt s }}}" (s1 "42") "42"
  expectS "p-toInt-trunc" "{{{ toInt s }}}" (s1 "3.9") "3"
  expectS "p-toInt-fail" "[{{{ toInt s }}}]" (s1 "abc") "[]"
  expectS "p-toFloat" "{{{ toFloat s }}}" (s1 "3.5") "3.5"
  expectS "p-toFloat-neg" "{{{ toFloat s }}}" (s1 "-1.5") "-1.5"
  expectS "p-toFloat-fail" "[{{{ toFloat s }}}]" (s1 "nope") "[]"

  -- value primitives — array pack (helper-packs-spec §4, §6). The key-based
  -- forms take a dotted key string; sortBy is a stable sort by compareValues.
  let
    xsObj vs = obj [ Tuple "xs" (arr vs) ]
    person nm age = obj [ Tuple "name" (str nm), Tuple "age" (VNumber age) ]
  expectS "p-join" "{{{ join xs \"-\" }}}" (xsObj [ str "a", str "b", str "c" ]) "a-b-c"
  expectS "p-join-numbers" "{{{ join xs \", \" }}}" (xsObj [ VNumber 1.0, VNumber 2.0 ]) "1, 2"
  expectS "p-count" "{{{ count xs }}}" (xsObj [ str "a", str "b", str "c" ]) "3"
  expectS "p-count-object" "{{{ count o }}}"
    (obj [ Tuple "o" (obj [ Tuple "a" (VNumber 1.0), Tuple "b" (VNumber 2.0) ]) ])
    "2"
  expectS "p-size-alias" "{{{ size xs }}}" (xsObj [ str "a", str "b" ]) "2"
  expectS "p-at" "{{{ at xs 1 }}}" (xsObj [ str "a", str "b", str "c" ]) "b"
  expectS "p-at-neg" "{{{ at xs (subtract 0 1) }}}" (xsObj [ str "a", str "b", str "c" ]) "c"
  expectS "p-at-oob" "[{{{ at xs 5 }}}]" (xsObj [ str "a" ]) "[]"
  expectS "p-take" "{{{ join (take xs 2) \",\" }}}" (xsObj [ str "a", str "b", str "c", str "d" ])
    "a,b"
  expectS "p-take-clamp" "{{{ join (take xs 9) \",\" }}}" (xsObj [ str "a", str "b" ]) "a,b"
  expectS "p-takeRight" "{{{ join (takeRight xs 2) \",\" }}}"
    (xsObj [ str "a", str "b", str "c", str "d" ])
    "c,d"
  expectS "p-take-zero" "[{{{ join (take xs 0) \",\" }}}]" (xsObj [ str "a", str "b" ]) "[]"
  expectS "p-reverse-array" "{{{ join (reverse xs) \",\" }}}" (xsObj [ str "a", str "b", str "c" ])
    "c,b,a"
  expectS "p-reverse-string" "{{{ reverse s }}}" (s1 "abc") "cba"
  expectS "p-unique" "{{{ join (unique xs) \",\" }}}"
    (xsObj [ str "a", str "b", str "a", str "c", str "b" ])
    "a,b,c"
  -- includes is polymorphic: an array subject ⇒ element membership.
  expectS "p-includes-array-true" "{{{ includes xs \"b\" }}}" (xsObj [ str "a", str "b", str "c" ])
    "true"
  expectS "p-includes-array-false" "{{{ includes xs \"z\" }}}" (xsObj [ str "a", str "b" ]) "false"
  -- sortBy: stable, by the dotted key's value (compareValues).
  expectS "p-sortBy" "{{#each (sortBy xs \"age\")}}{{ name }}:{{ age }};{{/each}}"
    (xsObj [ person "c" 3.0, person "a" 1.0, person "b" 2.0 ])
    "a:1;b:2;c:3;"
  expectS "p-sortBy-dotted" "{{#each (sortBy xs \"u.age\")}}{{ u.age }};{{/each}}"
    ( xsObj
        [ obj [ Tuple "u" (obj [ Tuple "age" (VNumber 30.0) ]) ]
        , obj [ Tuple "u" (obj [ Tuple "age" (VNumber 10.0) ]) ]
        ]
    )
    "10;30;"
  expectS "p-pluck" "{{{ join (pluck xs \"id\") \",\" }}}"
    ( xsObj
        [ obj [ Tuple "id" (VNumber 1.0) ]
        , obj [ Tuple "id" (VNumber 2.0) ]
        , obj [ Tuple "id" (VNumber 3.0) ]
        ]
    )
    "1,2,3"
  expectS "p-groupBy"
    "{{#each (groupBy xs \"type\")}}{{ @key }}=[{{#each this}}{{ id }}{{/each}}];{{/each}}"
    ( xsObj
        [ obj [ Tuple "type" (str "x"), Tuple "id" (str "1") ]
        , obj [ Tuple "type" (str "y"), Tuple "id" (str "2") ]
        , obj [ Tuple "type" (str "x"), Tuple "id" (str "3") ]
        ]
    )
    "x=[13];y=[2];"

  expect "esc-html" "{{{escapeHtml (lookup this \"x\")}}}"
    (obj [ Tuple "x" (str "<b>&\"'") ])
    "&lt;b&gt;&amp;&quot;&#x27;"
  -- the canonical `escapeHtml` renders identically to its `escapeHtml` alias.
  expect "escapeHtml-canonical" "{{{escapeHtml (lookup this \"x\")}}}"
    (obj [ Tuple "x" (str "<b>&\"'") ])
    "&lt;b&gt;&amp;&quot;&#x27;"
  -- `escapeJson` is the canonical name for `escapeJson`.
  expect "escapeJson-canonical" "{{{escapeJson (lookup this \"o\")}}}"
    (obj [ Tuple "o" (obj [ Tuple "a" (VNumber 1.0) ]) ])
    "{&quot;a&quot;:1}"

  expect "subexpr" "{{{escapeHtml (lookup this \"name\")}}}"
    (obj [ Tuple "name" (str "A<B") ])
    "A&lt;B"

  -- json: serialize a value as compact JSON text (plain VString).
  expect "json-string" "{{{json (lookup this \"x\")}}}" (obj [ Tuple "x" (str "a\"b") ])
    "\"a\\\"b\""
  expect "json-number-int" "{{{json (lookup this \"n\")}}}" (obj [ Tuple "n" (VNumber 3.0) ]) "3"
  expect "json-number-frac" "{{{json (lookup this \"n\")}}}" (obj [ Tuple "n" (VNumber 1.5) ]) "1.5"
  expect "json-bool-null" "{{{json (lookup this \"b\")}}}{{{json (lookup this \"z\")}}}"
    (obj [ Tuple "b" (VBool true), Tuple "z" VNull ])
    "truenull"
  expect "json-array" "{{{json (lookup this \"xs\")}}}"
    (obj [ Tuple "xs" (arr [ str "x", VNumber 1.0 ]) ])
    "[\"x\",1]"
  expect "json-object-sorted" "{{{json this}}}"
    (obj [ Tuple "b" (VNumber 2.0), Tuple "a" (VNumber 1.0) ])
    "{\"a\":1,\"b\":2}"
  -- control characters use the readable escapes.
  expect "json-control" "{{{json (safe \"a\nb\tc\")}}}" VNull "\"a\\nb\\tc\""
  -- json pretty=true: two-space indented JSON; empty containers stay inline.
  expect "json-pretty" "{{{json (lookup this \"o\") (dict \"pretty\" true)}}}"
    (obj [ Tuple "o" (obj [ Tuple "a" (VNumber 1.0), Tuple "xs" (arr [ str "x" ]) ]) ])
    "{\n  \"a\": 1,\n  \"xs\": [\n    \"x\"\n  ]\n}"
  expect "json-pretty-empty" "{{{json this (dict \"pretty\" true)}}}" (obj []) "{}"
  -- pretty defaults off, and a non-object opts argument is treated as compact.
  expect "json-pretty-default-off" "{{{json (lookup this \"o\")}}}"
    (obj [ Tuple "o" (obj [ Tuple "a" (VNumber 1.0) ]) ])
    "{\"a\":1}"
  -- escapeJson: JSON + HTML-escape, marked safe (the JSON analogue of escapeHtml).
  expect "esc-json" "{{{escapeJson (lookup this \"x\")}}}" (obj [ Tuple "x" (str "<b>") ])
    "&quot;&lt;b&gt;&quot;"
  -- escapeJson honours pretty=true too.
  expect "esc-json-pretty" "{{{escapeJson (lookup this \"xs\") (dict \"pretty\" true)}}}"
    (obj [ Tuple "xs" (arr [ str "<b>" ]) ])
    "[\n  &quot;&lt;b&gt;&quot;\n]"
  -- surface hash: {{ json x pretty=true }} feeds the (dict "pretty" true) option.
  expectS "surface-json-pretty" "{{{ json o pretty=true }}}"
    (obj [ Tuple "o" (obj [ Tuple "a" (VNumber 1.0) ]) ])
    "{\n  \"a\": 1\n}"
  -- escapeHtml is idempotent on escapeJson's VSafe, so surface {{ }} does not double-escape.
  expectS "surface-esc-json" "{{ escapeJson (lookup this \"x\") }}" (obj [ Tuple "x" (str "<b>") ])
    "&quot;&lt;b&gt;&quot;"
  -- surface {{ json x }} HTML-escapes the JSON; {{{ json x }}} leaves it raw.
  expectS "surface-json-escaped" "{{ json (lookup this \"x\") }}" (obj [ Tuple "x" (str "<b>") ])
    "&quot;&lt;b&gt;&quot;"
  expectS "surface-json-raw" "{{{ json (lookup this \"x\") }}}" (obj [ Tuple "x" (str "<b>") ])
    "\"<b>\""
  -- a standalone `{{else}}` line is stripped (like the block open/close), so an
  -- if/else over its own lines leaves no blank line — Handlebars whitespace parity.
  expectS "standalone-else-false" "{{#if x}}\nA\n{{else}}\nB\n{{/if}}\n"
    (obj [ Tuple "x" (VBool false) ])
    "B\n"
  expectS "standalone-else-true" "{{#if x}}\nA\n{{else}}\nB\n{{/if}}\n"
    (obj [ Tuple "x" (VBool true) ])
    "A\n"

  expect "if-true-bare" "{{#if this}}yes{{/if}}" (VBool true) "yes"
  expect "if-false-bare" "{{#if this}}yes{{/if}}" (VBool false) ""
  expect "unless" "{{#unless this}}none{{/unless}}" (VBool false) "none"

  -- Truthiness matches Handlebars: 0 is falsy by default. `includeZero` (passed
  -- as an options object via `dict`) makes 0 count as truthy.
  expect "if-zero-falsy" "{{#if this}}y{{else}}n{{/if}}" (VNumber 0.0) "n"
  expect "if-nonzero-truthy" "{{#if this}}y{{else}}n{{/if}}" (VNumber 1.0) "y"
  expect "if-zero-includeZero" "{{#if this (dict \"includeZero\" true)}}y{{else}}n{{/if}}"
    (VNumber 0.0)
    "y"
  expect "unless-zero" "{{#unless this}}n{{/unless}}" (VNumber 0.0) "n"
  expect "unless-zero-includeZero" "{{#unless this (dict \"includeZero\" true)}}n{{/unless}}"
    (VNumber 0.0)
    ""

  -- Invariant: marking a string safe never changes its truthiness — a safe
  -- string tests as its content. (Handlebars instead tests a SafeString as an
  -- object, so even an empty one is truthy; that divergence is intentional.)
  for_ [ "", "0", "x" ] \s ->
    assert' ("safe-truthiness invariant for " <> show s)
      (truthy handlebars (VSafe s) == truthy handlebars (VString s))

  -- §8 truthiness matrix — the engine's value policy across modes. This is the
  -- semantics EVERY dialect shares (RawBars/FullBars/future MaxBars all render
  -- through one `truthy`, parameterised only by the falsy-set); locks §3.2/§8.
  let
    ruby = Set.fromFoldable [ FFalse, FNull ]
    presence = Set.fromFoldable [ FFalse, FNull, FEmptyArr, FEmptyObj ]
    always = Set.empty :: FalsySet
    row label v hb' rb' pr' al' = do
      assert' (label <> " @handlebars") (truthy handlebars v == hb')
      assert' (label <> " @ruby") (truthy ruby v == rb')
      assert' (label <> " @presence") (truthy presence v == pr')
      assert' (label <> " @always") (truthy always v == al')
  --      value                     hb     ruby   presence always
  row "false" (VBool false) false false false true
  row "null" VNull false false false true
  row "0" (VNumber 0.0) false true true true
  row "\"0\"" (VString "0") true true true true
  row "empty-string" (VString "") false true true true
  row "blank-string" (VString " ") true true true true
  row "[]" (VArray []) false true false true
  row "{}" (VObject Map.empty) true true false true
  row "safe-empty" (VSafe "") false true true true
  row "NaN" (VNumber nan) true true true true

  -- Phase 2: the @truthiness directive retunes the *active* mode per file, and
  -- the conditionals/operators read it. Rendering matrix (surface) + resolver.
  let
    n0 = obj [ Tuple "n" (VNumber 0.0) ]
  -- default (no directive) ⇒ handlebars: 0 is falsy.
  expectS "truth:default-zero-falsy" "{{#if n}}y{{else}}m{{/if}}" n0 "m"
  -- @truthiness:minimal ⇒ 0/""/[]/{} truthy; only false/null falsy.
  expectS "truth:minimal-zero-truthy" "{{! @truthiness:minimal }}{{#if n}}y{{else}}m{{/if}}" n0 "y"
  expectS "truth:minimal-empty-string-truthy"
    "{{! @truthiness:minimal }}{{#if s}}y{{else}}m{{/if}}"
    (obj [ Tuple "s" (str "") ])
    "y"
  -- the three language synonyms expand to the same set as `minimal`.
  for_ [ "ruby", "nil", "lua" ] \alias ->
    expectS ("truth:synonym-" <> alias)
      ("{{! @truthiness:" <> alias <> " }}{{#if n}}y{{else}}m{{/if}}")
      n0
      "y"
  -- the explicit shape-list form (false null ≡ minimal).
  expectS "truth:explicit-list" "{{! @truthiness: false null }}{{#if n}}y{{else}}m{{/if}}" n0 "y"
  -- presence: empty array/object are falsy (where handlebars calls {} truthy).
  expectS "truth:presence-empty-array-falsy"
    "{{! @truthiness:presence }}{{#if xs}}y{{else}}m{{/if}}"
    (obj [ Tuple "xs" (arr []) ])
    "m"
  expectS "truth:presence-empty-object-falsy"
    "{{! @truthiness:presence }}{{#if o}}y{{else}}m{{/if}}"
    (obj [ Tuple "o" (obj []) ])
    "m"
  -- always: nothing is falsy, so even false takes the then-branch.
  expectS "truth:always-false-truthy"
    "{{! @truthiness:always }}{{#if b}}y{{else}}m{{/if}}"
    (obj [ Tuple "b" (VBool false) ])
    "y"
  -- the operators read the active mode too (and 0 5 ⇒ true under minimal).
  expectS "truth:and-retuned" "{{! @truthiness:minimal }}{{{ and 0 5 }}}" VNull "true"
  expectS "truth:and-default" "{{{ and 0 5 }}}" VNull "false"
  -- includeZero is a per-call exception layered on the mode (here: handlebars).
  expectS "truth:includeZero-compose"
    "{{! @truthiness:empty }}{{#if n includeZero=true}}y{{else}}m{{/if}}"
    n0
    "y"
  -- resolver errors: empty value, duplicate, unknown alias/literal.
  assert' "truth:empty-value errors" (isLeft (renderSurface "{{! @truthiness: }}x" VNull))
  assert' "truth:duplicate errors"
    (isLeft (renderSurface "{{! @truthiness:ruby }}{{! @truthiness:lua }}x" VNull))
  assert' "truth:unknown-alias errors" (isLeft (renderSurface "{{! @truthiness:bogus }}x" VNull))

  -- Standalone whitespace removal (on by default): a block open/close or comment
  -- alone on its line leaves no blank line.
  expect "standalone:block"
    "a\n{{#if (lookup this \"c\")}}\nX\n{{/if}}\nb"
    (obj [ Tuple "c" (VBool true) ])
    "a\nX\nb"
  expect "standalone:comment" "a\n{{! note }}\nb" VNull "a\nb"
  -- @trim:none keeps the lines (directive overrides the default).
  expect "standalone:trim-none-directive"
    "{{! @trim:none }}a\n{{#if (lookup this \"c\")}}\nX\n{{/if}}\nb"
    (obj [ Tuple "c" (VBool true) ])
    "a\n\nX\n\nb"
  -- a non-standalone tag (content on its line) is untouched.
  expect "standalone:inline-untouched"
    "a {{#if (lookup this \"c\")}}X{{/if}} b"
    (obj [ Tuple "c" (VBool true) ])
    "a X b"

  -- Phase 3: partial-boundary truthiness scoping. An external partial branches
  -- by its OWN @truthiness, never the caller's (§5, file-based & lexical).
  -- minimal-mode partial called from a default caller: 0 is truthy in the partial.
  expectP "partial:external-uses-own-mode"
    [ Tuple "card" "{{! @truthiness:minimal }}{{#if n}}has{{else}}none{{/if}}" ]
    "{{> card this}}"
    n0
    "has"
  -- a directive-less external partial uses handlebars even when the caller is
  -- minimal — the caller's mode is NOT inherited across the boundary.
  expectP "partial:no-inherit-from-caller"
    [ Tuple "card" "{{#if n}}has{{else}}none{{/if}}" ]
    "{{! @truthiness:minimal }}{{> card this}}"
    n0
    "none"
  -- an inline (same-file) partial DOES inherit the file's mode (it's lexical).
  expectS "partial:inline-inherits-file-mode"
    "{{! @truthiness:minimal }}{{#inline \"row\"}}{{#if n}}y{{else}}m{{/if}}{{/inline}}{{> row this}}"
    n0
    "y"

  -- Phase 4: directive diagnostics.
  let
    dirsOf s = case parse s of
      Right { directives } -> directives
      Left _ -> []
  -- unknown directive key warns (carried for forward-compat); known keys silent.
  assert' "lint:unknown-directive-warns"
    (map _.name (directiveLints (dirsOf "{{! @foobar:1 }}{{! @trim:none }}x")) == [ "foobar" ])
  assert' "lint:known-directives-silent"
    (Array.null (directiveLints (dirsOf "{{! @truthiness:minimal }}{{! @trim:standalone }}x")))
  -- a partial whose mode differs from the caller warns; a matching mode is silent.
  assert' "lint:cross-boundary-mismatch"
    ( map _.name
        (crossBoundaryWarnings handlebars [ Tuple "card" minimal, Tuple "same" handlebars ])
        == [ "card" ]
    )
  -- a rejected @truthiness carries the offending directive's source offset.
  case resolveTruthiness (dirsOf "{{! @truthiness:bogus }}x") of
    Left (DirectiveError msg off) ->
      assert' ("lint:located-error " <> msg <> " @" <> show off)
        (off == 4 && contains (Pattern "bogus") msg)
    _ -> assert' "lint:located-error expected a located DirectiveError" false

  -- `{{else}}` is a name-agnostic *separator*: the lexer/parser keep it as a
  -- meaningless marker, and the engine's `if`/`each`/`with` split their body at
  -- it. The word `else` never lands in the lexer or parser.
  expect "if-else-true" "{{#if this}}yes{{else}}no{{/if}}" (VBool true) "yes"
  expect "if-else-false" "{{#if this}}yes{{else}}no{{/if}}" (VBool false) "no"
  expect "if-else-tilde" "{{#if this}}yes {{~else~}} no{{/if}}" (VBool false) "no"

  -- A standalone separator renders to nothing (the `else` marker is inert);
  -- only an enclosing block helper gives it meaning.
  expect "standalone-else" "a{{else}}c" VNull "ac"

  -- A second {{else}} is rejected as unreachable (the dead-code guard that also
  -- protects an elif-after-else), rather than silently dropped.
  expectError "if-double-else" "{{#if this}}A{{else}}B{{else}}C{{/if}}" (VBool false)

  -- else-if is expressed by nesting; it lowers/renders as a chain.
  expect "else-if-chain"
    "{{#if (lookup this \"a\")}}A{{else}}{{#if (lookup this \"b\")}}B{{else}}C{{/if}}{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool true) ])
    "B"
  expect "else-if-chain-fall"
    "{{#if (lookup this \"a\")}}A{{else}}{{#if (lookup this \"b\")}}B{{else}}C{{/if}}{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool false) ])
    "C"

  -- Native {{elif}} chain (flat, no nesting): the engine's `if` reads the clauses.
  let
    elifChain =
      "{{#if (lookup this \"a\")}}A{{elif (lookup this \"b\")}}B{{elif (lookup this \"c\")}}C{{else}}D{{/if}}"
  expect "elif-first" elifChain
    (obj [ Tuple "a" (VBool true), Tuple "b" (VBool false), Tuple "c" (VBool false) ])
    "A"
  expect "elif-mid" elifChain
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool true), Tuple "c" (VBool false) ])
    "B"
  expect "elif-late" elifChain
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool false), Tuple "c" (VBool true) ])
    "C"
  expect "elif-else" elifChain
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool false), Tuple "c" (VBool false) ])
    "D"
  -- No else: an all-falsy chain renders nothing.
  expect "elif-no-else" "{{#if (lookup this \"a\")}}A{{elif (lookup this \"b\")}}B{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool false) ])
    ""
  -- Short-circuit: a later elif condition is never evaluated once a branch is
  -- taken, so the unknown helper `nope` in it does not raise.
  expect "elif-short-circuit" "{{#if (lookup this \"a\")}}A{{elif nope}}B{{/if}}"
    (obj [ Tuple "a" (VBool true) ])
    "A"
  -- But it *does* raise when that branch is reached.
  expectError "elif-reached-error" "{{#if (lookup this \"a\")}}A{{elif nope}}B{{/if}}"
    (obj [ Tuple "a" (VBool false) ])
  -- An {{else}} that is not the final clause is rejected up front (dead code).
  expectError "elif-else-not-terminal"
    "{{#if (lookup this \"a\")}}A{{else}}B{{elif (lookup this \"c\")}}C{{/if}}"
    (obj [ Tuple "a" (VBool true) ])

  expect "each-array" "{{#each (lookup this \"xs\")}}[{{{this}}}={{{index}}}]{{/each}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b" ]) ])
    "[a=0][b=1]"

  expect "each-empty" "{{#each (lookup this \"xs\")}}x{{else}}empty{{/each}}"
    (obj [ Tuple "xs" (arr []) ])
    "empty"

  expect "each-first-last"
    "{{#each (lookup this \"xs\")}}{{#if first}}<{{/if}}{{{this}}}{{#if last}}>{{/if}}{{/each}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b", str "c" ]) ])
    "<abc>"

  expect "with" "{{#with (lookup this \"u\")}}{{{lookup this \"name\"}}}{{/with}}"
    (obj [ Tuple "u" (obj [ Tuple "name" (str "Grace") ]) ])
    "Grace"

  expect "with-parent" "{{#with (lookup this \"u\")}}{{{lookup (parent) \"top\"}}}{{/with}}"
    (obj [ Tuple "top" (str "T"), Tuple "u" (obj [ Tuple "name" (str "x") ]) ])
    "T"

  expect "raw-block" "{{{{#raw}}}}{{name}} stays{{{{/raw}}}}" VNull "{{name}} stays"
  -- the Handlebars raw-block form (no `#`) lexes identically.
  expect "raw-block-no-hash" "{{{{raw}}}}{{name}} stays{{{{/raw}}}}" VNull "{{name}} stays"

  -- Handlebars-extra shapes (FullBars accepts). The inverted section {{^x}}
  -- desugars to {{#unless x}}; the triple variant {{{^x}}} is the same.
  expectS "inverse-section" "{{^admin}}guest{{/admin}}" (obj [ Tuple "admin" (VBool false) ])
    "guest"
  expectS "inverse-true" "{{^admin}}guest{{/admin}}" (obj [ Tuple "admin" (VBool true) ]) ""
  expectS "inverse-triple" "{{{^admin}}}guest{{{/admin}}}" (obj [ Tuple "admin" (VBool false) ])
    "guest"
  -- {{&x}} is unescaped output (= {{{x}}}), distinct from escaped {{x}}.
  expectS "ampersand-unescaped" "{{& html }}" (obj [ Tuple "html" (str "<b>") ]) "<b>"
  expectS "double-escapes" "{{ html }}" (obj [ Tuple "html" (str "<b>") ]) "&lt;b&gt;"

  expect "comment" "a{{! ignored }}b" VNull "ab"
  expect "long-comment" "a{{!-- ig}}nored --}}b" VNull "ab"

  expect "escape-opener" "\\{{{x}}}" VNull "{{{x}}}"

  expect "ws-control" "{{~#if this~}}  yes  {{~/if~}}" (VBool true) "yes"

  expect "eq-true" "{{#if (eq (lookup this \"a\") (lookup this \"b\"))}}same{{/if}}"
    (obj [ Tuple "a" (str "x"), Tuple "b" (str "x") ])
    "same"

  -- Comparison & boolean value helpers. `lt`/`gt`/`lte`/`gte` order numbers and
  -- strings; mixed/other types are incomparable (false).
  expect "eq-num" "{{{eq 1 1}}}" VNull "true"
  expect "ne-num" "{{{ne 1 2}}}" VNull "true"
  expect "ne-false" "{{{ne 1 1}}}" VNull "false"
  expect "gt-true" "{{{gt 3 2}}}" VNull "true"
  expect "gt-false" "{{{gt 2 3}}}" VNull "false"
  expect "lt-true" "{{{lt 2 3}}}" VNull "true"
  expect "gte-eq" "{{{gte 2 2}}}" VNull "true"
  expect "gte-lt" "{{{gte 1 2}}}" VNull "false"
  expect "lte-eq" "{{{lte 2 2}}}" VNull "true"
  expect "gt-strings" "{{{gt \"b\" \"a\"}}}" VNull "true"
  expect "gt-incomparable" "{{{gt 1 \"x\"}}}" VNull "false"
  expect "and-true" "{{{and true true}}}" VNull "true"
  expect "and-false" "{{{and true false}}}" VNull "false"
  expect "or-true" "{{{or false true}}}" VNull "true"
  expect "not-true" "{{{not false}}}" VNull "true"

  expect "dict-apply" "{{{lookup (dict \"k\" \"v\") \"k\"}}}" VNull "v"

  -- Number stringify: integral values render without a trailing ".0", including
  -- integers beyond Int's 32-bit range; fractionals are preserved.
  expect "num-int" "{{{this}}}" (VNumber 42.0) "42"
  expect "num-zero" "{{{this}}}" (VNumber 0.0) "0"
  expect "num-large-int" "{{{this}}}" (VNumber 1000000000000.0) "1000000000000"
  expect "num-frac" "{{{this}}}" (VNumber 3.5) "3.5"

  expectError "unknown-helper" "{{{nope}}}" VNull
  expectError "mismatched-block" "{{#if this}}x{{/each}}" (VBool true)
  expectError "empty-output" "{{{}}}" VNull

  -- Surface dialect (surface.adoc §5.1–5.3): `{{ }}` auto-escapes, `{{{ }}}`
  -- stays raw, and bare/dotted/numeric/parent paths become `lookup` chains.
  expectS "surface-escape" "{{ name }}" (obj [ Tuple "name" (str "<b>") ]) "&lt;b&gt;"
  expectS "surface-raw" "{{{ name }}}" (obj [ Tuple "name" (str "<b>") ]) "<b>"
  expectS "surface-dotted" "{{ user.name }}"
    (obj [ Tuple "user" (obj [ Tuple "name" (str "Ada") ]) ])
    "Ada"
  expectS "surface-index" "{{ xs.1 }}" (obj [ Tuple "xs" (arr [ str "a", str "b" ]) ]) "b"
  -- the MaxBars-only loop-variable guarantee: in FullBars a bare loop-variable
  -- *name* is a plain data path, NOT the loop datum. `{{index0}}` reads the field
  -- "index0" (the loop index is `{{@index}}` here); MaxBars is the dialect that
  -- makes bare `{{index0}}` the scoped variable.
  expectS "surface-loopvar-name-is-data" "{{#each xs}}{{index0}}{{/each}}"
    (obj [ Tuple "xs" (arr [ obj [ Tuple "index0" (str "DATA") ], obj [] ]) ])
    "DATA"
  -- bracket segments: keys with spaces/dots, and a leading bracket.
  expectS "surface-bracket-space" "{{ user.[full name] }}"
    (obj [ Tuple "user" (obj [ Tuple "full name" (str "Ada L") ]) ])
    "Ada L"
  expectS "surface-bracket-lead" "{{ [home town] }}"
    (obj [ Tuple "home town" (str "Lovelace") ])
    "Lovelace"
  expectS "surface-bracket-dots" "{{ m.[a.b] }}"
    (obj [ Tuple "m" (obj [ Tuple "a.b" (str "v") ]) ])
    "v"
  expectS "surface-bracket-index" "{{ a.[1] }}"
    (obj [ Tuple "a" (arr [ str "x", str "y" ]) ])
    "y"
  expectS "surface-this" "{{#each items}}[{{ . }}]{{/each}}"
    (obj [ Tuple "items" (arr [ str "x", str "y" ]) ])
    "[x][y]"
  expectS "surface-parent" "{{#with user}}{{ ../title }}:{{ name }}{{/with}}"
    (obj [ Tuple "title" (str "Dr"), Tuple "user" (obj [ Tuple "name" (str "Ada") ]) ])
    "Dr:Ada"
  expectS "surface-if-clause" "{{#if loggedIn}}hi{{else}}bye{{/if}}"
    (obj [ Tuple "loggedIn" (VBool true) ])
    "hi"
  expectS "surface-literal" "{{ true }}" VNull "true"

  -- @data variables (§5.5): scoped-helper calls installed by each / the host.
  expectS "surface-at-index" "{{#each xs}}{{@index}}:{{ . }};{{/each}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b" ]) ])
    "0:a;1:b;"
  expectS "surface-at-key" "{{#each o}}{{@key}}={{ . }};{{/each}}"
    (obj [ Tuple "o" (obj [ Tuple "a" (str "1") ]) ])
    "a=1;"
  expectS "surface-at-firstlast"
    "{{#each xs}}{{#if @first}}<{{/if}}{{ . }}{{#if @last}}>{{/if}}{{/each}}"
    (obj [ Tuple "xs" (arr [ str "x", str "y" ]) ])
    "<xy>"
  expectS "surface-at-root" "{{#each xs}}{{@root.title}};{{/each}}"
    (obj [ Tuple "title" (str "T"), Tuple "xs" (arr [ str "a" ]) ])
    "T;"
  -- @../ parent-data: a nested loop reads the enclosing loop's index/key/etc.
  expectS "surface-at-parent-index"
    "{{#each rows}}{{#each this}}[{{@../index}}-{{@index}}:{{ . }}]{{/each}}{{/each}}"
    (obj [ Tuple "rows" (arr [ arr [ str "a", str "b" ], arr [ str "c" ] ]) ])
    "[0-0:a][0-1:b][1-0:c]"
  expectS "surface-at-parent-key"
    "{{#each outer}}{{#each this}}{{@../key}}.{{@key}};{{/each}}{{/each}}"
    (obj [ Tuple "outer" (obj [ Tuple "g" (obj [ Tuple "a" (str "1"), Tuple "b" (str "2") ]) ]) ])
    "g.a;g.b;"
  expectS "surface-at-parent-first-last"
    "{{#each rows}}{{#each this}}{{#if @../first}}F{{/if}}{{#if @../last}}L{{/if}};{{/each}}{{/each}}"
    (obj [ Tuple "rows" (arr [ arr [ str "a" ], arr [ str "b" ] ]) ])
    "F;L;"

  -- else if (§5.6): lowers to nested if blocks in the else clause.
  expectS "surface-elseif-mid" "{{#if a}}A{{else if b}}B{{else}}C{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool true) ])
    "B"
  expectS "surface-elseif-else" "{{#if a}}A{{else if b}}B{{else}}C{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool false) ])
    "C"
  expectS "surface-elseif-chain" "{{#if a}}A{{else if b}}B{{else if c}}C{{else}}D{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool false), Tuple "c" (VBool true) ])
    "C"

  -- Block params (§5.5): `as |a b|` binds the element/index (each) or context
  -- (with) to named helpers; a bare reference becomes a `(name)` call.
  expectS "surface-blockparam-1" "{{#each xs as |item|}}[{{ item }}]{{/each}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b" ]) ])
    "[a][b]"
  expectS "surface-blockparam-2" "{{#each xs as |item idx|}}{{ idx }}:{{ item }};{{/each}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b" ]) ])
    "0:a;1:b;"
  expectS "surface-blockparam-obj" "{{#each o as |v k|}}{{ k }}={{ v }};{{/each}}"
    (obj [ Tuple "o" (obj [ Tuple "x" (str "1") ]) ])
    "x=1;"
  expectS "surface-blockparam-with" "{{#with user as |u|}}{{ u.name }}{{/with}}"
    (obj [ Tuple "user" (obj [ Tuple "name" (str "Ada") ]) ])
    "Ada"
  -- nested: the outer block param stays in scope inside an inner block.
  expectS "surface-blockparam-nested"
    "{{#each rows as |row|}}{{#each row.cells as |c|}}{{ c }}@{{ row.id }} {{/each}}{{/each}}"
    (obj [ Tuple "rows" (arr [ obj [ Tuple "id" (str "r1"), Tuple "cells" (arr [ str "a" ]) ] ]) ])
    "a@r1 "

  -- Partials (§5.7): {{> name [ctx]}} renders a registered partial (unescaped
  -- markup), with escaping applied to {{ }} inside the partial body.
  expectP "partial-static" [ Tuple "greet" "Hi {{ name }}" ] "{{> greet}}"
    (obj [ Tuple "name" (str "<Ada>") ])
    "Hi &lt;Ada&gt;"
  expectP "partial-ctx" [ Tuple "row" "<li>{{ . }}</li>" ]
    "{{#each items}}{{> row this}}{{/each}}"
    (obj [ Tuple "items" (arr [ str "a", str "b" ]) ])
    "<li>a</li><li>b</li>"
  expectP "partial-nospace" [ Tuple "p" "X" ] "{{>p}}" VNull "X"
  -- hash context (§5.7/§5.4): k=v pairs merge onto the partial's context.
  expectP "partial-hash" [ Tuple "nav" "<h1>{{ title }}</h1>" ] "{{> nav title=\"Home\"}}" VNull
    "<h1>Home</h1>"
  expectP "partial-hash-override" [ Tuple "card" "{{ name }}:{{ role }}" ]
    "{{> card role=\"Admin\"}}"
    (obj [ Tuple "name" (str "Ada"), Tuple "role" (str "User") ])
    "Ada:Admin"
  expectP "partial-ctx-hash" [ Tuple "row" "{{ label }}={{ n }}" ]
    "{{> row this n=42}}"
    (obj [ Tuple "label" (str "x") ])
    "x=42"
  expectP "partial-dynamic" [ Tuple "a" "A", Tuple "b" "B" ]
    "{{> (lookup this \"which\")}}"
    (obj [ Tuple "which" (str "b") ])
    "B"
  -- a missing partial is a render error.
  case renderSurfaceWith [] "{{> nope}}" VNull of
    Left _ -> pure unit
    Right out -> assert' ("partial-missing: expected error, got " <> show out) false

  -- A self-including partial recurses forever; the shared kernel depth guard
  -- caps it with a located error rather than overflowing the stack (no hang).
  case renderSurfaceWith [ Tuple "self" "{{> self}}" ] "{{> self}}" VNull of
    Left _ -> pure unit
    Right out -> assert' ("partial-recursion: expected error, got " <> show out) false
  -- Bounded nesting (well under the budget) still renders normally.
  expectP "partial-bounded-nesting"
    [ Tuple "a" "[{{> b}}]", Tuple "b" "{{ name }}" ]
    "{{> a}}"
    (obj [ Tuple "name" (str "ok") ])
    "[ok]"

  -- Block partials: {{#partial name}}body{{/partial}} renders the partial with
  -- the body exposed as {{> @partial-block}}, or renders the body as fallback if
  -- the partial is missing.
  expectP "block-partial-yield" [ Tuple "layout" "<div>{{> @partial-block}}</div>" ]
    "{{#partial \"layout\"}}<b>{{ name }}</b>{{/partial}}"
    (obj [ Tuple "name" (str "Ada") ])
    "<div><b>Ada</b></div>"
  expectS "block-partial-fallback" "{{#partial \"missing\"}}<i>fb</i>{{/partial}}" VNull "<i>fb</i>"

  -- Inline partials: {{#inline "name"}}body{{/inline}} defines a partial (hoisted
  -- before render) usable by later {{> name}}; a bare name is literalized.
  expectS "inline-partial" "{{#inline \"row\"}}[{{ . }}]{{/inline}}{{#each xs}}{{> row}}{{/each}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b" ]) ])
    "[a][b]"
  expectS "inline-partial-unquoted" "{{#inline greet}}hi {{ name }}{{/inline}}{{> greet}}"
    (obj [ Tuple "name" (str "Bo") ])
    "hi Bo"

  -- Handlebars block-partial sigil {{#> name}}…{{/name}} (FullBars only): desugars
  -- to the SAME core form as the {{#partial name}}…{{/partial}} spelling, so the
  -- two render identically (a registered `greeting` partial yields the body via
  -- {{> @partial-block}}; the close is matched by the headed name `greeting`).
  expectP "block-partial-sigil" [ Tuple "greeting" "<div>{{> @partial-block}}</div>" ]
    "{{#> greeting}}<b>{{ name }}</b>{{/greeting}}"
    (obj [ Tuple "name" (str "Ada") ])
    "<div><b>Ada</b></div>"
  expectP "block-partial-sigil-matches-partial-spelling"
    [ Tuple "greeting" "<div>{{> @partial-block}}</div>" ]
    "{{#partial \"greeting\"}}<b>{{ name }}</b>{{/partial}}"
    (obj [ Tuple "name" (str "Ada") ])
    "<div><b>Ada</b></div>"

  -- inline-partial decorator {{#*inline "name"}}…{{/inline}} (FullBars only):
  -- desugars to the SAME core form as {{#inline "name"}}…{{/inline}}; the lexer
  -- keeps `inline` as the head and `"row"` as its sole argument, so the close
  -- {{/inline}} matches by the headed name.
  expectS "inline-decorator-sigil"
    "{{#*inline \"row\"}}[{{ . }}]{{/inline}}{{#each xs}}{{> row}}{{/each}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b" ]) ])
    "[a][b]"
  expectS "inline-decorator-matches-inline-spelling"
    "{{#inline \"row\"}}[{{ . }}]{{/inline}}{{#each xs}}{{> row}}{{/each}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b" ]) ])
    "[a][b]"

  -- a {{#> name}} whose partial is missing renders its body as the fallback
  -- (the {{#partial}} block-body fallback, reached through the sigil).
  expectS "block-partial-sigil-fallback" "{{#> missing}}<i>fb</i>{{/missing}}" VNull "<i>fb</i>"

  -- the {{#>}} sigil is meaningful only in FullBars: the core parses it (the
  -- `>`-headed block closes on the partial name via `blockCloseName`) but RawBars
  -- has no surface to map `>` onto `partial`, so it fails at render (unknown
  -- helper `>`) — a Left, just at render rather than parse.
  assert' "block-partial-core-has-no-meaning"
    (isLeft (renderCore "{{#> x}}body{{/x}}" VNull))

  -- Hash arguments (§5.4): key=value pairs collect into a trailing `dict`, which
  -- the if/unless `includeZero` option consumes (the existing dict mechanism).
  expectS "surface-hash-includeZero" "{{#if n includeZero=true}}y{{else}}m{{/if}}"
    (obj [ Tuple "n" (VNumber 0.0) ])
    "y"
  expectS "surface-no-hash-zero" "{{#if n}}y{{else}}m{{/if}}"
    (obj [ Tuple "n" (VNumber 0.0) ])
    "m"

  -- desugarSurface produces the documented core expressions.
  case (desugarSurface <<< _.nodes) <$> parse "{{ user.name }}" of
    Right [ Output _ e ] ->
      assert' ("desugar path: " <> show e)
        ( e == App "escapeHtml"
            [ App "lookup" [ App "this" [], Lit (VString "user"), Lit (VString "name") ] ]
        )
    _ -> assert' "desugar: unexpected shape" false

  -- positional + glued hash: {{ f a k=v }} ⇒ f (lookup this "a") (dict "k" …)
  case (desugarSurface <<< _.nodes) <$> parse "{{ f a k=v }}" of
    Right [ Output _ e ] ->
      assert' ("desugar hash: " <> show e)
        ( e == App "escapeHtml"
            [ App "f"
                [ App "lookup" [ App "this" [], Lit (VString "a") ]
                , App "dict"
                    [ Lit (VString "k"), App "lookup" [ App "this" [], Lit (VString "v") ] ]
                ]
            ]
        )
    _ -> assert' "desugar hash: unexpected shape" false

  -- quoted hash value (the value is the next token): {{ f g="hi" }}
  case (desugarSurface <<< _.nodes) <$> parse "{{ f g=\"hi\" }}" of
    Right [ Output _ e ] ->
      assert' ("desugar hash quoted: " <> show e)
        ( e == App "escapeHtml"
            [ App "f" [ App "dict" [ Lit (VString "g"), Lit (VString "hi") ] ] ]
        )
    _ -> assert' "desugar hash quoted: unexpected shape" false

  -- Skeleton-AST validation (the engine-supplied second pass).
  expectValid "validate-clean"
    "{{#each (lookup this \"xs\")}}{{{escapeHtml this}}}{{else}}none{{/each}}"
  expectIssue "validate-unknown" "{{{frobnicate this}}}"
  expectIssue "validate-arity" "{{{escapeHtml}}}"

  -- foldTemplate: a catamorphism over the skeleton (the "prepare" half of the
  -- engine API). Here we count nodes, recursing into block bodies.
  let
    counter =
      { content: \_ -> 1
      , output: \_ -> 1
      , raw: \_ _ _ -> 1
      , sep: \_ _ -> 1
      , block: \b -> 1 + b.recurse b.children
      , concat: Array.foldl (+) 0
      }
  case parse "a{{#each x}}b{{{this}}}{{/each}}c" of
    Left e -> assert' ("foldTemplate: parse error " <> show e) false
    Right { nodes: t } -> assert' "foldTemplate node count" (foldTemplate counter t == 5)

  -- Pluggable env: the same driver runs a custom engine whose env is a Value.
  case parse "{{{shout this}}}" of
    Left e -> assert' ("custom-engine: parse error " <> show e) false
    Right { nodes: t } -> assert' "custom-engine pluggable env"
      (runTemplate (customEngine (VString "hi")) t == Right "HI")

  -- Source spans: tag-level nodes carry their span; helpers see it via Ctl.span.
  case parse "  {{{this}}}" of
    Right { nodes: [ _, Output sp _ ] } -> do
      assert' "span offsets" (sp.start == 2 && sp.end == 12)
      assert' "spanText" (spanText "  {{{this}}}" sp == "{{{this}}}")
    _ -> assert' "span: unexpected parse shape" false
  case parse "{{{at}}}" of
    Left e -> assert' ("ctl.span: parse error " <> show e) false
    Right { nodes: t } -> assert' "ctl.span visible to helper"
      (runTemplate (customEngine VNull) t == Right "0")

  -- lower: the structural skeleton becomes the typed real AST — {{else}} is
  -- consumed into RIf's branches, and escapeHtml becomes the escaped flag.
  case parse "{{#if this}}A{{{escapeHtml (lookup this \"x\")}}}{{else}}B{{/if}}" of
    Left e -> assert' ("lower: parse error " <> show e) false
    Right { nodes: t } -> assert' ("lower if/else+escape: " <> show (lower t))
      ( lower t ==
          [ RIf (App "this" [])
              [ RText "A", ROut true (App "lookup" [ App "this" [], Lit (VString "x") ]) ]
              [ RText "B" ]
          ]
      )

  -- Safe-by-default lint: raw output of data warns; escapeHtml / safe do not.
  case parse "{{{lookup this \"x\"}}}" of
    Right { nodes: t } -> assert' "escaping lint flags raw data"
      (not (Array.null (escapingWarnings t)))
    Left e -> assert' ("lint: parse error " <> show e) false
  case parse "{{{escapeHtml (lookup this \"x\")}}}{{{safe (lookup this \"y\")}}}" of
    Right { nodes: t } -> assert' "escaping lint silent for escapeHtml/safe"
      (Array.null (escapingWarnings t))
    Left e -> assert' ("lint: parse error " <> show e) false

  -- Lint: testing the truthiness of an escaped/safe value is a smell (safe/
  -- escapeHtml stringify, so e.g. `safe 0` is truthy while `0` is falsy).
  case parse "{{#if (safe (lookup this \"x\"))}}y{{/if}}" of
    Right { nodes: t } -> assert' "lint flags if-on-safe" (not (Array.null (escapingWarnings t)))
    Left e -> assert' ("lint: parse error " <> show e) false
  case parse "{{#unless (escapeHtml (lookup this \"x\"))}}y{{/unless}}" of
    Right { nodes: t } -> assert' "lint flags unless-on-escapeHtml"
      (not (Array.null (escapingWarnings t)))
    Left e -> assert' ("lint: parse error " <> show e) false
  -- Testing the underlying data directly is clean.
  case parse "{{#if (lookup this \"x\")}}y{{/if}}" of
    Right { nodes: t } -> assert' "lint silent for if-on-data" (Array.null (escapingWarnings t))
    Left e -> assert' ("lint: parse error " <> show e) false

  -- Schema/runtime conformance: prelude and preludeSchema are projections of one
  -- HelperDef table, so for every combinator-built value helper the runtime
  -- arity guard must agree exactly with the schema's declared arity. Drive each
  -- with 0–3 args (the helper ignores the control handle) and assert that it
  -- raises an ArityError precisely when the schema arity rejects that count.
  let
    runMap =
      Map.fromFoldable prelude :: Map.Map String (Helper (Either Error) (RefEnv (Either Error)))
    valueHelpers =
      [ "true"
      , "false"
      , "null"
      , "escapeHtml"
      , "safe"
      , "else"
      , "eq"
      , "not"
      , "and"
      , "or"
      , "log"
      ]
  for_ valueHelpers \name ->
    case Map.lookup name preludeSchema.helpers, Map.lookup name runMap of
      Just spec, Just run ->
        for_ [ 0, 1, 2, 3 ] \k ->
          let
            threw = case run dummyCtl (Array.replicate k VNull) of
              Left (ArityError _) -> true
              _ -> false
          in
            assert' ("arity conformance: " <> name <> "/" <> show k)
              (threw == not (arityOk spec.arity k))
      _, _ -> assert' ("arity conformance: missing helper " <> name) false

  -- Separability of the value-primitive pack (helper-packs-spec §4, P0 intent):
  -- the primitives are a genuinely detachable set, not fused into core. A schema
  -- built from `coreHelperDefs` alone does NOT know `uppercase` (a primitive),
  -- while the full `preludeSchema` does. The core helpers must still be present
  -- in both (the split only moves the primitives out).
  assert' "separability: coreSchema omits the primitive 'uppercase'"
    (not (Map.member "uppercase" KP.coreSchema.helpers))
  assert' "separability: preludeSchema includes the primitive 'uppercase'"
    (Map.member "uppercase" KP.preludeSchema.helpers)
  assert' "separability: every primitive (e.g. slice/truncate) is absent from coreSchema"
    ( not
        ( Array.any (\n -> Map.member n KP.coreSchema.helpers)
            [ "lowercase", "capitalize", "split", "slice", "truncate", "append", "prepend" ]
        )
    )
  assert' "separability: every primitive is present in preludeSchema"
    ( Array.all (\n -> Map.member n KP.preludeSchema.helpers)
        [ "lowercase"
        , "uppercase"
        , "capitalize"
        , "trim"
        , "trimStart"
        , "trimEnd"
        , "split"
        , "replace"
        , "slice"
        , "includes"
        , "startsWith"
        , "endsWith"
        , "truncate"
        , "append"
        , "prepend"
        , "downcase"
        , "upcase"
        , "abs"
        , "floor"
        , "ceil"
        , "round"
        , "toFixed"
        , "toInt"
        , "toFloat"
        , "join"
        , "count"
        , "size"
        , "at"
        , "take"
        , "takeRight"
        , "reverse"
        , "unique"
        , "sortBy"
        , "pluck"
        , "groupBy"
        ]
    )
  assert' "separability: a core helper (e.g. 'if') survives the split in coreSchema"
    (Map.member "if" KP.coreSchema.helpers)
  -- `coreHelperDefs` is the non-primitive base; the full roster adds exactly the
  -- 35-strong primitive pack on top (string + number + array, incl. aliases).
  assert' "separability: helperDefs = coreHelperDefs <> primitiveHelperDefs (35 primitives)"
    (Map.size KP.preludeSchema.helpers == Map.size KP.coreSchema.helpers + 35)

  -- Pluggable monad: the reference engine also runs in `ExceptT Error Aff`.
  launchAff_ do
    let dat = obj [ Tuple "name" (str "Ada") ]
    out <- runExceptT
      (runString (refEngine (preludeEnv dat)) "Hi {{{escapeHtml (lookup this \"name\")}}}")
    liftEffect $ assert' ("aff render: " <> show out) (out == Right "Hi Ada")

  log "all core tests passed"
