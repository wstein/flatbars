-- | Core test suite. Run with `npm test` (or `spago test -p barebars`).
-- |
-- | These exercise the lexer/parser/evaluator and a representative slice of the
-- | reference prelude using core syntax (`{{{ … }}}`, blocks, raw blocks).
module Test.Main where

import Prelude

import BareBars (Engine, foldTemplate, parse, preludeSchema, renderAff, renderWith, runTemplate, spanText, stringify, validate)
import BareBars.Error (Error(..))
import BareBars.Syntax (Node(..))
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Either (Either(..))
import Data.Map as Map
import Data.String (toUpper)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Aff (launchAff_)
import Effect.Class (liftEffect)
import Effect.Console (log)
import Test.Assert (assert')

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

  -- Multi-branch control flow is *nested clause blocks* the engine interprets;
  -- `else` is the reference prelude's clause name, not a core keyword.
  expect "if-else-true" "{{#if this}}yes{{#else}}no{{/else}}{{/if}}" (VBool true) "yes"
  expect "if-else-false" "{{#if this}}yes{{#else}}no{{/else}}{{/if}}" (VBool false) "no"
  expect "if-then-else"
    "{{#if this}}{{#then}}A{{/then}}{{#else}}B{{/else}}{{/if}}"
    (VBool true)
    "A"
  expect "if-then-else-false"
    "{{#if this}}{{#then}}A{{/then}}{{#else}}B{{/else}}{{/if}}"
    (VBool false)
    "B"

  -- A double-stash {{ … }} is NOT a core construct: it is literal content.
  expect "double-stash-literal" "a{{b}}c" VNull "a{{b}}c"

  expect "each-array" "{{#each (lookup this \"xs\")}}[{{{this}}}={{{index}}}]{{/each}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b" ]) ])
    "[a=0][b=1]"

  expect "each-empty" "{{#each (lookup this \"xs\")}}x{{#else}}empty{{/else}}{{/each}}"
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

  expectError "unknown-helper" "{{{nope}}}" VNull
  expectError "mismatched-block" "{{#if this}}x{{/each}}" (VBool true)
  expectError "empty-output" "{{{}}}" VNull

  -- Skeleton-AST validation (the engine-supplied second pass).
  expectValid "validate-clean"
    "{{#each (lookup this \"xs\")}}{{{esc_html this}}}{{#else}}none{{/else}}{{/each}}"
  expectIssue "validate-unknown" "{{{frobnicate this}}}"
  expectIssue "validate-arity" "{{{esc_html}}}"

  -- foldTemplate: a catamorphism over the skeleton (the "prepare" half of the
  -- engine API). Here we count nodes, recursing into block bodies.
  let
    counter =
      { content: \_ -> 1
      , output: \_ -> 1
      , raw: \_ _ _ -> 1
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

  -- Pluggable monad: the reference engine also runs in `ExceptT Error Aff`.
  launchAff_ do
    out <- renderAff "Hi {{{esc_html (lookup this \"name\")}}}" (obj [ Tuple "name" (str "Ada") ])
    liftEffect $ assert' ("aff render: " <> show out) (out == Right "Hi Ada")

  log "all core tests passed"
