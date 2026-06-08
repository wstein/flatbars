-- | FlatBars *framework* test suite (`spago test -p flatbars`).
-- |
-- | Structural only — parsing shapes, the foldTemplate catamorphism, clause
-- | splitting, schema validation, and source spans. No rendering: that is the
-- | engine's job and is tested in `fullbars`.
module Test.FlatBars.Main where

import Prelude

import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Either (Either(..), isLeft)
import Data.Foldable (for_)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Monoid (power)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars (Expr(..), Node(..), ParseError(..), Sigil(..), Value(..), defaultParseOptions, parse, parseErrorAt, parseRecovering, parseWith, spanText)
import FlatBars.Highlight (HighlightConfig, highlightSpans, tokenizeSpans)
import FlatBars.Lexer (RawTok(..), defaultLexConfig, tokenizeTemplate)
import FlatBars.Token (LexOptions, Token(..), defaultLexOptions, infixOperatorChars, tokenizeInterior)
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

-- The lexed interior tokens (`.tok` only) an interior-bearing RawTok carries.
interiorTokens :: RawTok -> Maybe (Array Token)
interiorTokens = case _ of
  ROutput _ _ _ (Right ts) -> Just (map _.tok ts)
  RAmp _ _ _ (Right ts) -> Just (map _.tok ts)
  ROpen _ _ _ _ (Right ts) -> Just (map _.tok ts)
  RClose _ _ _ (Right ts) -> Just (map _.tok ts)
  RSep _ _ _ (Right ts) -> Just (map _.tok ts)
  RRaw _ _ _ _ (Right ts) _ -> Just (map _.tok ts)
  _ -> Nothing

-- P2 invariant: a tag's carried interior is *exactly* `tokenizeInterior` of its
-- own (base, string) — under the same `LexOptions` it was built with. Catches a
-- construction site pairing the wrong base/string (e.g. RRaw's body slipping into
-- the interior slot) or a future mutation that rewrites the string but forgets to
-- re-lex. (RRaw carries its HEAD interior; the body is verbatim.)
interiorMatches :: LexOptions -> RawTok -> Boolean
interiorMatches lx = case _ of
  ROutput _ base s int -> int == tokenizeInterior lx base s
  RAmp _ base s int -> int == tokenizeInterior lx base s
  ROpen _ _ base s int -> int == tokenizeInterior lx base s
  RClose _ base s int -> int == tokenizeInterior lx base s
  RSep _ base s int -> int == tokenizeInterior lx base s
  RRaw _ _ base head int _ -> int == tokenizeInterior lx base head
  _ -> true

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
    , nodeError: \_ _ -> 1
    , concat: Array.foldl (+) 0
    }
    t

-- Highlight configs mirror each dialect's parse gates. A kernel-dialect config
-- (FullBars-like — `else`/`elif` are clause separators, extras on, inheritance
-- off) and a Mustache config (set delimiters on, no clause words, inheritance on).
hlKernel :: HighlightConfig
hlKernel =
  { lexConfig: defaultLexConfig { keepLongComments = true }
  , clauseSeps: [ "else", "elif" ]
  , lexOptions: defaultLexOptions
  , extras: true
  , inheritance: false
  , rawBlockHbs: true -- FullBars: the bare `{{{{name}}}}` (Handlebars)
  , rawBlockHash: false -- but not the `{{{{#name}}}}` FlatBars spelling
  }

hlMustache :: HighlightConfig
hlMustache =
  { lexConfig: defaultLexConfig { mustacheDelims = true, keepLongComments = true }
  , clauseSeps: []
  , lexOptions: defaultLexOptions
  , extras: true
  , inheritance: true
  , rawBlockHbs: false -- Mustache has no raw blocks: neither spelling
  , rawBlockHash: false
  }

-- MaxBars-like: extras off (so `{{&}}`/`{{^}}`/`{{{{…}}}}` are disallowed shapes),
-- inheritance off, and the infix-arithmetic interior lexer on. The tag-role view
-- (`highlightSpans`) still colours the whole tag by its head's meaning; the
-- interior-role view (`tokenizeSpans`, ADR-017) additionally carves operators and
-- literals into their own spans.
hlMax :: HighlightConfig
hlMax =
  { lexConfig: defaultLexConfig { keepLongComments = true }
  , clauseSeps: [ "else", "elif" ]
  , lexOptions: { operatorChars: infixOperatorChars, rangeOperator: true, collectionLiterals: true }
  , extras: false
  , inheritance: false
  , rawBlockHbs: false -- MaxBars: the `{{{{#name}}}}` FlatBars spelling only
  , rawBlockHash: true
  }

kinds :: HighlightConfig -> String -> Array String
kinds cfg src = map _.kind (highlightSpans cfg src)

main :: Effect Unit
main = do
  log "FlatBars framework tests"

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

  -- A bare literal in an output tag (`{{42}}`, `{{"x"}}`) is not an application
  -- head but it is a value — emit it as output, the same node the triple-stash
  -- (`{{{42}}}`) produces. Blocks/closes still require an identifier head, and an
  -- empty `{{}}` still errors.
  case parse "{{42}}{{\"x\"}}" of
    Left e -> assert' ("parse: literal output unexpected error " <> show e) false
    Right { nodes: t } -> assert' "parse: a bare literal is output, not a head"
      ( t ==
          [ Output { start: 0, end: 6 } (Lit (VNumber 42.0))
          , Output { start: 6, end: 13 } (Lit (VString "x"))
          ]
      )
  assert' "parse: an empty {{}} is still an error" (isLeft (parse "{{}}"))

  -- ── Recovering parse (ADR-023): one parser; `parse` is its fail-fast projection.
  -- A well-formed template recovers nothing — same tree, no errors.
  case parseRecovering defaultParseOptions "a{{x}}{{#s}}b{{/s}}" of
    { errors: [], nodes: [ Content "a", Sep _ "x" [], Block _ Section "s" [] [ Content "b" ] ] } ->
      assert' "recover: clean template ⇒ no errors, normal tree" true
    r -> assert'
      ("recover: clean template unexpected " <> show r.nodes <> " errs " <> show r.errors)
      false
  -- A bad block head salvages its name and still nests — the body and close parse,
  -- and exactly one error (the bad args) is recorded. `parse` rejects it.
  case parseRecovering defaultParseOptions "{{#if a == 1}}x{{/if}}" of
    { errors, nodes: [ Block _ Section "if" [] [ Content "x" ] ] } ->
      assert' "recover: bad block head nests, one error" (Array.length errors == 1)
    r -> assert' ("recover: bad block head not recovered " <> show r.nodes) false
  assert' "recover: the projection still rejects it" (isLeft (parse "{{#if a == 1}}x{{/if}}"))
  -- Multiple errors are collected in one pass (the whole point).
  assert' "recover: two bad blocks ⇒ two errors"
    ( Array.length
        (parseRecovering defaultParseOptions "{{#if a == 1}}{{/if}}{{#al b == 2}}{{/al}}").errors ==
        2
    )
  -- Structural recovery: a missing close still builds the block + flags it.
  case parseRecovering defaultParseOptions "{{#each x}}y" of
    { errors, nodes: [ Block _ Section "each" _ [ Content "y" ] ] } ->
      assert' "recover: missing close ⇒ block kept, one error" (Array.length errors == 1)
    r -> assert' ("recover: missing close not recovered " <> show r.nodes) false
  -- A stray close at top level is reported and recovered past.
  assert' "recover: a stray {{/wat}} is one error"
    (Array.length (parseRecovering defaultParseOptions "{{/wat}}").errors == 1)
  assert' "parse: a literal block head {{#42}} is still an error" (isLeft (parse "{{#42}}t{{/42}}"))

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
    Left es | DisallowedShape _ _ <- NEA.head es -> pure unit
    _ -> assert' "inheritance: parent rejected when not opted in" false
  case parse "{{$b}}D{{/b}}" of
    Left es | DisallowedShape _ _ <- NEA.head es -> pure unit
    _ -> assert' "inheritance: block-def rejected when not opted in" false
  -- a normal section / inverse still parse unchanged (sigil regression).
  case parse "{{#x}}A{{/x}}" of
    Right { nodes: [ Block _ Section "x" [] [ Content "A" ] ] } -> pure unit
    other -> assert' ("inheritance: section regressed " <> show other) false
  case parse "{{^x}}A{{/x}}" of
    Right { nodes: [ Block _ Inverse "x" [] [ Content "A" ] ] } -> pure unit
    other -> assert' ("inheritance: inverse regressed " <> show other) false

  -- ── Set delimiters (ADR-015): the lexer's gated `mustacheDelims` mode ────────
  let
    md = defaultParseOptions
      { lexConfig = { open: "{{", close: "}}", mustacheDelims: true, keepLongComments: false } }
  -- `{{=<% %>=}}` swaps the active delimiters; it renders nothing, and a following
  -- `<%x%>` is a separator in the new pair (span confirms the tag was consumed).
  case parseWith md "{{=<% %>=}}<%x%>" of
    Right { nodes: [ Sep { start: 11, end: 16 } "x" [] ] } -> pure unit
    other -> assert' ("set-delim: switch + custom tag " <> show other) false
  -- `<%={{ }}=%>` switches back, re-enabling the default `{{ }}` pair.
  case parseWith md "{{=<% %>=}}<%x%><%={{ }}=%>{{y}}" of
    Right { nodes: [ Sep _ "x" [], Sep _ "y" [] ] } -> pure unit
    other -> assert' ("set-delim: switch back to default " <> show other) false
  -- content is preserved, and `{{y}}` is literal text once delimiters are custom.
  case parseWith md "{{=<% %>=}}* <%x%> {{y}}" of
    Right { nodes: [ Content "* ", Sep _ "x" [], Content " {{y}}" ] } -> pure unit
    other -> assert' ("set-delim: content + literal default braces after switch " <> show other)
      false
  -- sigils rebase under custom delimiters: `<%#a%>…<%/a%>` is a section.
  case parseWith md "{{=<% %>=}}<%#a%>b<%/a%>" of
    Right { nodes: [ Block _ Section "a" [] [ Content "b" ] ] } -> pure unit
    other -> assert' ("set-delim: custom-delimited section " <> show other) false
  -- exactly two delimiters are required; a malformed set-delimiter is a parse error.
  case parseWith md "{{=onlyone=}}" of
    Left _ -> pure unit
    other -> assert' ("set-delim: malformed tag should be rejected " <> show other) false
  -- the mode is OFF by default: `{{=…=}}` is not special, so the switch never
  -- happens and `<%x%>` stays literal content (never a tag).
  let
    isSepX = case _ of
      Sep _ "x" _ -> true
      _ -> false
  case parse "{{=<% %>=}}plain<%x%>" of
    Right { nodes } -> assert' "set-delim: must stay inert when mustacheDelims is off"
      (not (Array.any isSepX nodes))
    Left _ -> pure unit -- a parse error is also fine: the point is `<%x%>` is not a tag

  -- ADR-001 crown jewel: the core parser does NOT special-case `{{else}}`. It is
  -- a plain `Sep` node, structurally identical to any user separator — the name
  -- is the only difference; clause *meaning* is the engine's job, not the parser's.
  let
    sepShape src = case parse src of
      Right { nodes: [ Content "a", Sep _ name args, Content "b" ] } -> Just
        (Tuple name (Array.length args))
      _ -> Nothing
  assert' "ADR-001: {{else}} is a plain Sep, identical in shape to a user separator"
    ( sepShape "a{{else}}b" == Just (Tuple "else" 0) && sepShape "a{{custom}}b" == Just
        (Tuple "custom" 0)
    )

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
    Left es ->
      let
        d = parseErrorAt bad (NEA.head es)
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
    Left es | DirectiveAfterHeader _ <- NEA.head es -> pure unit
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
    Left es | BadDirective _ _ <- NEA.head es -> pure unit
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

  -- Highlight spans (ADR-014): derived from the lexer, so exact and per-dialect.
  assert' "highlight: bare interpolation is one expr span"
    (highlightSpans hlKernel "{{name}}" == [ { from: 0, to: 8, kind: "expr" } ])
  assert' "highlight: {{else}} is a clause keyword between block open/close"
    ( highlightSpans hlKernel "{{#if c}}t{{else}}e{{/if}}" ==
        [ { from: 0, to: 9, kind: "block-open" }
        , { from: 10, to: 18, kind: "keyword" }
        , { from: 19, to: 26, kind: "block-close" }
        ]
    )
  assert' "highlight: {{elif …}} is also a clause keyword"
    (kinds hlKernel "{{#if c}}{{elif d}}{{/if}}" == [ "block-open", "keyword", "block-close" ])
  -- Dialect-dependent (IoC): with no clause separators (MinBars), `{{else}}` is
  -- an ordinary interpolation, never a keyword.
  assert' "highlight: {{else}} is expr when the dialect has no clause words"
    (kinds hlMustache "{{else}}" == [ "expr" ])
  assert' "highlight: {{> p}} is a partial"
    (highlightSpans hlKernel "{{> p}}" == [ { from: 0, to: 7, kind: "partial" } ])
  -- The inheritance sigils the old regex mis-painted as plain expressions — a
  -- Mustache config (inheritance on) paints them as their own block kinds.
  assert' "highlight: inheritance {{<…}}/{{$…}} sigils are block kinds"
    ( kinds hlMustache "{{<base}}{{$title}}d{{/title}}{{/base}}" ==
        [ "block-parent", "block-decl", "block-close", "block-close" ]
    )
  assert' "highlight: triple-stash is raw, comment is comment"
    (kinds hlKernel "{{{x}}}{{! hi }}" == [ "raw", "comment" ])
  -- Long comments are coloured too (keepLongComments): {{!-- … --}} → one comment
  -- span, even with inner mustaches/dashes; the inner tags are NOT highlighted.
  assert' "highlight: long {{!-- … --}} comment is one comment span"
    ( highlightSpans hlKernel "a {{!-- has {{foo}} and -- dashes --}} b" ==
        [ { from: 2, to: 38, kind: "comment" } ]
    )
  -- Set delimiters are stateful — only the lexer (which carries the live pair)
  -- gets this right: after `{{=<% %>=}}` the following `<%y%>` is the active tag.
  assert' "highlight: set-delimiter switch is stateful"
    ( highlightSpans hlMustache "{{=<% %>=}}x<%y%>" ==
        [ { from: 0, to: 11, kind: "set-delimiter" }
        , { from: 12, to: 17, kind: "expr" }
        ]
    )
  -- ADR-023 (recovering lexer): an unterminated tag no longer wipes all
  -- highlighting. It recovers to an `unterminated` span (the orphan opener up to
  -- the next opener / EOF), and earlier valid tags still highlight.
  assert' "highlight: an unterminated tag recovers to an `unterminated` span"
    (highlightSpans hlKernel "{{oops" == [ { from: 0, to: 6, kind: "unterminated" } ])
  assert' "highlight: recovery keeps earlier tags lit and resyncs to the broken tail"
    ( highlightSpans hlKernel "Hi {{name}} more {{oops" ==
        [ { from: 3, to: 11, kind: "expr" }, { from: 17, to: 23, kind: "unterminated" } ]
    )

  -- Dialect gates (ADR-014): a structurally-valid shape the dialect REJECTS is
  -- coloured `error`, never painted valid. `extras = false` (MaxBars) disallows
  -- `{{&}}` (unescaped), `{{^}}` (inverse), and `{{{{…}}}}` (raw block).
  assert' "highlight: extras-off disallows {{&x}} → error"
    (kinds hlMax "{{&x}}" == [ "error" ])
  assert' "highlight: extras-off disallows {{^x}} (inverse) → error, close stays block-close"
    (kinds hlMax "{{^x}}b{{/x}}" == [ "error", "block-close" ])
  -- Raw blocks have two spellings gated separately. FullBars accepts the bare
  -- Handlebars `{{{{r}}}}` and rejects the FlatBars `{{{{#r}}}}`; MaxBars/RawBars
  -- are the mirror; MinBars rejects both (Mustache has no raw blocks).
  assert' "highlight: FullBars allows the bare {{{{r}}}} raw block"
    (kinds hlKernel "{{{{r}}}}b{{{{/r}}}}" == [ "raw-block" ])
  assert' "highlight: FullBars rejects the {{{{#r}}}} FlatBars spelling → error"
    (kinds hlKernel "{{{{#r}}}}b{{{{/r}}}}" == [ "error" ])
  assert' "highlight: MaxBars rejects the bare {{{{r}}}} → error"
    (kinds hlMax "{{{{r}}}}b{{{{/r}}}}" == [ "error" ])
  assert' "highlight: MaxBars allows the {{{{#r}}}} FlatBars spelling"
    (kinds hlMax "{{{{#r}}}}b{{{{/r}}}}" == [ "raw-block" ])
  assert' "highlight: MinBars (Mustache) rejects raw blocks → error"
    (kinds hlMustache "{{{{#r}}}}b{{{{/r}}}}" == [ "error" ])
  -- …but with extras on (Mustache) the {{^}}/{{&}} shapes are valid kinds.
  assert' "highlight: extras-on allows {{^x}} (inverse) and {{&x}} (raw)"
    (kinds hlMustache "{{^x}}b{{/x}}{{&y}}" == [ "block-inverse", "block-close", "raw" ])
  -- `inheritance = false` (the kernel/FullBars config) disallows {{<}}/{{$}}.
  assert' "highlight: inheritance-off disallows {{<l}}/{{$b}} → error"
    ( kinds hlKernel "{{<l}}{{$b}}x{{/b}}{{/l}}" ==
        [ "error", "error", "block-close", "block-close" ]
    )

  -- A tag is ONE span coloured by its head's meaning; interior literals and
  -- operators carry no colour of their own (they stay the tag's colour).
  assert' "highlight: a MaxBars tag with an operator is one expr span"
    (highlightSpans hlMax "{{ a + b }}" == [ { from: 0, to: 11, kind: "expr" } ])
  assert' "highlight: strings and numbers do not split the tag"
    (highlightSpans hlMax "{{ x ?? \"y\" }}" == [ { from: 0, to: 14, kind: "expr" } ])
  assert' "highlight: a simple {{name}} is one chunk"
    (kinds hlKernel "{{name}}" == [ "expr" ])
  assert' "highlight: a numeric literal in a block arg does not punch a number span"
    (kinds hlKernel "{{#if (gt x 5)}}{{/if}}" == [ "block-open", "block-close" ])

  -- Interior token vocabulary (ADR-017): `tokenizeSpans` is the superset — the
  -- tag-role spans `highlightSpans` returns PLUS interior `string`/`number`/
  -- `operator` literals carved at their exact source spans. Each interior span is
  -- nested inside its tag span.
  assert' "tokenize: a MaxBars operator carves an interior operator span"
    ( tokenizeSpans hlMax "{{ a + b }}" ==
        [ { from: 0, to: 11, kind: "expr", role: "tag" }
        , { from: 5, to: 6, kind: "operator", role: "interior" }
        ]
    )
  assert' "tokenize: strings and numbers carve interior spans, identifiers do not"
    ( tokenizeSpans hlMax "{{ x ?? \"y\" }}" ==
        [ { from: 0, to: 14, kind: "expr", role: "tag" }
        , { from: 5, to: 7, kind: "operator", role: "interior" }
        , { from: 8, to: 11, kind: "string", role: "interior" }
        ]
    )
  assert' "tokenize: a numeric literal in a block arg carves a number span"
    ( tokenizeSpans hlKernel "{{#if (gt x 5)}}" ==
        [ { from: 0, to: 16, kind: "block-open", role: "tag" }
        , { from: 12, to: 13, kind: "number", role: "interior" }
        ]
    )
  -- Off MaxBars, `+`/`-`/`*`/`/` are path punctuation, not operators — so a kernel
  -- dialect carves no operator span for them (the interior seam is `lexOptions`).
  assert' "tokenize: kernel dialect does not treat path punctuation as operators"
    ( tokenizeSpans hlKernel "{{ a-b }}" ==
        [ { from: 0, to: 9, kind: "expr", role: "tag" } ]
    )
  -- A partial's leading `>` is the tag's meaning, not an operator: no interior span.
  assert' "tokenize: a partial carves no interior span for its `>` head"
    (tokenizeSpans hlKernel "{{> p}}" == [ { from: 0, to: 7, kind: "partial", role: "tag" } ])
  -- `highlightSpans` is exactly the tag-role projection of `tokenizeSpans`.
  assert' "tokenize: highlightSpans is tokenizeSpans filtered to role == tag"
    ( map _.kind (highlightSpans hlMax "{{ x ?? \"y\" }}")
        == map _.kind
          (Array.filter (\s -> s.role == "tag") (tokenizeSpans hlMax "{{ x ?? \"y\" }}"))
    )

  -- ---- The interior `tokenizeTemplate` carries on each RawTok ----
  -- The parser and highlighter both read this pre-lexed interior off the token.
  -- These pin the two non-trivial properties — raw blocks carry their HEAD
  -- interior (not the body), and `operatorChars` is threaded through — so the carried
  -- tokens are exactly what `outputExpr`/`headed` and the highlighter consume.
  let
    interiorToksOf lx src =
      case tokenizeTemplate defaultLexConfig lx src of
        Right toks -> Array.findMap interiorTokens toks
        Left _ -> Nothing
    lxOn = defaultLexOptions { operatorChars = infixOperatorChars }
  -- A raw block is one RawTok; its interior is the HEAD's tokens, not the body's.
  assert' "tokenizer: a raw block attaches its head tokens (not the verbatim body)"
    ( interiorToksOf defaultLexOptions "{{{{raw}}}}verbatim {{x}} body{{{{/raw}}}}" == Just
        [ TIdent "raw" ]
    )
  -- With an empty operator set, `+` is path punctuation, so `a+b` is one ident;
  -- with the infix operator set it carves into ident/op/ident.
  assert' "tokenizer: empty operatorChars keeps `a+b` a single ident interior"
    (interiorToksOf defaultLexOptions "{{ a+b }}" == Just [ TIdent "a+b" ])
  assert' "tokenizer: infix operatorChars carves `a+b` into ident/op/ident"
    (interiorToksOf lxOn "{{ a+b }}" == Just [ TIdent "a", TOp "+", TIdent "b" ])
  -- `=` is an ident-continuation char in both modes (the surface hash splits later).
  assert' "tokenizer: `key=value` stays one interior ident in both modes"
    (interiorToksOf lxOn "{{ key=val }}" == Just [ TIdent "key=val" ])

  -- P2 + P6: over a multi-tag corpus (every tag, not just the first), under both
  -- `operatorChars` settings, each tag's carried interior equals `tokenizeInterior`
  -- of its own (base, string). This is the structural guard the wrapper used to
  -- give for free; it fails deterministically on a mis-paired base/string or a
  -- mispositioned RRaw body. (Dialect *mutation* paths — MinBars standalone — are
  -- guarded in the minbars suite.)
  for_ [ defaultLexOptions, lxOn ] \lx ->
    for_
      [ "{{x}}{{{y}}}{{&z}} {{ a.b c }}"
      , "{{#each items}}{{this}}{{else}}{{/each}}"
      , "{{{{raw}}}}body {{x}} more{{{{/raw}}}}"
      , "pre {{ f 1 \"s\" }} mid {{> p}} post"
      , "{{ a+b }}{{ c*d }}{{ key=val }}"
      ]
      \src -> case tokenizeTemplate defaultLexConfig lx src of
        Right toks -> assert' ("interior invariant holds on " <> show src)
          (Array.all (interiorMatches lx) toks)
        Left _ -> assert' ("invariant corpus should lex: " <> show src) false

  log "all framework tests passed"
