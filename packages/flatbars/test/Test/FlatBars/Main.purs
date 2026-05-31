-- | FlatBars engine test suite (`spago test -p flatbars`).
-- |
-- | Exercises the reference engine end to end — rendering, the `lower` real AST,
-- | the escaping lint, the Aff instantiation, and a pluggable-env engine — over
-- | the BareBars framework (parse/foldTemplate/spans).
module Test.FlatBars.Main where

import Prelude

import BareBars (Ctl, Engine, Helper, foldTemplate, parse, runTemplate, spanText, validate)
import BareBars.Error (Error(..))
import BareBars.Syntax (Expr(..), Node(..))
import BareBars.Value (Value(..))
import BareBars.Walk (arityOk)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Foldable (for_)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.String (toUpper)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Aff (launchAff_)
import Effect.Class (liftEffect)
import Effect.Console (log)
import FlatBars (RNode(..), RefEnv, desugarSurface, emptyEnv, escapingWarnings, lower, prelude, preludeSchema, renderAff, renderSurface, renderSurfaceWith, renderWith, stringify, truthy)
import Test.Assert (assert')

-- A minimal control handle for exercising helpers that ignore it (the value
-- helpers under arity-conformance). Renders nothing; has an empty clause.
dummyCtl :: Ctl (Either Error) (RefEnv (Either Error))
dummyCtl =
  { env: emptyEnv VNull
  , children: []
  , span: { start: 0, end: 0 }
  , render: \_ _ -> Right ""
  , clause: \_ -> { before: [], body: Nothing }
  }

obj :: Array (Tuple String Value) -> Value
obj = VObject <<< Map.fromFoldable

arr :: Array Value -> Value
arr = VArray

str :: String -> Value
str = VString

-- | Assert that `src` rendered against `dat` yields `expected`.
expect :: String -> String -> Value -> String -> Effect Unit
expect name src dat expected =
  case renderWith src dat of
    Left err -> assert' (name <> ": unexpected error: " <> err) false
    Right out -> assert' (name <> ": expected " <> show expected <> " got " <> show out)
      (out == expected)

-- | Assert that `src` fails to render (parse or eval error).
expectError :: String -> String -> Value -> Effect Unit
expectError name src dat = case renderWith src dat of
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
  Right t ->
    let
      issues = validate preludeSchema t
    in
      assert' (name <> ": expected no issues, got " <> show (map _.message issues))
        (Array.null issues)

-- | Assert that `src` parses but the schema validation reports at least one issue.
expectIssue :: String -> String -> Effect Unit
expectIssue name src = case parse src of
  Left e -> assert' (name <> ": expected a validation issue, but got parse error " <> show e) false
  Right t -> assert' (name <> ": expected a validation issue")
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

  expect "esc-html" "{{{esc_html (lookup this \"x\")}}}"
    (obj [ Tuple "x" (str "<b>&\"'") ])
    "&lt;b&gt;&amp;&quot;&#x27;"

  expect "subexpr" "{{{esc_html (lookup this \"name\")}}}"
    (obj [ Tuple "name" (str "A<B") ])
    "A&lt;B"

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
      (truthy (VSafe s) == truthy (VString s))

  -- `{{else}}` is a name-agnostic *separator*: the lexer/parser keep it as a
  -- meaningless marker, and the engine's `if`/`each`/`with` split their body at
  -- it. The word `else` never lands in the lexer or parser.
  expect "if-else-true" "{{#if this}}yes{{else}}no{{/if}}" (VBool true) "yes"
  expect "if-else-false" "{{#if this}}yes{{else}}no{{/if}}" (VBool false) "no"
  expect "if-else-tilde" "{{#if this}}yes {{~else~}} no{{/if}}" (VBool false) "no"

  -- A standalone separator renders to nothing (the `else` marker is inert);
  -- only an enclosing block helper gives it meaning.
  expect "standalone-else" "a{{else}}c" VNull "ac"

  -- A second {{else}} opens its own clause (splitClauses); `if` renders only the
  -- first else clause, so the trailing section does not leak in.
  expect "if-double-else" "{{#if this}}A{{else}}B{{else}}C{{/if}}" (VBool false) "B"

  -- else-if is expressed by nesting; it lowers/renders as a chain.
  expect "else-if-chain"
    "{{#if (lookup this \"a\")}}A{{else}}{{#if (lookup this \"b\")}}B{{else}}C{{/if}}{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool true) ])
    "B"
  expect "else-if-chain-fall"
    "{{#if (lookup this \"a\")}}A{{else}}{{#if (lookup this \"b\")}}B{{else}}C{{/if}}{{/if}}"
    (obj [ Tuple "a" (VBool false), Tuple "b" (VBool false) ])
    "C"

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

  expect "comment" "a{{! ignored }}b" VNull "ab"
  expect "long-comment" "a{{!-- ig}}nored --}}b" VNull "ab"

  expect "escape-opener" "\\{{{x}}}" VNull "{{{x}}}"

  expect "ws-control" "{{~#if this~}}  yes  {{~/if~}}" (VBool true) "yes"

  expect "eq-true" "{{#if (eq (lookup this \"a\") (lookup this \"b\"))}}same{{/if}}"
    (obj [ Tuple "a" (str "x"), Tuple "b" (str "x") ])
    "same"

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
  expectP "partial-dynamic" [ Tuple "a" "A", Tuple "b" "B" ]
    "{{> (lookup this \"which\")}}"
    (obj [ Tuple "which" (str "b") ])
    "B"
  -- a missing partial is a render error.
  case renderSurfaceWith [] "{{> nope}}" VNull of
    Left _ -> pure unit
    Right out -> assert' ("partial-missing: expected error, got " <> show out) false

  -- Hash arguments (§5.4): key=value pairs collect into a trailing `dict`, which
  -- the if/unless `includeZero` option consumes (the existing dict mechanism).
  expectS "surface-hash-includeZero" "{{#if n includeZero=true}}y{{else}}m{{/if}}"
    (obj [ Tuple "n" (VNumber 0.0) ])
    "y"
  expectS "surface-no-hash-zero" "{{#if n}}y{{else}}m{{/if}}"
    (obj [ Tuple "n" (VNumber 0.0) ])
    "m"

  -- desugarSurface produces the documented core expressions.
  case desugarSurface <$> parse "{{ user.name }}" of
    Right [ Output _ e ] ->
      assert' ("desugar path: " <> show e)
        ( e == App "esc_html"
            [ App "lookup" [ App "this" [], Lit (VString "user"), Lit (VString "name") ] ]
        )
    _ -> assert' "desugar: unexpected shape" false

  -- positional + glued hash: {{ f a k=v }} ⇒ f (lookup this "a") (dict "k" …)
  case desugarSurface <$> parse "{{ f a k=v }}" of
    Right [ Output _ e ] ->
      assert' ("desugar hash: " <> show e)
        ( e == App "esc_html"
            [ App "f"
                [ App "lookup" [ App "this" [], Lit (VString "a") ]
                , App "dict"
                    [ Lit (VString "k"), App "lookup" [ App "this" [], Lit (VString "v") ] ]
                ]
            ]
        )
    _ -> assert' "desugar hash: unexpected shape" false

  -- quoted hash value (the value is the next token): {{ f g="hi" }}
  case desugarSurface <$> parse "{{ f g=\"hi\" }}" of
    Right [ Output _ e ] ->
      assert' ("desugar hash quoted: " <> show e)
        ( e == App "esc_html"
            [ App "f" [ App "dict" [ Lit (VString "g"), Lit (VString "hi") ] ] ]
        )
    _ -> assert' "desugar hash quoted: unexpected shape" false

  -- Skeleton-AST validation (the engine-supplied second pass).
  expectValid "validate-clean"
    "{{#each (lookup this \"xs\")}}{{{esc_html this}}}{{else}}none{{/each}}"
  expectIssue "validate-unknown" "{{{frobnicate this}}}"
  expectIssue "validate-arity" "{{{esc_html}}}"

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
    Right t -> assert' "foldTemplate node count" (foldTemplate counter t == 5)

  -- Pluggable env: the same driver runs a custom engine whose env is a Value.
  case parse "{{{shout this}}}" of
    Left e -> assert' ("custom-engine: parse error " <> show e) false
    Right t -> assert' "custom-engine pluggable env"
      (runTemplate (customEngine (VString "hi")) t == Right "HI")

  -- Source spans: tag-level nodes carry their span; helpers see it via Ctl.span.
  case parse "  {{{this}}}" of
    Right [ _, Output sp _ ] -> do
      assert' "span offsets" (sp.start == 2 && sp.end == 12)
      assert' "spanText" (spanText "  {{{this}}}" sp == "{{{this}}}")
    _ -> assert' "span: unexpected parse shape" false
  case parse "{{{at}}}" of
    Left e -> assert' ("ctl.span: parse error " <> show e) false
    Right t -> assert' "ctl.span visible to helper"
      (runTemplate (customEngine VNull) t == Right "0")

  -- lower: the structural skeleton becomes the typed real AST — {{else}} is
  -- consumed into RIf's branches, and esc_html becomes the escaped flag.
  case parse "{{#if this}}A{{{esc_html (lookup this \"x\")}}}{{else}}B{{/if}}" of
    Left e -> assert' ("lower: parse error " <> show e) false
    Right t -> assert' ("lower if/else+escape: " <> show (lower t))
      ( lower t ==
          [ RIf (App "this" [])
              [ RText "A", ROut true (App "lookup" [ App "this" [], Lit (VString "x") ]) ]
              [ RText "B" ]
          ]
      )

  -- Safe-by-default lint: raw output of data warns; esc_html / safe do not.
  case parse "{{{lookup this \"x\"}}}" of
    Right t -> assert' "escaping lint flags raw data" (not (Array.null (escapingWarnings t)))
    Left e -> assert' ("lint: parse error " <> show e) false
  case parse "{{{esc_html (lookup this \"x\")}}}{{{safe (lookup this \"y\")}}}" of
    Right t -> assert' "escaping lint silent for esc_html/safe" (Array.null (escapingWarnings t))
    Left e -> assert' ("lint: parse error " <> show e) false

  -- Lint: testing the truthiness of an escaped/safe value is a smell (safe/
  -- esc_html stringify, so e.g. `safe 0` is truthy while `0` is falsy).
  case parse "{{#if (safe (lookup this \"x\"))}}y{{/if}}" of
    Right t -> assert' "lint flags if-on-safe" (not (Array.null (escapingWarnings t)))
    Left e -> assert' ("lint: parse error " <> show e) false
  case parse "{{#unless (esc_html (lookup this \"x\"))}}y{{/unless}}" of
    Right t -> assert' "lint flags unless-on-esc_html" (not (Array.null (escapingWarnings t)))
    Left e -> assert' ("lint: parse error " <> show e) false
  -- Testing the underlying data directly is clean.
  case parse "{{#if (lookup this \"x\")}}y{{/if}}" of
    Right t -> assert' "lint silent for if-on-data" (Array.null (escapingWarnings t))
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
      , "esc_html"
      , "safe"
      , "else"
      , "eq"
      , "eq?"
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

  -- Pluggable monad: the reference engine also runs in `ExceptT Error Aff`.
  launchAff_ do
    out <- renderAff "Hi {{{esc_html (lookup this \"name\")}}}" (obj [ Tuple "name" (str "Ada") ])
    liftEffect $ assert' ("aff render: " <> show out) (out == Right "Hi Ada")

  log "all core tests passed"
