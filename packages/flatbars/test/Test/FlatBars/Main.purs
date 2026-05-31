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
import FlatBars (RNode(..), RefEnv, emptyEnv, escapingWarnings, lower, prelude, preludeSchema, renderAff, renderWith, stringify)
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

  -- `{{else}}` is a name-agnostic *separator*: the lexer/parser keep it as a
  -- meaningless marker, and the engine's `if`/`each`/`with` split their body at
  -- it. The word `else` never lands in the lexer or parser.
  expect "if-else-true" "{{#if this}}yes{{else}}no{{/if}}" (VBool true) "yes"
  expect "if-else-false" "{{#if this}}yes{{else}}no{{/if}}" (VBool false) "no"
  expect "if-else-tilde" "{{#if this}}yes {{~else~}} no{{/if}}" (VBool false) "no"

  -- A standalone separator renders to nothing (the `else` marker is inert);
  -- only an enclosing block helper gives it meaning.
  expect "standalone-else" "a{{else}}c" VNull "ac"

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
