-- | MinBars (Mustache-core) tests (`spago test -p minbars`): escaped/raw
-- | interpolation with HTML escaping, `VNull`, dotted names, the implicit
-- | iterator, parent fallback, polymorphic sections (array / truthy scalar /
-- | falsy / object), inverted sections, and context-inheriting partials.
module Test.MinBars.Main where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Foldable (for_)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String (Pattern(..))
import Data.String as String
import Data.String.CodeUnits as SCU
import Data.String.Common (joinWith)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Lexer (RawTok(..), tokenizeTemplate)
import FlatBars.Token (LexOptions, tokenizeInterior)
import FlatBars.Value (Value(..))
import Kernel.Analyse (Finding)
import MinBars (minOptions, renderMin, renderMinCompat, renderMinDelimsDiag, renderMinWith)
import MinBars.Analyse (analyseMin)
import MinBars.Inspect (inspectMin)
import MinBars.Provenance (renderMinMapped, renderMinMappedCompat)
import MinBars.Standalone (mustacheStandalone)
import Test.Assert (assert')

-- P2 (mutation guard): MinBars' standalone pass rewrites the interior *string* of
-- standalone partials / parents / override-blocks (appending the captured indent),
-- and must re-lex them in lockstep. On the POST-standalone stream, assert each
-- tag's carried interior equals `tokenizeInterior` of its (rewritten) string — so a
-- future change that mutates the string but forgets to re-lex fails here, not in a
-- single render case.
interiorMatches :: LexOptions -> RawTok -> Boolean
interiorMatches lx = case _ of
  ROutput _ base s int -> int == tokenizeInterior lx base s
  RAmp _ base s int -> int == tokenizeInterior lx base s
  ROpen _ _ base s int -> int == tokenizeInterior lx base s
  RClose _ base s int -> int == tokenizeInterior lx base s
  RSep _ base s int -> int == tokenizeInterior lx base s
  RRaw _ _ base head int _ -> int == tokenizeInterior lx base head
  _ -> true

obj :: Array (Tuple String Value) -> Value
obj = VObject <<< Map.fromFoldable

arr :: Array Value -> Value
arr = VArray

str :: String -> Value
str = VString

num :: Number -> Value
num = VNumber

-- | Assert MinBars source renders to `expected` against `dat`.
expectM :: String -> String -> Value -> String -> Effect Unit
expectM name src dat expected = case renderMin src dat of
  Left err -> assert' (name <> ": unexpected error: " <> err) false
  Right out -> assert' (name <> ": expected " <> show expected <> " got " <> show out)
    (out == expected)

-- | Assert with named partials.
expectP :: String -> Array (Tuple String String) -> String -> Value -> String -> Effect Unit
expectP name partials src dat expected = case renderMinWith partials src dat of
  Left err -> assert' (name <> ": unexpected error: " <> err) false
  Right out -> assert' (name <> ": expected " <> show expected <> " got " <> show out)
    (out == expected)

-- | Assert the truthiness-analysis findings for `src`/`dat` satisfy `ok`
-- | (`MinBars.Analyse`, ADR-022).
expectFindings :: String -> String -> Value -> (Array Finding -> Boolean) -> Effect Unit
expectFindings name src dat ok = case analyseMin src dat of
  Left err -> assert' (name <> ": unexpected analyse error: " <> err) false
  Right r -> assert'
    (name <> ": findings predicate failed (" <> show (Array.length r.findings) <> " found)")
    (ok r.findings)

-- | Assert with a custom INITIAL delimiter pair (the `--mustache --delimiters` path).
expectD :: String -> { open :: String, close :: String } -> String -> Value -> String -> Effect Unit
expectD name d src dat expected = case renderMinDelimsDiag d src dat of
  Left err -> assert' (name <> ": unexpected error: " <> err) false
  Right out -> assert' (name <> ": expected " <> show expected <> " got " <> show out)
    (out == expected)

-- | Assert under the `mustache.js`-compat truthiness (`renderMinCompat`): the
-- | `flatbars --mustache-js` path, where `0`/`""` are falsy (ADR-022).
expectC :: String -> String -> Value -> String -> Effect Unit
expectC name src dat expected = case renderMinCompat src dat of
  Left err -> assert' (name <> ": unexpected error: " <> err) false
  Right out -> assert' (name <> ": expected " <> show expected <> " got " <> show out)
    (out == expected)

main :: Effect Unit
main = do
  log "MinBars (Mustache-core) tests"

  -- escaped interpolation HTML-escapes the value.
  expectM "escaped" "{{x}}" (obj [ Tuple "x" (str "<b>&\"'") ]) "&lt;b&gt;&amp;&quot;&#x27;"
  -- raw interpolation (triple-stash and `&`) does not escape.
  expectM "raw-triple" "{{{x}}}" (obj [ Tuple "x" (str "<b>") ]) "<b>"
  expectM "raw-amp" "{{&x}}" (obj [ Tuple "x" (str "<b>") ]) "<b>"
  -- a plain (no-special-char) escaped value is unchanged.
  expectM "escaped-plain" "Hi {{name}}!" (obj [ Tuple "name" (str "Ada") ]) "Hi Ada!"

  -- a missing / null name interpolates as "".
  expectM "null-escaped" "[{{x}}]" (obj [ Tuple "x" VNull ]) "[]"
  expectM "missing-escaped" "[{{nope}}]" (obj []) "[]"
  expectM "null-raw" "[{{{x}}}]" (obj [ Tuple "x" VNull ]) "[]"

  -- dotted name resolution.
  expectM "dotted" "{{a.b.c}}"
    (obj [ Tuple "a" (obj [ Tuple "b" (obj [ Tuple "c" (str "deep") ]) ]) ])
    "deep"
  -- a dotted name whose tail misses ⇒ "".
  expectM "dotted-miss" "[{{a.b.z}}]"
    (obj [ Tuple "a" (obj [ Tuple "b" (obj [ Tuple "c" (str "deep") ]) ]) ])
    "[]"

  -- the implicit iterator `{{.}}` over a list of scalars (section pushes each).
  expectM "implicit-iter" "{{#xs}}[{{.}}]{{/xs}}"
    (obj [ Tuple "xs" (arr [ str "a", str "b", str "c" ]) ])
    "[a][b][c]"

  -- parent fallback: an inner object missing a key falls back to an outer frame.
  expectM "parent-fallback" "{{#inner}}{{outerKey}}/{{innerKey}}{{/inner}}"
    ( obj
        [ Tuple "outerKey" (str "OUT")
        , Tuple "inner" (obj [ Tuple "innerKey" (str "IN") ])
        ]
    )
    "OUT/IN"

  -- section over an array: body once per element, pushed.
  expectM "section-array" "{{#xs}}<{{n}}>{{/xs}}"
    (obj [ Tuple "xs" (arr [ obj [ Tuple "n" (str "1") ], obj [ Tuple "n" (str "2") ] ]) ])
    "<1><2>"
  -- section over a truthy scalar: rendered once (context pushed, named lookups
  -- fall through to the parent).
  expectM "section-truthy-scalar" "{{#flag}}YES{{/flag}}"
    (obj [ Tuple "flag" (VBool true) ])
    "YES"
  -- section over a falsy value: omitted (false / null / empty array).
  expectM "section-false" "{{#flag}}NO{{/flag}}" (obj [ Tuple "flag" (VBool false) ]) ""
  expectM "section-null" "{{#flag}}NO{{/flag}}" (obj [ Tuple "flag" VNull ]) ""
  expectM "section-empty-array" "{{#xs}}NO{{/xs}}" (obj [ Tuple "xs" (arr []) ]) ""
  -- Mustache (spec) truthiness: 0, "", {} are TRUTHY (unlike Handlebars).
  expectM "section-zero-truthy" "{{#n}}T{{/n}}" (obj [ Tuple "n" (num 0.0) ]) "T"
  expectM "section-emptystr-truthy" "{{#s}}T{{/s}}" (obj [ Tuple "s" (str "") ]) "T"
  expectM "section-emptyobj-truthy" "{{#o}}T{{/o}}" (obj [ Tuple "o" (obj []) ]) "T"

  -- mustache.js-compat truthiness (`renderMinCompat`, the `--mustache-js` path):
  -- 0 and "" flip to FALSY (mustache.js' `!value` reading), while {} stays truthy
  -- and [] stays falsy — so only the "ambiguous two" differ from the spec rule
  -- above. The inverted section is the mirror. (ADR-022 S2.)
  expectC "compat-zero-falsy" "{{#n}}T{{/n}}{{^n}}F{{/n}}" (obj [ Tuple "n" (num 0.0) ]) "F"
  expectC "compat-emptystr-falsy" "{{#s}}T{{/s}}{{^s}}F{{/s}}" (obj [ Tuple "s" (str "") ]) "F"
  expectC "compat-nonzero-truthy" "{{#n}}T{{/n}}{{^n}}F{{/n}}" (obj [ Tuple "n" (num 5.0) ]) "T"
  expectC "compat-emptyobj-truthy" "{{#o}}T{{/o}}{{^o}}F{{/o}}" (obj [ Tuple "o" (obj []) ]) "T"
  expectC "compat-empty-array-falsy" "{{#xs}}T{{/xs}}{{^xs}}F{{/xs}}" (obj [ Tuple "xs" (arr []) ])
    "F"
  expectC "compat-false-falsy" "{{#b}}T{{/b}}{{^b}}F{{/b}}" (obj [ Tuple "b" (VBool false) ]) "F"
  -- section over an object: pushed as context, inner names resolve.
  expectM "section-object" "{{#user}}{{name}}={{age}}{{/user}}"
    (obj [ Tuple "user" (obj [ Tuple "name" (str "Ada"), Tuple "age" (num 36.0) ]) ])
    "Ada=36"

  -- inverted section: renders iff falsy.
  expectM "inverted-falsy" "{{^x}}EMPTY{{/x}}" (obj [ Tuple "x" (arr []) ]) "EMPTY"
  expectM "inverted-null" "{{^x}}EMPTY{{/x}}" (obj [ Tuple "x" VNull ]) "EMPTY"
  expectM "inverted-false" "{{^x}}EMPTY{{/x}}" (obj [ Tuple "x" (VBool false) ]) "EMPTY"
  -- inverted over a truthy value: nothing.
  expectM "inverted-truthy" "{{^x}}EMPTY{{/x}}" (obj [ Tuple "x" (str "v") ]) ""
  -- inverted context is unchanged (the body sees the same stack).
  expectM "inverted-context" "{{#xs}}x{{/xs}}{{^xs}}none:{{top}}{{/xs}}"
    (obj [ Tuple "xs" (arr []), Tuple "top" (str "T") ])
    "none:T"

  -- comments are dropped.
  expectM "comment" "a{{! ignore me }}b" (obj []) "ab"

  -- a partial renders under the current context stack (inherits it).
  expectP "partial-inherits" [ Tuple "greet" "Hi {{name}}!" ]
    "{{> greet}}"
    (obj [ Tuple "name" (str "Ada") ])
    "Hi Ada!"
  -- a partial inside a section inherits the pushed frame.
  expectP "partial-in-section" [ Tuple "row" "<{{n}}>" ]
    "{{#xs}}{{> row}}{{/xs}}"
    (obj [ Tuple "xs" (arr [ obj [ Tuple "n" (str "1") ], obj [ Tuple "n" (str "2") ] ]) ])
    "<1><2>"
  -- a missing partial renders "".
  expectP "partial-missing" [] "[{{> nope}}]" (obj []) "[]"

  -- ── dynamic-name partials (`{{>* name}}`) ──────────────────────────────────

  -- `{{>* which}}` resolves `which` from data ⇒ partial `p`.
  expectP "dyn-partial" [ Tuple "p" "P!" ]
    "{{>* which}}"
    (obj [ Tuple "which" (str "p") ])
    "P!"
  -- glued spelling `{{>*which}}` behaves identically.
  expectP "dyn-partial-glued" [ Tuple "p" "P!" ]
    "{{>*which}}"
    (obj [ Tuple "which" (str "p") ])
    "P!"
  -- dotted dynamic name: resolve `a.b` (⇒ "row"), then load partial `row`.
  expectP "dyn-partial-dotted" [ Tuple "row" "<{{n}}>" ]
    "{{>* a.b}}"
    (obj [ Tuple "a" (obj [ Tuple "b" (str "row") ]), Tuple "n" (str "7") ])
    "<7>"
  -- a failed / non-string resolution ⇒ "" (no partial, no error).
  expectP "dyn-partial-miss" [ Tuple "p" "P!" ]
    "[{{>* which}}]"
    (obj [ Tuple "which" VNull ])
    "[]"
  expectP "dyn-partial-nonstring" [ Tuple "p" "P!" ]
    "[{{>* which}}]"
    (obj [ Tuple "which" (num 1.0) ])
    "[]"
  -- the dynamically-named partial inherits the current context stack.
  expectP "dyn-partial-inherits" [ Tuple "greet" "Hi {{name}}!" ]
    "{{>* g}}"
    (obj [ Tuple "g" (str "greet"), Tuple "name" (str "Ada") ])
    "Hi Ada!"

  -- ── inheritance: blocks (`{{$b}}`) and parents (`{{<p}}`) ───────────────────

  -- a standalone block renders its DEFAULT body (no enclosing parent).
  expectM "block-default" "{{$title}}DEFAULT{{/title}}" (obj []) "DEFAULT"
  -- a block default may itself interpolate.
  expectM "block-default-interp" "{{$title}}Hi {{name}}{{/title}}"
    (obj [ Tuple "name" (str "Ada") ])
    "Hi Ada"
  -- a parent overrides the named block; non-block content is rendered by the
  -- parent template around the block.
  expectP "inherit-override" [ Tuple "base" "[{{$title}}default{{/title}}]" ]
    "{{<base}}{{$title}}override{{/title}}{{/base}}"
    (obj [])
    "[override]"
  -- a `{{$x}}` block with NO override falls back to its default.
  expectP "inherit-no-override" [ Tuple "base" "[{{$title}}default{{/title}}]" ]
    "{{<base}}{{$other}}x{{/other}}{{/base}}"
    (obj [])
    "[default]"
  -- "text inside parent is ignored": non-`{{$}}` content in the parent body
  -- (the override site) produces nothing — only block overrides matter.
  expectP "inherit-text-ignored" [ Tuple "base" "[{{$title}}default{{/title}}]" ]
    "{{<base}}IGNORED{{$title}}override{{/title}}ALSO IGNORED{{/base}}"
    (obj [])
    "[override]"
  -- data does NOT override a block: a data key named `title` is irrelevant; the
  -- block resolves only from the override map, so the default shows.
  expectP "inherit-data-no-override" [ Tuple "base" "[{{$title}}default{{/title}}]" ]
    "{{<base}}{{/base}}"
    (obj [ Tuple "title" (str "DATA") ])
    "[default]"
  -- multi-level: an outer (more-derived) override wins over an inner one.
  -- `outer` overrides `mid`'s `title`; `mid` overrides `base`'s `title`.
  expectP "inherit-multi-level"
    [ Tuple "base" "[{{$title}}base-default{{/title}}]"
    , Tuple "mid" "{{<base}}{{$title}}mid{{/title}}{{/base}}"
    ]
    "{{<mid}}{{$title}}outer{{/title}}{{/mid}}"
    (obj [])
    "[outer]"
  -- without the outer override, the mid-level override applies.
  expectP "inherit-multi-level-mid"
    [ Tuple "base" "[{{$title}}base-default{{/title}}]"
    , Tuple "mid" "{{<base}}{{$title}}mid{{/title}}{{/base}}"
    ]
    "{{<mid}}{{/mid}}"
    (obj [])
    "[mid]"
  -- a block override renders in the data context of the including template.
  expectP "inherit-override-scope" [ Tuple "base" "[{{$body}}base{{/body}}]" ]
    "{{<base}}{{$body}}{{name}}{{/body}}{{/base}}"
    (obj [ Tuple "name" (str "Z") ])
    "[Z]"
  -- a missing parent template renders "".
  expectP "inherit-parent-missing" []
    "[{{<nope}}{{$title}}x{{/title}}{{/nope}}]"
    (obj [])
    "[]"

  -- ── dynamic-name parents (`{{<*name}}` / `{{/*name}}`) ──────────────────────

  -- the parent template name resolves from data; blocks override as usual.
  expectP "dyn-parent" [ Tuple "base" "[{{$title}}default{{/title}}]" ]
    "{{<*which}}{{$title}}override{{/title}}{{/*which}}"
    (obj [ Tuple "which" (str "base") ])
    "[override]"
  -- a failed dynamic-parent resolution ⇒ "".
  expectP "dyn-parent-miss" [ Tuple "base" "[{{$title}}default{{/title}}]" ]
    "[{{<*which}}{{$title}}x{{/title}}{{/*which}}]"
    (obj [ Tuple "which" VNull ])
    "[]"

  -- custom INITIAL delimiters (--mustache --delimiters '<% %>'): the main
  -- template starts at the given pair; default {{ }} is then literal text; and
  -- a {{=…=}}-style switch (relative to the initial pair) still works.
  let erb = { open: "<%", close: "%>" }
  expectD "delims-initial" erb "<% name %>" (obj [ Tuple "name" (str "Ada") ]) "Ada"
  expectD "delims-default-literal" erb "{{name}}" (obj [ Tuple "name" (str "Ada") ]) "{{name}}"
  expectD "delims-switch-back" erb "<%x%><%={{ }}=%>{{y}}"
    (obj [ Tuple "x" (str "A"), Tuple "y" (str "B") ])
    "AB"

  -- P2 mutation guard: standalone partials / parents / override-blocks have their
  -- interior string rewritten by mustacheStandalone; the carried interior must be
  -- re-lexed to match. Checked on the post-standalone stream (the real pipeline).
  let lx = minOptions.lexOptions
  for_
    [ "  {{> p}}\n"
    , "{{#a}}\n  {{> q}}\n{{/a}}\n"
    , "  {{<base}}\n  {{$x}}body{{/x}}\n  {{/base}}\n"
    , "line\n  {{> r}}\n  more {{x}}\n"
    ]
    \src -> case tokenizeTemplate minOptions.lexConfig lx src of
      Right toks -> assert' ("standalone re-lex invariant on " <> show src)
        (Array.all (interiorMatches lx) (mustacheStandalone lx toks))
      Left _ -> assert' ("corpus should lex: " <> show src) false

  -- Truthiness analysis (ADR-022, the Mustache-portability story). A section over
  -- an ambiguous scalar (`0`/`""`) is a finding: MinBars (mustache-spec) renders it,
  -- mustache.js (handlebars rule) would not.
  -- The fix is Mustache-honest: data-reshaping advice, never ClassicBars helper syntax
  -- like `(ne x 0)` (logic-less Mustache cannot express it).
  expectFindings "section-zero" "{{#count}}c{{/count}}" (obj [ Tuple "count" (num 0.0) ])
    \fs -> Array.length fs == 1
      && Array.any (\f -> Array.elem "handlebars" f.flips) fs
      && Array.all (\f -> not (String.contains (Pattern "(ne ") f.fix)) fs
  -- A boolean section is portable: a boolean has no ambiguous instance, so neither
  -- the observed value nor its type produces a finding.
  expectFindings "section-flag" "{{#flag}}yes{{/flag}}" (obj [ Tuple "flag" (VBool true) ])
    Array.null
  -- An inverted section over `""` flips too (`{{^s}}` renders under mustache.js).
  expectFindings "inverted-empty" "{{^s}}none{{/s}}" (obj [ Tuple "s" (str "") ])
    \fs -> Array.length fs == 1
  -- An array section is iteration, not a truthiness branch: no finding.
  expectFindings "section-array" "{{#xs}}x{{/xs}}" (obj [ Tuple "xs" (arr [ num 1.0 ]) ])
    Array.null

  -- Source map (ADR-035): the mapped render tiles the output exactly (correct-or-
  -- absent), and a top-level emit carries its source span.
  case renderMinMapped "Hi {{name}}!" (obj [ Tuple "name" (str "Ada") ]) of
    Left e -> assert' ("mapped render errored: " <> e) false
    Right { output, segments } -> do
      assert' ("mapped output: " <> output) (output == "Hi Ada!")
      assert' "the source map tiles the output"
        (joinWith "" (map (\s -> SCU.take s.len (SCU.drop s.out output)) segments) == output)
      assert' "the {{name}} emit carries a source span"
        (Array.any (\s -> s.kind == "emit" && s.start == Just 3 && s.end == Just 11) segments)

  -- The compat (mustache.js) source map tracks its rule: `{{#n}}` over n=0 is falsy
  -- under compat (skipped) but truthy under spec (rendered), so the two maps tile
  -- different output. (The Lab's MinBars default is the compat rule — RC regression.)
  case renderMinMappedCompat "a{{#n}}b{{/n}}c" (obj [ Tuple "n" (num 0.0) ]) of
    Left e -> assert' ("compat mapped errored: " <> e) false
    Right { output, segments } -> do
      assert' ("compat output (0 falsy → skip): " <> output) (output == "ac")
      assert' "the compat source map tiles its own output"
        (joinWith "" (map (\s -> SCU.take s.len (SCU.drop s.out output)) segments) == output)

  -- Context Inspector (ADR-035): a section pushes context, so a snapshot at the
  -- inner emit reports this = the pushed frame, parent = root. One per iteration.
  let
    userInner = obj [ Tuple "email" (str "a@x") ]
    userData = obj [ Tuple "name" (str "Ada"), Tuple "user" userInner ]
    sectionSrc = "{{#user}}{{email}}{{/user}}"
  case renderMinMapped sectionSrc userData of
    Left e -> assert' ("mapped errored: " <> e) false
    Right { segments } -> case Array.find (\s -> s.kind == "emit" && s.start /= Nothing) segments of
      Nothing -> assert' "expected an emit segment to target" false
      Just seg ->
        case
          inspectMin { file: "main", start: fromMaybe 0 seg.start, end: fromMaybe 0 seg.end }
            sectionSrc
            userData
          of
          Left e -> assert' ("inspect errored: " <> e) false
          Right snaps -> do
            assert' ("one snapshot, got " <> show (Array.length snaps)) (Array.length snaps == 1)
            assert' "this is the pushed user frame"
              (map _.this (Array.head snaps) == Just userInner)
            assert' "parent is the root data"
              (map _.parent (Array.head snaps) == Just (Just userData))

  log "all MinBars tests passed"
