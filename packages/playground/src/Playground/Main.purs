-- | The BareBars web playground — a Halogen SPA.
-- |
-- | It lexes, parses, validates, and renders BareBars *core* templates entirely
-- | in the browser (the `barebars` framework + `flatbars` engine compiled to
-- | JavaScript). Nothing is
-- | sent anywhere: the bundle is self-contained, so it works online and offline
-- | (open `dist/index.html` directly).
-- |
-- | Panels: a template editor and a JSON data editor on the left; an output
-- | pane on the right with five views — a sandboxed rendered preview, the HTML
-- | source, the structural Parse tree, the lowered Real AST (`FlatBars.Lower`),
-- | and the schema + escaping validation report.
module Playground.Main where

import Prelude

import BareBars (parse, validate)
import BareBars.Json (parseValue)
import BareBars.Syntax (Expr(..), Node(..))
import BareBars.Walk (Issue)
import Data.Array as Array
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Foldable (find)
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Monoid (power)
import Data.String.Common (joinWith)
import Effect (Effect)
import Effect.Class (liftEffect)
import Effect.Exception (throw)
import FlatBars (RNode(..), escapingWarnings, lower, preludeSchema, renderWith)
import Halogen as H
import Halogen.Aff as HA
import Halogen.HTML as HH
import Halogen.HTML.Core (AttrName(..), ClassName(..), ElemName(..))
import Halogen.HTML.Events as HE
import Halogen.HTML.Properties as HP
import Halogen.VDom.Driver (runUI)
import Web.DOM.ParentNode (QuerySelector(..))

main :: Effect Unit
main = HA.runHalogenAff do
  HA.awaitLoad
  mEl <- HA.selectElement (QuerySelector "#app")
  case mEl of
    Just el -> void (runUI component unit el)
    Nothing -> liftEffect (throw "BareBars playground: #app mount point not found")

--------------------------------------------------------------------------------
-- Examples
--------------------------------------------------------------------------------

type Example = { id :: String, label :: String, template :: String, dataText :: String }

examples :: Array Example
examples =
  [ { id: "greeting"
    , label: "Greeting"
    , template: "<h1>Hello {{{esc_html (lookup this \"name\")}}}!</h1>"
    , dataText: "{ \"name\": \"World\" }"
    }
  , { id: "list"
    , label: "List (each)"
    , template:
        "<ul>\n{{#each (lookup this \"items\")}}  <li>{{{index}}}. {{{esc_html this}}}</li>\n{{/each}}</ul>"
    , dataText: "{ \"items\": [\"alpha\", \"beta\", \"gamma\"] }"
    }
  , { id: "conditional"
    , label: "Conditional (clauses)"
    , template:
        "{{#if (lookup this \"loggedIn\")}}<p>Welcome back, {{{esc_html (lookup this \"user\")}}}.</p>{{else}}<p>Please sign in.</p>{{/if}}"
    , dataText: "{ \"loggedIn\": true, \"user\": \"Ada\" }"
    }
  , { id: "object"
    , label: "Object (each + key)"
    , template:
        "<dl>\n{{#each (lookup this \"profile\")}}  <dt>{{{esc_html key}}}</dt><dd>{{{esc_html this}}}</dd>\n{{/each}}</dl>"
    , dataText: "{ \"profile\": { \"name\": \"Grace\", \"role\": \"Compiler\" } }"
    }
  , { id: "table"
    , label: "Table (with)"
    , template:
        "{{#with (lookup this \"report\")}}<table>\n{{#each (lookup this \"rows\")}}  <tr><td>{{{esc_html (lookup this \"k\")}}}</td><td>{{{esc_html (lookup this \"v\")}}}</td></tr>\n{{/each}}</table>{{/with}}"
    , dataText:
        "{ \"report\": { \"rows\": [ { \"k\": \"CPU\", \"v\": \"42%\" }, { \"k\": \"RAM\", \"v\": \"7.1 GB\" } ] } }"
    }
  , { id: "truthiness"
    , label: "Truthiness (vs Handlebars)"
    , template:
        "<style>\n  .tt-wrap{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;color:#18181b;-webkit-font-smoothing:antialiased;}\n  .tt-title{font-size:12.5px;font-weight:600;color:#71717a;letter-spacing:.08em;text-transform:uppercase;margin:0 0 14px;}\n  table.tt{border-collapse:separate;border-spacing:0;width:100%;max-width:880px;background:#fff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden;font-size:17px;box-shadow:0 1px 2px rgba(24,24,27,.05),0 12px 28px -16px rgba(24,24,27,.18);}\n  .tt th,.tt td{padding:14px 22px;text-align:left;border-bottom:1px solid #f0f0f1;border-right:1px solid #f0f0f1;vertical-align:middle;}\n  .tt th:last-child,.tt td:last-child{border-right:none;}\n  .tt tbody tr:last-child td{border-bottom:none;}\n  .tt thead th{background:#f4f4f5;font-weight:600;font-size:15px;letter-spacing:.01em;color:#3f3f46;}\n  .tt code{font-family:ui-monospace,\"SF Mono\",SFMono-Regular,Menlo,Consolas,monospace;background:#f3f3f5;border:1px solid #e7e7ea;padding:2px 8px;border-radius:6px;font-size:14.5px;color:#18181b;}\n  .tt .desc{color:#71717a;}\n  .tt .truthy{color:#15803d;font-weight:600;}\n  .tt .falsy{color:#be123c;font-weight:600;}\n  .tt .parity{text-align:center;}\n  .tt .parity svg{width:20px;height:20px;display:inline-block;vertical-align:middle;}\n  .tt col.c-fb{width:150px;}\n  .tt col.c-hb{width:236px;}\n  .tt col.c-p{width:104px;}\n</style>\n<div class=\"tt-wrap\">\n  <p class=\"tt-title\">Truthiness — FlatBars vs Handlebars</p>\n  <table class=\"tt\">\n    <colgroup><col><col class=\"c-fb\"><col class=\"c-hb\"><col class=\"c-p\"></colgroup>\n    <thead>\n      <tr><th>Value</th><th>FlatBars</th><th>Handlebars</th><th class=\"parity\">Parity</th></tr>\n    </thead>\n    <tbody>\n    {{#each (lookup this \"cases\")}}\n      <tr>\n        <td><code>{{{esc_html (lookup this \"token\")}}}</code>{{#if (lookup this \"desc\")}} <span class=\"desc\">({{{esc_html (lookup this \"desc\")}}})</span>{{/if}}{{#if (lookup this \"cont\")}} <span class=\"desc\">{{{esc_html (lookup this \"cont\")}}}</span> <code>{{{esc_html (lookup this \"token2\")}}}</code>{{/if}}</td>\n        <td>{{#if (lookup this \"includeZero\")}}{{#if (lookup this \"v\") (dict \"includeZero\" true)}}<span class=\"truthy\">truthy</span>{{else}}<span class=\"falsy\">falsy</span>{{/if}}{{else}}{{#if (lookup this \"v\")}}<span class=\"truthy\">truthy</span>{{else}}<span class=\"falsy\">falsy</span>{{/if}}{{/if}}</td>\n        <td>{{#if (lookup this \"hbTruthy\")}}<span class=\"truthy\">truthy</span>{{else}}<span class=\"falsy\">falsy</span>{{/if}}</td>\n        <td class=\"parity\">{{#if (lookup this \"match\")}}<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#16a34a\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-label=\"match\"><path d=\"M4 12.5l5 5L20 6.5\"/></svg>{{else}}<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#be123c\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-label=\"differ\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg>{{/if}}</td>\n      </tr>\n    {{/each}}\n    </tbody>\n  </table>\n</div>"
    , dataText:
        "{ \"cases\":\n  [ { \"token\": \"false\", \"v\": false, \"hbTruthy\": false, \"match\": true }\n  , { \"token\": \"true\", \"v\": true, \"hbTruthy\": true, \"match\": true }\n  , { \"token\": \"null\", \"v\": null, \"hbTruthy\": false, \"match\": true }\n  , { \"token\": \"\\\"\\\"\", \"desc\": \"empty string\", \"v\": \"\", \"hbTruthy\": false, \"match\": true }\n  , { \"token\": \"\\\"hi\\\"\", \"desc\": \"non-empty string\", \"v\": \"hi\", \"hbTruthy\": true, \"match\": true }\n  , { \"token\": \"\\\"0\\\"\", \"desc\": \"string zero\", \"v\": \"0\", \"hbTruthy\": true, \"match\": true }\n  , { \"token\": \"\\\" \\\"\", \"desc\": \"single space\", \"v\": \" \", \"hbTruthy\": true, \"match\": true }\n  , { \"token\": \"0\", \"desc\": \"number zero\", \"v\": 0, \"hbTruthy\": false, \"match\": true }\n  , { \"token\": \"0\", \"cont\": \"with\", \"token2\": \"includeZero\", \"includeZero\": true, \"v\": 0, \"hbTruthy\": true, \"match\": true }\n  , { \"token\": \"42\", \"desc\": \"non-zero number\", \"v\": 42, \"hbTruthy\": true, \"match\": true }\n  , { \"token\": \"[]\", \"desc\": \"empty array\", \"v\": [], \"hbTruthy\": false, \"match\": true }\n  , { \"token\": \"[1, 2]\", \"desc\": \"array\", \"v\": [ 1, 2 ], \"hbTruthy\": true, \"match\": true }\n  , { \"token\": \"{}\", \"desc\": \"empty object\", \"v\": {}, \"hbTruthy\": true, \"match\": true }\n  , { \"token\": \"{ k: 1 }\", \"desc\": \"object\", \"v\": { \"k\": 1 }, \"hbTruthy\": true, \"match\": true }\n  ] }"
    }
  ]

--------------------------------------------------------------------------------
-- Component
--------------------------------------------------------------------------------

data View = Rendered | Source | Parse | Real | Validation

derive instance eqView :: Eq View

type State =
  { template :: String
  , dataText :: String
  , view :: View
  }

data Action
  = SetTemplate String
  | SetData String
  | SetView View
  | LoadExample String

component :: forall q i o m. H.Component q i o m
component =
  H.mkComponent
    { initialState
    , render
    , eval: H.mkEval H.defaultEval { handleAction = handleAction }
    }
  where
  initialState _ =
    let
      ex = fromMaybe seed (Array.head examples)
    in
      { template: ex.template, dataText: ex.dataText, view: Rendered }

  seed = { id: "", label: "", template: "", dataText: "null" }

handleAction :: forall o m. Action -> H.HalogenM State Action () o m Unit
handleAction = case _ of
  SetTemplate t -> H.modify_ _ { template = t }
  SetData d -> H.modify_ _ { dataText = d }
  SetView v -> H.modify_ _ { view = v }
  LoadExample eid -> case find (\e -> e.id == eid) examples of
    Just e -> H.modify_ _ { template = e.template, dataText = e.dataText }
    Nothing -> pure unit

--------------------------------------------------------------------------------
-- Derived results (pure)
--------------------------------------------------------------------------------

-- | Render the template against the JSON data, or an explanatory error.
renderResult :: State -> Either String String
renderResult st = do
  value <- lmap (\e -> "Data JSON error: " <> e) (parseValue st.dataText)
  renderWith st.template value

-- | A readable view of the *structural* AST. It hides nothing — every node,
-- | expression, and literal is shown — but the whole tree is expanded one line
-- | per node, with each level indented. Nested expressions (`App`/`Lit`) are
-- | expanded the same way, so a deep `lookup`/`esc_html` call reads as a tree
-- | instead of a single dense `show` line.
astText :: State -> String
astText st = case parse st.template of
  Left e -> "Parse error: " <> show e
  Right nodes -> joinWith "\n" (Array.concatMap (renderNode 0) nodes)

renderNode :: Int -> Node -> Array String
renderNode d = case _ of
  Content s -> [ line d ("Content " <> show s) ]
  Output _ e -> Array.cons (line d "Output") (renderExpr (d + 1) e)
  Sep _ name args -> headArgs d "Sep" name args
  RawBlock _ name args raw ->
    headArgs d "RawBlock" name args `Array.snoc` line (d + 1) (show raw)
  Block _ name args body ->
    -- block head + arg exprs and body nodes both indented one level beneath it
    Array.cons (line d ("Block " <> show name))
      (Array.concatMap (renderExpr (d + 1)) args <> Array.concatMap (renderNode (d + 1)) body)

-- | Render an expression as an indented tree. A nullary `App`/a literal is a
-- | single line; an applied `App` puts each argument on its own indented line.
renderExpr :: Int -> Expr -> Array String
renderExpr d = case _ of
  Lit v -> [ line d ("Lit " <> show v) ]
  App name args
    | Array.null args -> [ line d ("App " <> show name <> " []") ]
    | otherwise -> Array.cons (line d ("App " <> show name))
        (Array.concatMap (renderExpr (d + 1)) args)

-- | A `name + arg-exprs` header line, with the args expanded beneath it (or an
-- | inline `[]` when there are none).
headArgs :: Int -> String -> String -> Array Expr -> Array String
headArgs d label name args
  | Array.null args = [ line d (label <> " " <> show name <> " []") ]
  | otherwise = Array.cons (line d (label <> " " <> show name))
      (Array.concatMap (renderExpr (d + 1)) args)

line :: Int -> String -> String
line d s = power "  " d <> s

-- | The *real* AST — `FlatBars.Lower.lower` of the structural tree, expanded
-- | the same way. Clauses become labelled branches and escaping is explicit
-- | (`escaped`/`raw`); condition/collection expressions are expanded inline.
realText :: State -> String
realText st = case parse st.template of
  Left e -> "Parse error: " <> show e
  Right t -> joinWith "\n" (Array.concatMap (renderReal 0) (lower t))

renderReal :: Int -> RNode -> Array String
renderReal d = case _ of
  RText s -> [ line d ("RText " <> show s) ]
  ROut esc e ->
    Array.cons (line d ("ROut " <> if esc then "escaped" else "raw")) (renderExpr (d + 1) e)
  RIf c a b -> ctl "RIf" c (branch "then" a <> branch "else" b)
  RUnless c a b -> ctl "RUnless" c (branch "body" a <> branch "else" b)
  REach c a b -> ctl "REach" c (branch "body" a <> branch "empty" b)
  RWith c a b -> ctl "RWith" c (branch "body" a <> branch "else" b)
  RCall n args ch ->
    Array.cons (line d ("RCall " <> show n))
      (Array.concatMap (renderExpr (d + 1)) args <> Array.concatMap (renderReal (d + 1)) ch)
  RSep n args -> headArgs d "RSep" n args
  RRaw s -> [ line d ("RRaw " <> show s) ]
  where
  -- a control node: head, its condition/collection expr, then the branches
  ctl label c rest = Array.cons (line d label) (renderExpr (d + 1) c <> rest)

  branch label nodes =
    if Array.null nodes then []
    else Array.cons (line (d + 1) (label <> ":")) (Array.concatMap (renderReal (d + 2)) nodes)

validationIssues :: State -> Either String (Array Issue)
validationIssues st = case parse st.template of
  Left e -> Left ("Parse error: " <> show e)
  Right nodes -> Right (validate preludeSchema nodes <> escapingWarnings nodes)

--------------------------------------------------------------------------------
-- View
--------------------------------------------------------------------------------

cls :: forall r i. String -> HP.IProp (class :: String | r) i
cls = HP.class_ <<< ClassName

render :: forall m. State -> H.ComponentHTML Action () m
render st =
  HH.div [ HP.id "app-root" ]
    [ header
    , HH.main_
        [ HH.div [ cls "col" ]
            [ editorPane "Template" st.template SetTemplate
            , editorPane "Data (JSON)" st.dataText SetData
            ]
        , HH.div [ cls "col" ] [ outputPane st ]
        ]
    , footer st
    ]

header :: forall m. H.ComponentHTML Action () m
header =
  HH.header [ cls "bar" ]
    [ HH.span [ cls "wm" ] [ HH.text "bare", HH.b_ [ HH.text "bars" ], HH.text " playground" ]
    , HH.span [ cls "spacer" ] []
    , HH.label_ [ HH.text "example" ]
    , HH.select [ HE.onValueChange LoadExample ]
        (map (\e -> HH.option [ HP.value e.id ] [ HH.text e.label ]) examples)
    ]

editorPane
  :: forall m. String -> String -> (String -> Action) -> H.ComponentHTML Action () m
editorPane title value act =
  HH.div [ cls "pane" ]
    [ HH.div [ cls "head" ] [ HH.text title ]
    , HH.textarea
        [ HP.value value
        , HP.spellcheck false
        , HE.onValueInput act
        ]
    ]

outputPane :: forall m. State -> H.ComponentHTML Action () m
outputPane st =
  HH.div [ cls "pane" ]
    [ HH.div [ cls "head" ]
        [ HH.text "Output"
        , HH.div [ cls "tabs" ]
            [ tab "Rendered" Rendered
            , tab "HTML" Source
            , tab "Parse tree" Parse
            , tab "Real AST" Real
            , tab "Validation" Validation
            ]
        ]
    , HH.div [ cls "out" ] [ body ]
    ]
  where
  tab label v =
    HH.button
      [ cls (if st.view == v then "active" else "")
      , HE.onClick \_ -> SetView v
      ]
      [ HH.text label ]

  body = case st.view of
    Rendered -> case renderResult st of
      Left err -> HH.div [ cls "banner" ] [ HH.text err ]
      Right out ->
        HH.element (ElemName "iframe")
          [ cls "preview"
          , HP.attr (AttrName "sandbox") ""
          , HP.attr (AttrName "srcdoc") out
          ]
          []
    Source -> case renderResult st of
      Left err -> HH.div [ cls "banner" ] [ HH.text err ]
      Right out -> HH.pre [ cls "code" ] [ HH.text out ]
    Parse -> HH.pre [ cls "code" ] [ HH.text (astText st) ]
    Real -> HH.pre [ cls "code" ] [ HH.text (realText st) ]
    Validation -> case validationIssues st of
      Left err -> HH.div [ cls "banner" ] [ HH.text err ]
      Right [] -> HH.ul [ cls "issues" ] [ HH.li [ cls "none" ] [ HH.text "✓ no issues" ] ]
      Right issues -> HH.ul [ cls "issues" ] (map issueRow issues)

  issueRow issue =
    HH.li [ cls (show issue.severity) ]
      [ HH.text (show issue.severity <> ": " <> issue.message) ]

footer :: forall m. State -> H.ComponentHTML Action () m
footer st =
  HH.footer [ cls "status" ]
    [ statusItem "template" (isRight parsed) (parseLabel parsed)
    , statusItem "data" (isRight dataParsed) (dataLabel dataParsed)
    , HH.span_ [ HH.text issueSummary ]
    ]
  where
  parsed = parse st.template
  dataParsed = parseValue st.dataText

  parseLabel = case _ of
    Left e -> show e
    Right nodes -> show (Array.length nodes) <> " nodes"
  dataLabel = case _ of
    Left _ -> "invalid JSON"
    Right _ -> "ok"
  issueSummary = case validationIssues st of
    Right issues
      | Array.null issues -> "✓ valid against prelude schema"
      | otherwise -> show (Array.length issues) <> " validation issue(s)"
    Left _ -> "—"

  statusItem name ok label =
    HH.span_
      [ HH.span [ cls ("dot " <> if ok then "ok" else "bad") ] []
      , HH.text (name <> ": " <> label)
      ]

isRight :: forall a b. Either a b -> Boolean
isRight = case _ of
  Right _ -> true
  Left _ -> false
