-- | A thin, JS/TS-friendly facade over the FullBars engine (review P6), and the
-- | engine seam the polyglot lab (Brace Lab) consumes.
-- |
-- | The library renders against the core `Value` type with curried,
-- | `Either`-returning internals; this module is the public boundary: uncurried
-- | functions over plain JS data. `render`/`renderSurface` return a plain
-- | `{ ok, value, error }`; `astJson` returns the lowered AST as the lab's
-- | `{t:…}` JSON node shape (or `{error}`), so a JS host's AST-outline and
-- | data-access inspectors can walk it.
module FullBars.JS
  ( Result
  , render
  , renderSurface
  , renderMaxbars
  , astJson
  , compile
  , compileSurface
  , compileMaxbars
  , renderSurfaceWithPartials
  , renderMustache
  ) where

import Prelude

import BareBars (Expr(..), parse, parseErrorAt, parseWith)
import BareBars.Json (fromJson)
import BareBars.Value (Value(..))
import Data.Argonaut.Core (Json, fromArray, fromBoolean, fromNumber, fromObject, fromString, jsonNull)
import Data.Array (elem, head, null, uncons) as Array
import Data.Either (Either(..), either)
import Data.Function.Uncurried (Fn1, Fn2, Fn3, mkFn1, mkFn2, mkFn3)
import Data.Int (toNumber)
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Foreign.Object as FO
import FullBars (RNode(..), desugarSurface, desugarSurfaceWith, lower)
import FullBars as FullBars
import FullBars.Compile (compileSurface) as Compile
import MaxBars (maxLoopVars, maxOptions)
import MaxBars as MaxBars
import MinBars as MinBars
import RawBars as RawBars

-- | A render outcome as a plain JS object: `ok` selects `value` vs `error`.
type Result = { ok :: Boolean, value :: String, error :: String }

result :: Either String String -> Result
result = either (\e -> { ok: false, value: "", error: e }) (\v -> { ok: true, value: v, error: "" })

-- | Render a core-syntax template against JS data. `render(template, data)`.
render :: Fn2 String Json Result
render = mkFn2 \tpl json -> result (RawBars.renderDiag tpl (fromJson json))

-- | Render a surface-dialect template against JS data. `renderSurface(template, data)`.
renderSurface :: Fn2 String Json Result
renderSurface = mkFn2 \tpl json -> result (FullBars.renderSurfaceDiag tpl (fromJson json))

-- | Render a *MaxBars* template (FullBars surface + infix/pipes + bare loop
-- | variables) against JS data. `renderMaxbars(template, data)`.
renderMaxbars :: Fn2 String Json Result
renderMaxbars = mkFn2 \tpl json -> result (MaxBars.renderMax tpl (fromJson json))

-- | Render a surface template with a set of named partials (each a surface
-- | source). `renderSurfaceWithPartials(partials, template, data)`, where
-- | `partials` is a plain `{ name: source }` object — the lab's multi-document
-- | partials. `{{> name}}` renders the registered partial.
renderSurfaceWithPartials :: Fn3 (FO.Object String) String Json Result
renderSurfaceWithPartials = mkFn3 \partials tpl json ->
  result (FullBars.renderSurfaceWith (FO.toUnfoldable partials) tpl (fromJson json))

-- | Render a *MinBars* template (the mustache-conformant core dialect) with a
-- | set of named partials, against JS data. `renderMustache(partials, template,
-- | data)`, where `partials` is a plain `{ name: source }` object. Drives the
-- | mustache/spec conformance harness.
renderMustache :: Fn3 (FO.Object String) String Json Result
renderMustache = mkFn3 \partials tpl json ->
  result (MinBars.renderMinWith (FO.toUnfoldable partials) tpl (fromJson json))

-- | Compile a *core* template to JS ES-module source (`BareBars.Compile`). The
-- | emitted module's default export is `function (data, rt)`; pair it with
-- | `runtime/barebars-runtime.mjs`. `value` is the JS source on success.
compile :: Fn1 String Result
compile = mkFn1 \tpl -> compileResult (RawBars.compileJs tpl)

-- | Compile a *surface* template to JS (desugars first). `compileSurface(template)`.
compileSurface :: Fn1 String Result
compileSurface = mkFn1 \tpl -> compileResult (Compile.compileSurface tpl)

-- | Compile a *MaxBars* template to JS (infix/pipes/loop vars desugar first).
-- | `compileMaxbars(template)`.
compileMaxbars :: Fn1 String Result
compileMaxbars = mkFn1 \tpl -> compileResult (MaxBars.compileMaxJs tpl)

compileResult :: forall e. Show e => Either e String -> Result
compileResult = case _ of
  Left e -> { ok: false, value: "", error: show e }
  Right js -> { ok: true, value: js, error: "" }

--------------------------------------------------------------------------------
-- AST for the polyglot lab seam
--------------------------------------------------------------------------------

-- | Parse + lower a template to the lab's `{ ast: { version, nodes } }` JSON (or
-- | `{ error: { message, start, end } }`). `dialect` is `"core"` or `"surface"`
-- | (surface desugars first). The node shape matches the host's `mapNode`
-- | contract: `text`/`emit`/`if`/`unless`/`each`/`with`/`raw`/`sep`/custom-block,
-- | with expressions as `lit`/`identifier`/`path`/`context`/`call`/data vars.
astJson :: Fn2 String String Json
astJson = mkFn2 \dialect src ->
  case (if dialect == "maxbars" then parseWith maxOptions else parse) src of
    Left pe ->
      let
        d = parseErrorAt src pe
      in
        obj
          [ Tuple "error"
              ( obj
                  [ Tuple "message" (str d.message)
                  , Tuple "start" (int d.offset)
                  , Tuple "end" (int d.offset)
                  ]
              )
          ]
    Right { nodes: tmpl } ->
      let
        -- `core` is the austere syntax (no desugar); `surface` and `maxbars` both
        -- desugar (MaxBars adds bare loop variables via `maxLoopVars`).
        desugared = case dialect of
          "core" -> tmpl
          "maxbars" -> desugarSurfaceWith maxLoopVars tmpl
          _ -> desugarSurface tmpl
        nodes = lower desugared
      in
        obj
          [ Tuple "ast"
              ( obj
                  [ Tuple "version" (str "barebars-ast/v1"), Tuple "nodes" (arr (map rnode nodes)) ]
              )
          ]

--------------------------------------------------------------------------------
-- JSON builders
--------------------------------------------------------------------------------

obj :: Array (Tuple String Json) -> Json
obj kvs = fromObject (FO.fromFoldable kvs)

arr :: Array Json -> Json
arr = fromArray

str :: String -> Json
str = fromString

int :: Int -> Json
int n = fromNumber (toNumber n)

tt :: String -> Tuple String Json
tt t = Tuple "t" (str t)

ctx :: String -> Json
ctx kind = obj [ tt "context", Tuple "kind" (str kind) ]

--------------------------------------------------------------------------------
-- Node / expression mapping
--------------------------------------------------------------------------------

rnode :: RNode -> Json
rnode = case _ of
  RText s -> obj [ tt "text", Tuple "text" (str s) ]
  -- A `{{> name}}` partial reference desugars to an emitted `partial "name" …`
  -- call; surface it as a `{t:"partial"}` node so the dependency graph finds it.
  ROut escaped e -> case partialName e of
    Just name -> obj [ tt "partial", Tuple "name" (str name) ]
    Nothing ->
      obj
        [ tt "emit"
        , Tuple "expr" (rexpr e)
        , Tuple "escape" (str (if escaped then "html" else "none"))
        ]
  RIf c a b -> obj
    [ tt "if", Tuple "cond" (rexpr c), Tuple "then" (children a), Tuple "else" (children b) ]
  RUnless c a b -> obj
    [ tt "unless", Tuple "cond" (rexpr c), Tuple "then" (children a), Tuple "else" (children b) ]
  REach c a b -> obj
    [ tt "each", Tuple "subject" (rexpr c), Tuple "body" (children a), Tuple "else" (children b) ]
  RWith c a b -> obj
    [ tt "with", Tuple "subject" (rexpr c), Tuple "body" (children a), Tuple "else" (children b) ]
  -- `{{#inline "name"}}…{{/inline}}` defines a partial; `{{#partial name}}…`
  -- is a block partial use. Both name a partial via a leading string literal.
  RCall "inline" args ch | Just name <- litName args ->
    obj [ tt "inline", Tuple "name" (str name), Tuple "body" (children ch) ]
  RCall "partial" args ch | Just name <- litName args ->
    obj [ tt "partial", Tuple "name" (str name), Tuple "body" (children ch) ]
  RCall n args ch -> obj [ tt n, Tuple "args" (arr (map argOf args)), Tuple "body" (children ch) ]
  RSep n args -> obj [ tt "sep", Tuple "name" (str n), Tuple "args" (arr (map argOf args)) ]
  RRaw s -> obj [ tt "raw", Tuple "text" (str s) ]
  where
  children ns = arr (map rnode ns)

-- The static partial name of a `{{> name}}` use (`partial "name" ctx …`), or
-- Nothing for a dynamic partial (`{{> (expr)}}`).
partialName :: Expr -> Maybe String
partialName = case _ of
  App "partial" args -> litName args
  _ -> Nothing

-- The leading string-literal argument, if any — a partial/inline name.
litName :: Array Expr -> Maybe String
litName args = case Array.head args of
  Just (Lit (VString s)) -> Just s
  _ -> Nothing

argOf :: Expr -> Json
argOf e = obj [ Tuple "value" (rexpr e) ]

-- The scoped @data variables the host renders as their own `{t:name}` node.
dataVars :: Array String
dataVars =
  [ "index", "key", "first", "last", "parent-index", "parent-key", "parent-first", "parent-last" ]

rexpr :: Expr -> Json
rexpr = case _ of
  Lit v -> obj [ tt "lit", Tuple "value" (rlit v) ]
  App "this" [] -> ctx "this"
  App "root" [] -> ctx "root"
  App "parent" [] -> ctx "parent"
  App "lookup" args -> path args -- surface paths desugar to `lookup this seg…`
  App name [] ->
    if Array.elem name dataVars then obj [ tt name ]
    else obj [ tt "identifier", Tuple "name" (str name) ]
  App name args -> obj [ tt "call", Tuple "name" (str name), Tuple "args" (arr (map argOf args)) ]

-- `lookup this "a" "b"` ⇒ a path; `lookup this` ⇒ this; anything else (e.g.
-- `lookup (parent) …`) is kept as a plain call.
path :: Array Expr -> Json
path args = case Array.uncons args of
  Just { head: App "this" [], tail } ->
    if Array.null tail then ctx "this"
    else obj [ tt "path", Tuple "segments" (arr (map segment tail)) ]
  _ -> obj [ tt "call", Tuple "name" (str "lookup"), Tuple "args" (arr (map argOf args)) ]

segment :: Expr -> Json
segment = case _ of
  Lit (VString s) -> str s
  Lit (VNumber n) -> str (show n)
  App n _ -> str n
  _ -> str "?"

rlit :: Value -> Json
rlit = case _ of
  VString s -> str s
  VSafe s -> str s
  VNumber n -> fromNumber n
  VBool b -> fromBoolean b
  VNull -> jsonNull
  _ -> jsonNull
