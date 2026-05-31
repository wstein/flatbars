-- | The BareBars web playground — a Halogen SPA.
-- |
-- | It lexes, parses, validates, and renders BareBars *core* templates entirely
-- | in the browser (the `barebars` library compiled to JavaScript). Nothing is
-- | sent anywhere: the bundle is self-contained, so it works online and offline
-- | (open `dist/index.html` directly).
-- |
-- | Panels: a template editor and a JSON data editor on the left; an output
-- | pane on the right with four views — a sandboxed rendered preview, the HTML
-- | source, the parsed skeleton AST, and the schema-validation report.
module Playground.Main where

import Prelude

import BareBars (parse, preludeSchema, renderWith, validate)
import BareBars.Json (parseValue)
import BareBars.Syntax (Expr(..), Node(..))
import BareBars.Value (Value(..))
import BareBars.Walk (Issue)
import Data.Array as Array
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Foldable (find)
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Monoid (power)
import Data.String (Pattern(..), contains)
import Data.String.CodeUnits as SCU
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Effect (Effect)
import Effect.Class (liftEffect)
import Effect.Exception (throw)
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

data View = Rendered | Source | Ast | Validation

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

-- | A readable, indented view of the structural AST: `text`/`emit` leaves,
-- | `if …`/`each …` block heads, and `else` separators outdented to the block.
astText :: State -> String
astText st = case parse st.template of
  Left e -> "Parse error: " <> show e
  Right nodes -> joinWith "\n" (Array.concatMap (renderNode 0) nodes)

renderNode :: Int -> Node -> Array String
renderNode d = case _ of
  Content s -> [ line d ("text " <> shorten (show s)) ]
  Output _ e -> [ line d ("emit " <> exprStr e) ]
  Sep _ name args -> [ line d (name <> argsSuffix args) ]
  RawBlock _ name args raw ->
    [ line d (name <> argsSuffix args <> " (raw)"), line (d + 1) ("text " <> shorten (show raw)) ]
  Block _ name args body ->
    Array.cons (line d (name <> argsSuffix args))
      (Array.concatMap (\child -> renderNode (childDepth child) child) body)
  where
  -- A separator sits at the block's own depth (so `else` aligns under `if`);
  -- every other child is indented one level.
  childDepth = case _ of
    Sep _ _ _ -> d
    _ -> d + 1

line :: Int -> String -> String
line d s = power "  " d <> s

shorten :: String -> String
shorten s = if SCU.length s > 64 then SCU.take 63 s <> "…" else s

argsSuffix :: Array Expr -> String
argsSuffix args = if Array.null args then "" else " " <> joinWith " " (map exprStr args)

exprStr :: Expr -> String
exprStr = case _ of
  Lit v -> litStr v
  App "this" [] -> "this"
  App "lookup" args -> fromMaybe (appStr "lookup" args) (dottedPath args)
  App name [] -> name
  App name args -> appStr name args

-- Parenthesize an argument only when it renders as a multi-token application
-- (so a path like `user` or a literal stays bare, but `upcase x` gets parens).
argStr :: Expr -> String
argStr e =
  let
    s = exprStr e
  in
    if contains (Pattern " ") s then "(" <> s <> ")" else s

appStr :: String -> Array Expr -> String
appStr name args = name <> " " <> joinWith " " (map argStr args)

-- `lookup this "a" "b"` → `a.b` (the common path shape).
dottedPath :: Array Expr -> Maybe String
dottedPath args = case Array.uncons args of
  Just { head: App "this" [], tail } | not (Array.null tail) ->
    joinWith "." <$> traverse keyStr tail
  _ -> Nothing
  where
  keyStr = case _ of
    Lit (VString s) -> Just s
    Lit (VNumber n) -> Just (show n)
    _ -> Nothing

litStr :: Value -> String
litStr = case _ of
  VString s -> show s
  VNumber n -> show n
  VBool b -> if b then "true" else "false"
  VNull -> "null"
  _ -> "…"

validationIssues :: State -> Either String (Array Issue)
validationIssues st = case parse st.template of
  Left e -> Left ("Parse error: " <> show e)
  Right nodes -> Right (validate preludeSchema nodes)

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
            , tab "AST" Ast
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
    Ast -> HH.pre [ cls "code" ] [ HH.text (astText st) ]
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
