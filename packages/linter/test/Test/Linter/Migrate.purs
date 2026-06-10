-- | X2 acceptance tests for `Linter.Migrate` (Handlebars → MaxBars source
-- | migrator). The strong oracle is **render-equivalence**: for mechanical
-- | templates with NO residual, the original Handlebars source rendered by
-- | `ClassicBars.renderSurface` must equal the migrated MaxBars source rendered by
-- | `MaxBars.renderMax`, across a small data matrix — proving the rewrite
-- | preserves meaning. Plus residual-report assertions and a couple of direct
-- | source-shape checks.
module Test.Linter.Migrate (main) where

import Prelude

import ClassicBars (renderSurface)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), contains)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Value (Value(..))
import Linter.Migrate (Residual, migrateToMaxBars)
import MaxBars (renderMax)
import Test.Assert (assert')

-- | Render-equivalence oracle: the Handlebars source and its migration render
-- | identically across every value in `datas`. (A residual-free, mechanical
-- | template is required here — that is the contract being proven.)
rendersEquivalent :: String -> String -> Array Value -> Effect Unit
rendersEquivalent name hbs datas = case migrateToMaxBars hbs of
  Left e -> assert' (name <> ": migrate failed: " <> show e) false
  Right res -> do
    assert' (name <> ": expected no residuals, got " <> show res.residuals)
      (Array.null res.residuals)
    Array.foldM
      ( \_ dat ->
          let
            want = renderSurface hbs dat
            got = renderMax res.source dat
          in
            assert'
              ( name <> ": handlebars " <> show want <> " ≠ migrated maxbars " <> show got
                  <> "\n  migrated = "
                  <> res.source
                  <> "\n  data = "
                  <> show dat
              )
              (want == got)
      )
      unit
      datas

-- | Assert the migrated source contains a needle (direct source-shape check).
migratesContaining :: String -> String -> String -> Effect Unit
migratesContaining name hbs needle = case migrateToMaxBars hbs of
  Left e -> assert' (name <> ": migrate failed: " <> show e) false
  Right res -> assert'
    (name <> ": expected " <> show res.source <> " to contain " <> show needle)
    (contains (Pattern needle) res.source)

-- | Assert the migrated source does NOT contain a needle.
assertNotContaining :: String -> String -> String -> Effect Unit
assertNotContaining name hbs needle = case migrateToMaxBars hbs of
  Left e -> assert' (name <> ": migrate failed: " <> show e) false
  Right res -> assert'
    (name <> ": expected " <> show res.source <> " to NOT contain " <> show needle)
    (not (contains (Pattern needle) res.source))

-- | Find a residual of the given kind, asserting it exists and that it carries a
-- | non-empty message AND suggestion AND a sane span.
findResidual :: String -> String -> String -> Effect Unit
findResidual name hbs kind = case migrateToMaxBars hbs of
  Left e -> assert' (name <> ": migrate failed: " <> show e) false
  Right res -> case Array.find (\r -> r.kind == kind) res.residuals of
    Nothing -> assert'
      (name <> ": expected a " <> show kind <> " residual, got " <> show (map _.kind res.residuals))
      false
    Just r -> do
      assert' (name <> ": residual message empty") (r.message /= "")
      assert' (name <> ": residual suggestion empty") (r.suggestion /= "")
      assert'
        ( name <> ": residual span not in tag (start " <> show r.span.start
            <> " end "
            <> show r.span.end
            <> ")"
        )
        (r.span.end > r.span.start)

-- | Every residual carries a non-empty message and suggestion.
allResidualsWellFormed :: String -> Array Residual -> Effect Unit
allResidualsWellFormed name rs =
  Array.foldM
    ( \_ r -> do
        assert' (name <> ": empty message on " <> r.kind) (r.message /= "")
        assert' (name <> ": empty suggestion on " <> r.kind) (r.suggestion /= "")
    )
    unit
    rs

--------------------------------------------------------------------------------
-- Data matrices
--------------------------------------------------------------------------------

obj :: Array (Tuple String Value) -> Value
obj = VObject <<< Map.fromFoldable

-- | A matrix exercising arrays (for `each`/loop vars), booleans (for `unless`),
-- | and objects (for `key`).
listMatrix :: Array Value
listMatrix =
  [ obj [ Tuple "items" (VArray [ VString "a", VString "b", VString "c" ]) ]
  , obj [ Tuple "items" (VArray [ VString "only" ]) ]
  , obj [ Tuple "items" (VArray []) ]
  ]

boolMatrix :: Array Value
boolMatrix =
  [ obj [ Tuple "items" (VArray [ VString "x" ]) ]
  , obj [ Tuple "items" (VArray []) ]
  , obj [ Tuple "done" (VBool true) ]
  , obj [ Tuple "done" (VBool false) ]
  ]

ampMatrix :: Array Value
ampMatrix =
  [ obj [ Tuple "x" (VString "<b>hi</b>") ]
  , obj [ Tuple "x" (VString "plain") ]
  ]

elifMatrix :: Array Value
elifMatrix =
  [ obj [ Tuple "n" (VNumber 15.0) ]
  , obj [ Tuple "n" (VNumber 5.0) ]
  , obj [ Tuple "n" (VNumber (-1.0)) ]
  ]

keyMatrix :: Array Value
keyMatrix =
  [ obj [ Tuple "m" (obj [ Tuple "alpha" (VNumber 1.0), Tuple "beta" (VNumber 2.0) ]) ]
  , obj [ Tuple "m" (obj []) ]
  ]

main :: Effect Unit
main = do
  log "Linter migrate (Handlebars → MaxBars) tests"

  -- ── Render-equivalence oracle (mechanical, residual-free) ──

  -- inverted section {{^x}}…{{/x}} → {{#unless x}}…{{/unless}}
  rendersEquivalent "inverted section"
    "{{^items}}none{{/items}}"
    boolMatrix
  rendersEquivalent "inverted section w/ body content"
    "before {{^items}}empty list{{/items}} after"
    boolMatrix
  -- nested same-named inverted sections must pair correctly
  rendersEquivalent "nested inverted sections"
    "{{^items}}A{{^items}}B{{/items}}C{{/items}}"
    boolMatrix

  -- @index / @first / @last inside {{#each}}
  rendersEquivalent "each @index"
    "{{#each items}}{{@index}}:{{this}};{{/each}}"
    listMatrix
  rendersEquivalent "each @first @last"
    "{{#each items}}{{#if @first}}[{{/if}}{{this}}{{#if @last}}]{{/if}}{{/each}}"
    listMatrix
  -- @key inside {{#each}} over an object
  rendersEquivalent "each @key (object)"
    "{{#each m}}{{@key}}={{this}};{{/each}}"
    keyMatrix

  -- {{&x}} amp-unescaped → {{{x}}}
  rendersEquivalent "amp unescaped"
    "{{&x}}"
    ampMatrix
  rendersEquivalent "amp vs escaped side by side"
    "esc={{x}} raw={{&x}}"
    ampMatrix

  -- {{else if c}} → {{elif c}}
  rendersEquivalent "else if chain"
    "{{#if (gt n 10)}}big{{else if (gt n 0)}}small{{else}}neg{{/if}}"
    elifMatrix

  -- a mix: each with loop vars + inverted section + amp + elif
  rendersEquivalent "mixed migration"
    ( "{{#each items}}{{@index}}{{#if @first}}*{{/if}}{{this}}{{/each}}"
        <> "{{^items}}(none){{/items}}"
    )
    listMatrix

  -- ── Direct source-shape assertions ──
  migratesContaining "unless open shape" "{{^items}}none{{/items}}" "{% unless items %}"
  migratesContaining "unless close shape" "{{^items}}none{{/items}}" "{% endunless %}"
  -- ADR-021: `@index` migrates to the loop object, `@first` likewise; `@` is gone.
  migratesContaining "loop.index0 rewrite" "{{#each items}}{{@index}}{{/each}}" "loop.index0"
  migratesContaining "loop.first rewrite" "{{#each items}}{{@first}}{{/each}}" "{{loop.first}}"
  assertNotContaining "first @ dropped" "{{#each items}}{{@first}}{{/each}}" "@first"
  migratesContaining "amp to triple" "{{&x}}" "{{{x}}}"
  migratesContaining "elif rewrite" "{{#if a}}x{{else if b}}y{{/if}}" "{% elif b %}"

  -- Partials migrate to the `{% … %}` surface (ADR-039 item 5): the block-partial slot
  -- `{{> @partial-block}}` → `{% yield %}` (the `@partial-block` name must not survive,
  -- it is not valid MaxBars); a plain include `{{> name [ctx]}}` → `{% include "name" … %}`
  -- (name quoted, args kept); the Handlebars block-partial `{{#> name}}…{{/name}}` →
  -- `{% partial "name" %}…{% endpartial %}`.
  migratesContaining "partial-block → yield" "x {{> @partial-block}} y" "{% yield %}"
  assertNotContaining "partial-block @ dropped" "x {{> @partial-block}} y" "@partial-block"
  migratesContaining "partial include → {% include %}" "{{> header}}" "{% include \"header\" %}"
  migratesContaining "partial include keeps args" "{{> card user}}" "{% include \"card\" user %}"
  migratesContaining "block-partial → {% partial %}" "{{#>layout}}hi{{/layout}}"
    "{% partial \"layout\" %}hi{% endpartial %}"

  -- ADR-021: @../ and @root auto-migrate to the reserved variable model (no
  -- residual). @../index is the enclosing loop's index; @root.x is the root context.
  migratesContaining "@../index → loop.parent"
    "{{#each items}}{{#each this.sub}}{{@../index}}{{/each}}{{/each}}"
    "loop.parent.index0"
  migratesContaining "@root → root"
    "{{#each items}}{{@root.title}}{{/each}}"
    "root.title"
  assertNotContaining "@root @ dropped" "{{#each items}}{{@root.title}}{{/each}}" "@root"

  -- ── Residual assertions ──

  -- bare Mustache section {{#widget}}…{{/widget}} → ambiguous-section
  findResidual "ambiguous-section residual"
    "{{#widget}}content{{/widget}}"
    "ambiguous-section"
  -- a known block helper is NOT flagged ambiguous
  case migrateToMaxBars "{{#each items}}x{{/each}}" of
    Left e -> assert' ("each not ambiguous: migrate failed " <> show e) false
    Right res -> assert' "each must not be flagged ambiguous"
      (Array.null (Array.filter (\r -> r.kind == "ambiguous-section") res.residuals))

  -- set-delimiters → set-delimiters residual
  findResidual "set-delimiters residual"
    "{{=<% %>=}}<%x%>"
    "set-delimiters"

  -- every residual on a residual-rich template is well-formed (the bare section
  -- and the set-delimiters; `@root.x` auto-migrates, so it is no longer a residual).
  case migrateToMaxBars "{{#each items}}{{@root.x}}{{/each}}{{#widget}}y{{/widget}}{{=<% %>=}}" of
    Left e -> assert' ("well-formed: migrate failed " <> show e) false
    Right res -> do
      assert' "expected multiple residuals" (Array.length res.residuals >= 2)
      allResidualsWellFormed "multi" res.residuals

  log "Linter migrate tests passed"
