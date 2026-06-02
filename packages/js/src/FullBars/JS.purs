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
  , renderMinbars
  , astJson
  , compile
  , compileSurface
  , compileMaxbars
  , compileMinbars
  , compileMinbarsWithPartials
  , compileFor
  , renderSurfaceWithPartials
  , renderMustache
  , JsHelperFn
  , renderWith
  , safe
  , highlightSpans
  ) where

import Prelude

import Control.Monad.Error.Class (throwError)
import Data.Argonaut.Core (Json, caseJsonObject, caseJsonString, fromArray, fromBoolean, fromNumber, fromObject, fromString, jsonNull)
import Data.Array (elem, head, null, uncons) as Array
import Data.Either (Either(..), either)
import Data.Function.Uncurried (Fn1, Fn2, Fn3, Fn4, mkFn1, mkFn2, mkFn3, mkFn4)
import Data.Int (toNumber)
import Data.Map (empty, fromFoldable) as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Tuple (Tuple(..))
import FlatBars (Expr(..), ParseError, parse, parseErrorAt, parseWith, renderParseErrorAt)
import FlatBars.Error (Error(ArityError, HelperError))
import FlatBars.Highlight (HSpan, HighlightConfig, highlightSpans) as Highlight
import FlatBars.Json (fromJson, toJson)
import FlatBars.Lexer (defaultLexConfig)
import FlatBars.Token (defaultLexOptions)
import FlatBars.Value (Value(..))
import Foreign.Object as FO
import FullBars (RNode(..), desugarSurface, desugarSurfaceWith, lower)
import FullBars as FullBars
import FullBars.Compile (compileSurface) as Compile
import Kernel.Env (constOperation, pushFrame, refContext)
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

-- | Render a MinBars (Mustache) template against JS data. `renderMinbars(template, data)`.
renderMinbars :: Fn2 String Json Result
renderMinbars = mkFn2 \tpl json -> result (MinBars.renderMinDiag tpl (fromJson json))

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

--------------------------------------------------------------------------------
-- User-defined helpers (ADR-018)
--------------------------------------------------------------------------------

-- | An opaque host JS helper: `(...args) => value`. Marshalled by `renderWith`.
foreign import data JsHelperFn :: Type

-- | Invoke a host helper (by `name`, for diagnostics) over JSON-marshalled args,
-- | tagging the outcome: `"ok"` (payload is the value), `"safe"` (payload is raw
-- | markup, ⇒ `VSafe`), `"arity"` (a declared-arity mismatch, ⇒ `ArityError`,
-- | matching the prelude), or `"error"` (the thrown message, ⇒ `HelperError`).
-- | Never throws into PureScript.
foreign import callJsHelperImpl
  :: String -> JsHelperFn -> Array Json -> { tag :: String, payload :: Json }

-- | Invoke a host helper used as a *block* (ADR-020): Handlebars-style, with a
-- | trailing `options` object whose `fn`/`inverse` render the body / `{{else}}`
-- | clause. `currentCtx` is the context for a no-arg `options.fn()`; `renderBody`
-- | / `renderInverse` are pure thunks `(ctx, data) -> { ok, value, error }` (run
-- | `ctl.render`), which the FFI unwraps + throws in JS on `!ok`. `data` is the
-- | `options.fn(ctx, { data })` frame (its keys become scoped `@vars`), or null.
-- | Tags: `"safe"` (raw block output ⇒ `VSafe`), `"arity"`, `"error"`.
foreign import callJsBlockHelperImpl
  :: String
  -> JsHelperFn
  -> Array Json
  -> Json
  -> (Json -> Json -> { ok :: Boolean, value :: String, error :: String })
  -> (Json -> Json -> { ok :: Boolean, value :: String, error :: String })
  -> { tag :: String, payload :: Json }

-- | The `SafeString` equivalent a helper returns for raw markup. `safe(string)`.
foreign import safe :: String -> Json

-- | Render a *surface* (FullBars) template with host-registered inline helpers
-- | and partials. `renderWith(helpers, partials, template, data)`, where
-- | `helpers` is a plain `{ name: (…args) => value }` object and `partials` a
-- | `{ name: source }` object. A helper returns a value (a string is
-- | HTML-escaped in `pass:[{{ }}]`, raw in `pass:[{{{ }}}]`) or `safe(string)`
-- | for raw markup; a thrown helper surfaces as a render error. Mirrors the
-- | compiled path, which routes the same names through `rt.call`/`rt.register`.
renderWith :: Fn4 (FO.Object JsHelperFn) (FO.Object String) String Json Result
renderWith = mkFn4 \helpers partials tpl json ->
  let
    -- A host fn becomes an engine operation. Usage decides inline vs block
    -- (ADR-020): a non-empty `ctl.children` means it was called as
    -- `pass:[{{#name}}…{{/name}}]`. Inline (ADR-018): args marshal Value→JSON,
    -- the result JSON→Value (escaped `VString`, or `safe`→`VSafe`). Block:
    -- the fn is called Handlebars-style with `options.fn`/`inverse` rendering the
    -- body/`else` via `ctl.render`, and the result is raw (`VSafe`).
    mk name fn = \ctl args ->
      if Array.null ctl.children then case callJsHelperImpl name fn (map toJson args) of
        r
          | r.tag == "safe" -> pure (VSafe (caseJsonString "" identity r.payload))
          | r.tag == "arity" -> throwError (ArityError (caseJsonString "" identity r.payload))
          | r.tag == "error" -> throwError (HelperError (caseJsonString "" identity r.payload))
          | otherwise -> pure (fromJson r.payload)
      else
        let
          clause = ctl.clause "else"
          -- An `options.fn(ctx, { data })` frame: its keys become scoped `@vars`
          -- (constant helpers), layered over the inherited scope by `pushFrame`.
          dataFrame dataJson = caseJsonObject Map.empty
            ( \obj -> Map.fromFoldable
                ( map (\(Tuple k v) -> Tuple k (constOperation (fromJson v)))
                    (FO.toUnfoldable obj :: Array (Tuple String Json))
                )
            )
            dataJson
          renderClause nodes ctxJson dataJson =
            case ctl.render (pushFrame (dataFrame dataJson) (fromJson ctxJson) ctl.env) nodes of
              Right s -> { ok: true, value: s, error: "" }
              Left e -> { ok: false, value: "", error: show e }
          r = callJsBlockHelperImpl name fn (map toJson args) (toJson (refContext ctl.env))
            (renderClause clause.before)
            (renderClause (fromMaybe [] clause.body))
        in
          case r.tag of
            "arity" -> throwError (ArityError (caseJsonString "" identity r.payload))
            "error" -> throwError (HelperError (caseJsonString "" identity r.payload))
            _ -> pure (VSafe (caseJsonString "" identity r.payload))
    hs = map (\(Tuple n fn) -> Tuple n (mk n fn)) (FO.toUnfoldable helpers)
  in
    result (FullBars.renderSurfaceWithHelpers hs (FO.toUnfoldable partials) tpl (fromJson json))

-- | Compile a *core* template to JS ES-module source (`FlatBars.Compile`). The
-- | emitted module's default export is `function (data, rt)`; pair it with
-- | `runtime/flatbars-runtime.mjs`. `value` is the JS source on success.
compile :: Fn1 String Result
compile = mkFn1 \tpl -> compileResultAt tpl (RawBars.compileJs tpl)

-- | Compile a *surface* template to JS (desugars first). `compileSurface(template)`.
compileSurface :: Fn1 String Result
compileSurface = mkFn1 \tpl -> compileResultAt tpl (Compile.compileSurface tpl)

-- | Compile a *MaxBars* template to JS (infix/pipes/loop vars desugar first).
-- | `compileMaxbars(template)`.
compileMaxbars :: Fn1 String Result
compileMaxbars = mkFn1 \tpl -> compileResultAt tpl (MaxBars.compileMaxJs tpl)

-- | Compile a MinBars (Mustache) template to JS (ADR-016). `compileMinbars(template)`.
compileMinbars :: Fn1 String Result
compileMinbars = mkFn1 \tpl -> compileResultAt tpl (MinBars.compileMinJs tpl)

-- | Compile a MinBars template to JS with a set of named partials (each a
-- | Mustache source); `{{> name}}` is inlined. `compileMinbarsWithPartials(partials, template)`,
-- | where `partials` is a plain `{ name: source }` object.
compileMinbarsWithPartials :: Fn2 (FO.Object String) String Result
compileMinbarsWithPartials = mkFn2 \partials tpl ->
  compileResultAt tpl (MinBars.compileMinJsWith (FO.toUnfoldable partials) tpl)

-- | Compile a template to JS for a named dialect — one entry over the four
-- | per-dialect compilers. `compileFor(dialect, template)`, where `dialect` is
-- | `"rawbars"` | `"fullbars"` | `"maxbars"` | `"minbars"` (anything else is
-- | treated as `"fullbars"`). RawBars/FullBars/MaxBars share one emit driver
-- | (the surfaces desugar to the same core; xref ADR-011); MinBars compiles via
-- | its own inliner (ADR-016). For MinBars *with partials*, use
-- | `compileMinbarsWithPartials`. Equivalent to picking the matching
-- | `compile*` function by hand — provided so a host has a single call site.
compileFor :: Fn2 String String Result
compileFor = mkFn2 \dialect tpl -> compileResultAt tpl case dialect of
  "rawbars" -> RawBars.compileJs tpl
  "maxbars" -> MaxBars.compileMaxJs tpl
  "minbars" -> MinBars.compileMinJs tpl
  _ -> Compile.compileSurface tpl

-- | A compile outcome, with parse failures *located* as `line:column: message`
-- | (the same form `render`/`renderSurface` report) rather than the bare
-- | offset `show` form — so a host points an editor at the offending tag. Takes
-- | the source to resolve the `ParseError` offset to a line/column.
compileResultAt :: String -> Either ParseError String -> Result
compileResultAt src = case _ of
  Left pe -> { ok: false, value: "", error: renderParseErrorAt src pe }
  Right js -> { ok: true, value: js, error: "" }

--------------------------------------------------------------------------------
-- Syntax-highlighting spans (ADR-014)
--------------------------------------------------------------------------------

-- | Tokenize template source into highlight spans for the given dialect
-- | (`"rawbars"` | `"fullbars"` | `"maxbars"` | `"minbars"`; anything else is
-- | treated as `"fullbars"`). `highlightSpans(template, dialect)` returns a plain
-- | JS array of `{ from, to, kind }` (UTF-16 offsets + a kind tag). Highlighting
-- | derives from the engine lexer, so it is correct on set delimiters and on each
-- | dialect's tag boundaries and clause keywords (`{{else}}`/`{{elif}}`). See
-- | `FlatBars.Highlight`.
highlightSpans :: Fn2 String String (Array Highlight.HSpan)
highlightSpans = mkFn2 \tpl dialect -> Highlight.highlightSpans (highlightConfig dialect) tpl

-- | Map a dialect name to its highlight seams, mirroring each dialect's own parse
-- | settings (the single source of truth — drift is caught by `check:highlight`):
-- | RawBars/MaxBars/MinBars enable the `{{=A B=}}` set-delimiter tag
-- | (`mustacheDelims`), FullBars does not; the kernel dialects treat
-- | `else`/`elif` as clause separators, MinBars (Mustache) treats none.
highlightConfig :: String -> Highlight.HighlightConfig
highlightConfig = case _ of
  "maxbars" ->
    { lexConfig: maxOptions.lexConfig { keepLongComments = true }
    , lexOptions: maxOptions.lexOptions
    , clauseSeps: maxOptions.standaloneSeps
    }
  "rawbars" ->
    { lexConfig: withSetDelims, lexOptions: defaultLexOptions, clauseSeps: kernelClauses }
  "minbars" -> { lexConfig: withSetDelims, lexOptions: defaultLexOptions, clauseSeps: [] }
  _ ->
    { lexConfig: defaultLexConfig { keepLongComments = true }
    , lexOptions: defaultLexOptions
    , clauseSeps: kernelClauses
    }
  where
  -- Highlighting wants the long comments rendering drops, so it can colour them.
  withSetDelims = defaultLexConfig { mustacheDelims = true, keepLongComments = true }
  kernelClauses = [ "else", "elif" ]

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
                  [ Tuple "version" (str "flatbars-ast/v1"), Tuple "nodes" (arr (map rnode nodes)) ]
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
