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
