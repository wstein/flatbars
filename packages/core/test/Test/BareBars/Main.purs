-- | BareBars *framework* test suite (`spago test -p barebars`).
-- |
-- | Structural only — parsing shapes, the foldTemplate catamorphism, clause
-- | splitting, schema validation, and source spans. No rendering: that is the
-- | engine's job and is tested in `fullbars`.
module Test.BareBars.Main where

import Prelude

import BareBars (Expr(..), Node(..), ParseError(..), Sigil(..), Value(..), defaultParseOptions, parse, parseErrorAt, parseWith, spanText)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Monoid (power)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import Kernel.ToValue (toValue)
import Kernel.Walk (Arity(..), foldExpr, foldTemplate, splitClause, splitClauses, validate)
import Test.Assert (assert')

-- A tiny engine schema: `if` is a 1-arg block, `c`/`x` are nullary.
schema
  :: { allowUnknown :: Boolean, helpers :: Map.Map String { block :: Boolean, arity :: Arity } }
schema =
  { allowUnknown: false
  , helpers: Map.fromFoldable
      [ Tuple "if" { block: true, arity: Exactly 1 }
      , Tuple "c" { block: false, arity: Exactly 0 }
      , Tuple "x" { block: false, arity: Exactly 0 }
      ]
  }

-- foldTemplate node counter (descends into block bodies).
nodeCount :: String -> Int
nodeCount src = case parse src of
  Left _ -> -1
  Right { nodes: t } -> foldTemplate
    { content: \_ -> 1
    , output: \_ -> 1
    , raw: \_ _ _ -> 1
    , sep: \_ _ -> 1
    , block: \b -> 1 + b.recurse b.children
    , concat: Array.foldl (+) 0
    }
    t

main :: Effect Unit
main = do
  log "BareBars framework tests"

  -- Well-formed parse, and the structural shapes the parser emits.
  case parse "a{{{x}}}{{#if c}}t{{else}}e{{/if}}" of
    Left e -> assert' ("parse: unexpected error " <> show e) false
    Right { nodes: t } -> do
      assert' "parse: content/output/block shapes"
        ( t ==
            [ Content "a"
            , Output { start: 1, end: 8 } (App "x" [])
            , Block { start: 8, end: 17 } Section "if" [ App "c" [] ]
                [ Content "t", Sep { start: 18, end: 26 } "else" [], Content "e" ]
            ]
        )

  -- foldTemplate counts every node, recursing into bodies.
  assert' "foldTemplate node count" (nodeCount "a{{#each x}}b{{{this}}}{{/each}}c" == 5)

  -- Mustache-inheritance shapes (meaning-free skeletons): the parent tag
  -- `{{<name}}…{{/name}}` (Parent) and the override-block tag `{{$name}}…{{/name}}`
  -- (BlockDef), including the dynamic `*`-headed spelling. They are gated by
  -- `inheritance`; an opting-in dialect builds plain `Block` nodes, dialects that
  -- don't opt in (the default) reject them with `DisallowedShape`.
  let
    inh = defaultParseOptions { inheritance = true }
  -- `{{<p}}B{{/p}}` ⇒ a Parent block headed `p`, close matched on `p`.
  case parseWith inh "{{<p}}B{{/p}}" of
    Right { nodes: t } ->
      assert' "inheritance: parent block shape"
        (t == [ Block { start: 0, end: 6 } Parent "p" [] [ Content "B" ] ])
    Left e -> assert' ("inheritance: parent parse error " <> show e) false
  -- `{{$b}}D{{/b}}` ⇒ a BlockDef block headed `b`.
  case parseWith inh "{{$b}}D{{/b}}" of
    Right { nodes: t } ->
      assert' "inheritance: block-def shape"
        (t == [ Block { start: 0, end: 6 } BlockDef "b" [] [ Content "D" ] ])
    Left e -> assert' ("inheritance: block-def parse error " <> show e) false
  -- dynamic spelling: `*` is an ident char, so `{{<*dyn}}…{{/*dyn}}` heads on
  -- `*dyn` and the close matches that headed name.
  case parseWith inh "{{<*dyn}}B{{/*dyn}}" of
    Right { nodes: t } ->
      assert' "inheritance: dynamic parent shape"
        (t == [ Block { start: 0, end: 9 } Parent "*dyn" [] [ Content "B" ] ])
    Left e -> assert' ("inheritance: dynamic parent parse error " <> show e) false
  -- with the default options (`inheritance = false`) the shapes are rejected.
  case parse "{{<p}}B{{/p}}" of
    Left (DisallowedShape _ _) -> pure unit
    _ -> assert' "inheritance: parent rejected when not opted in" false
  case parse "{{$b}}D{{/b}}" of
    Left (DisallowedShape _ _) -> pure unit
    _ -> assert' "inheritance: block-def rejected when not opted in" false
  -- a normal section / inverse still parse unchanged (sigil regression).
  case parse "{{#x}}A{{/x}}" of
    Right { nodes: [ Block _ Section "x" [] [ Content "A" ] ] } -> pure unit
    other -> assert' ("inheritance: section regressed " <> show other) false
  case parse "{{^x}}A{{/x}}" of
    Right { nodes: [ Block _ Inverse "x" [] [ Content "A" ] ] } -> pure unit
    other -> assert' ("inheritance: inverse regressed " <> show other) false

  -- foldExpr: a catamorphism over an expression. Count App nodes in a nested
  -- subexpression, descending into application arguments.
  case parse "{{{lookup this \"x\"}}}" of
    Right { nodes: [ Output _ e ] } ->
      let
        appCount = foldExpr { lit: \_ -> 0, app: \_ kids -> 1 + Array.foldl (+) 0 kids } e
      in
        assert' "foldExpr counts App nodes" (appCount == 2) -- (lookup …) and (this)
    _ -> assert' "foldExpr: unexpected parse" false

  -- splitClause shallowly splits a body at the first {{else}} separator.
  case parse "{{#if c}}A{{else}}B{{/if}}" of
    Right { nodes: [ Block _ _ _ _ body ] } ->
      let
        s = splitClause "else" body
      in
        assert' "splitClause before/after"
          (s.before == [ Content "A" ] && s.clause == Just [ Content "B" ])
    _ -> assert' "splitClause: unexpected parse" false

  -- splitClauses returns every separator-delimited section; splitClause bounds a
  -- clause at the next separator (a second {{else}} opens its own clause and
  -- does not leak into the first).
  case parse "{{#if c}}A{{else}}B{{else}}C{{/if}}" of
    Right { nodes: [ Block _ _ _ _ body ] } -> do
      let
        cs = splitClauses body
      assert' "splitClauses before" (cs.before == [ Content "A" ])
      assert' "splitClauses yields both clauses"
        (map _.body cs.clauses == [ [ Content "B" ], [ Content "C" ] ])
      assert' "splitClause bounds at next separator"
        ((splitClause "else" body).clause == Just [ Content "B" ])
    _ -> assert' "splitClauses: unexpected parse" false

  -- Schema validation flags an unknown helper; a known-arity call is clean.
  case parse "{{#if c}}{{{x}}}{{/if}}" of
    Right { nodes: t } -> assert' "validate clean" (Array.null (validate schema t))
    Left e -> assert' ("validate: " <> show e) false
  case parse "{{{nope}}}" of
    Right { nodes: t } -> assert' "validate flags unknown" (not (Array.null (validate schema t)))
    Left e -> assert' ("validate: " <> show e) false

  -- Stack safety: a large flat template (long content run + many output tags)
  -- must lex and parse without overflowing — the tokenizer and the sibling
  -- scan are tail-recursive. (Regression: a ~6 KB template used to overflow.)
  let
    big = power "x{{{a}}}y " 20000 -- ~180 KB, ~40000 content/output nodes
  case parse big of
    Right { nodes: t } -> assert' "large template parses without overflow" (Array.length t > 40000)
    Left e -> assert' ("large template overflowed/failed: " <> show e) false

  -- Source spans on tag-level nodes + spanText.
  case parse "  {{{this}}}" of
    Right { nodes: [ _, Output sp _ ] } ->
      assert' "span offsets + spanText"
        (sp.start == 2 && sp.end == 12 && spanText "  {{{this}}}" sp == "{{{this}}}")
    _ -> assert' "span: unexpected parse" false

  -- Parse-error line/column (P8): `{{{}}}` (empty output) starts at line 2, col 7.
  let
    bad = "hello\nworld {{{}}}"
  case parse bad of
    Left e ->
      let
        d = parseErrorAt bad e
      in
        assert' ("parseErrorAt: " <> show d.line <> ":" <> show d.column <> " " <> d.message)
          (d.line == 2 && d.column == 7)
    Right _ -> assert' "parseErrorAt: expected a parse error" false

  -- Header directives (truthiness-spec Phase 1): the core lifts `@key[: value]`
  -- from short `{{! … }}` comments, meaning-free, and drops the comment.
  let
    dirsOf src = case parse src of
      Right { directives } -> map (\d -> Tuple d.key d.value) directives
      Left _ -> [ Tuple "<error>" "" ]
    nodesOf src = case parse src of
      Right { nodes } -> nodes
      Left _ -> [ Content "<error>" ]
  -- single directive lifted; the comment leaves no node behind.
  assert' "directive: single key:value"
    (dirsOf "{{! @truthiness:always }}Hi" == [ Tuple "truthiness" "always" ])
  assert' "directive: comment produces no node"
    (nodesOf "{{! @truthiness:always }}Hi" == [ Content "Hi" ])
  -- multiline block, several heads, one per line and several on one line.
  assert' "directive: multiline + multi-head"
    ( dirsOf "{{! @truthiness: empty\n@foo: bar }}{{! @baz @qux:1 }}x"
        == [ Tuple "truthiness" "empty", Tuple "foo" "bar", Tuple "baz" "true", Tuple "qux" "1" ]
    )
  -- lenient spacing around the colon; a hyphen key; the bare-flag form ⇒ "true".
  assert' "directive: spaces around colon"
    (dirsOf "{{! @truthiness  :   always }}x" == [ Tuple "truthiness" "always" ])
  assert' "directive: hyphen key + flag form"
    (dirsOf "{{! @opt-in }}x" == [ Tuple "opt-in" "true" ])
  -- the explicit falsy-list value is carried verbatim (engine parses it later).
  assert' "directive: explicit shape-list value"
    ( dirsOf "{{! @truthiness: false null \"\" 0 [] }}x" ==
        [ Tuple "truthiness" "false null \"\" 0 []" ]
    )
  -- a long {{!-- … --}} comment is inert: its @text is prose, never a directive.
  assert' "directive: long comment is inert" (dirsOf "{{!-- @truthiness: ruby --}}x" == [])
  -- a plain short comment (no @head) is dropped and lifts nothing.
  assert' "directive: plain comment lifts nothing" (dirsOf "{{! just a note }}x" == [])
  -- leading content does not close the header, so a later directive is still valid.
  assert' "directive: content does not close the header"
    (dirsOf "pre {{! @truthiness:ruby }}{{{this}}}" == [ Tuple "truthiness" "ruby" ])
  -- a directive after the first real tag is a DirectiveAfterHeader error.
  case parse "{{{this}}}{{! @foo:bar }}" of
    Left (DirectiveAfterHeader _) -> pure unit
    _ -> assert' "directive: after-header must error" false

  -- Standalone trim (on by default) removes a lone block's line; parseWith can
  -- turn it off, and a `@trim` directive overrides the option either way.
  let
    contentStr = case _ of
      Content s -> Just s
      _ -> Nothing
    contentOf src opts = case parseWith opts src of
      Right { nodes } -> Array.mapMaybe contentStr nodes
      Left _ -> [ "<error>" ]
  -- default on: the standalone comment's line vanishes ("\nb" loses its newline).
  assert' "trim: standalone on by default"
    (contentOf "a\n{{! x }}\nb" defaultParseOptions == [ "a\n", "b" ])
  -- option off: the surrounding newline is kept.
  assert' "trim: option off keeps lines"
    ( contentOf "a\n{{! x }}\nb" (defaultParseOptions { trimStandalone = false }) ==
        [ "a\n", "\nb" ]
    )
  -- @trim:none overrides the on-default; @trim:standalone overrides off.
  assert' "trim: @trim:none overrides default-on"
    (contentOf "{{! @trim:none }}a\n{{! x }}\nb" defaultParseOptions == [ "a\n", "\nb" ])
  assert' "trim: @trim:standalone overrides option-off"
    ( contentOf "{{! @trim:standalone }}a\n{{! x }}\nb"
        (defaultParseOptions { trimStandalone = false }) == [ "a\n", "b" ]
    )
  -- an invalid @trim value is a BadDirective parse error.
  case parse "{{! @trim:loose }}x" of
    Left (BadDirective _ _) -> pure unit
    _ -> assert' "trim: invalid @trim value must error" false

  -- ToValue host binding: native PureScript data lowers to the core `Value`.
  assert' "toValue String" (toValue "x" == VString "x")
  assert' "toValue Boolean true" (toValue true == VBool true)
  assert' "toValue Boolean false" (toValue false == VBool false)
  assert' "toValue Int" (toValue (3 :: Int) == VNumber 3.0)
  assert' "toValue Number" (toValue 2.5 == VNumber 2.5)
  assert' "toValue Value is identity" (toValue (VSafe "<b>") == VSafe "<b>")
  assert' "toValue Nothing -> VNull" (toValue (Nothing :: Maybe Int) == VNull)
  assert' "toValue Just" (toValue (Just "a") == VString "a")
  assert' "toValue Array" (toValue [ "a", "b" ] == VArray [ VString "a", VString "b" ])
  assert' "toValue Map"
    ( toValue (Map.fromFoldable [ Tuple "k" "v" ])
        == VObject (Map.fromFoldable [ Tuple "k" (VString "v") ])
    )
  assert' "toValue record"
    ( toValue { name: "Ada", admin: true, n: 3 }
        == VObject
          ( Map.fromFoldable
              [ Tuple "name" (VString "Ada")
              , Tuple "admin" (VBool true)
              , Tuple "n" (VNumber 3.0)
              ]
          )
    )
  assert' "toValue nested record + array"
    ( toValue { user: { name: "Ada" }, tags: [ "x", "y" ] }
        == VObject
          ( Map.fromFoldable
              [ Tuple "user" (VObject (Map.singleton "name" (VString "Ada")))
              , Tuple "tags" (VArray [ VString "x", VString "y" ])
              ]
          )
    )

  log "all framework tests passed"
