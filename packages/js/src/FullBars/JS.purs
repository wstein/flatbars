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
  , AnalyseResult
  , LintResult
  , MigrateOutcome
  , render
  , analyze
  , analyzeWith
  , JsPathSchema
  , lint
  , migrate
  , renderSurface
  , renderMaxbars
  , renderMaxbarsWithPartials
  , renderMinbars
  , renderMinbarsCompat
  , renderMinbarsCompatWithPartials
  , astJson
  , compile
  , compileSurface
  , compileMaxbars
  , compileMaxbarsWithPartials
  , compileMinbars
  , compileMinbarsCompat
  , compileMinbarsWithPartials
  , compileMinbarsCompatWithPartials
  , compileFor
  , renderSurfaceWithPartials
  , renderSurfaceI18n
  , JsTranslator
  , renderMustache
  , JsHelperFn
  , renderWith
  , renderRawWith
  , renderMaxWith
  , safe
  , highlightSpans
  , tokenize
  , diagnostics
  ) where

import Prelude

import Control.Monad.Error.Class (throwError)
import Data.Argonaut.Core (Json, caseJsonArray, caseJsonObject, caseJsonString, fromArray, fromBoolean, fromNumber, fromObject, fromString, jsonNull)
import Data.Array (elem, head, length, null, take, uncons, zipWith) as Array
import Data.Either (Either(..), either)
import Data.Function.Uncurried (Fn1, Fn2, Fn3, Fn4, mkFn1, mkFn2, mkFn3, mkFn4)
import Data.Int (toNumber)
import Data.Map (fromFoldable, union) as Map
import Data.Maybe (Maybe(..), fromMaybe, isJust, maybe)
import Data.String (Pattern(..), indexOf)
import Data.String.Common (joinWith)
import Data.Tuple (Tuple(..))
import FlatBars (Expr(..), ParseError, defaultParseOptions, parseErrorAt, parseRecovering, parseWith, renderParseErrorAt, renderParseErrorsAt)
import FlatBars.Error (Error(ArityError, HelperError), ParseDiagnostic)
import FlatBars.Highlight (HSpan, HighlightConfig, TSpan, highlightSpans, tokenizeSpans) as Highlight
import FlatBars.Json (fromJson, toJson)
import FlatBars.Lexer (defaultLexConfig)
import FlatBars.Span (lineColumn, spanText)
import FlatBars.Token (defaultLexOptions)
import FlatBars.Value (Value(..))
import Foreign.Object as FO
import FullBars (RNode(..), Translator, desugarSurface, desugarSurfaceWith, lower)
import FullBars as FullBars
import FullBars.Compile (compileSurface) as Compile
import Kernel.Analyse (Finding, PathSchema) as Analyse
import Kernel.Engine (Operation)
import Kernel.Env (RefEnv, constOperation, pushFrame, refContext)
import Kernel.Walk (Severity)
import Linter.Aliases (aliasWarnings, scopedCanonWarnings)
import Linter.Migrate (migrateToMaxBars)
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

-- | An analyse outcome (ADR-022 Part B) as a plain JS object: structured
-- | `findings` (for the Lab's Truthiness dock panel), the markdown `report`, the
-- | JSONata cleanup `jsonata` scaffold, and the byte-identical `output`;
-- | `ok`/`error` carry a parse/eval failure.
type AnalyseResult =
  { ok :: Boolean
  , findings ::
      Array
        { kind :: String
        , line :: Int
        , column :: Int
        , tag :: String
        , value :: String
        , flips :: Array String
        , fix :: String
        , path :: String
        }
  , report :: String
  , jsonata :: String
  , output :: String
  , evaluated :: Int
  , error :: String
  }

-- | Analyse a FullBars surface template against JS data: render and report every
-- | truthiness decision that would branch differently on another engine — observed
-- | *and* the symbolic same-type potential what-ifs (ADR-030). `analyze(template,
-- | data)`.
analyze :: Fn2 String Json AnalyseResult
analyze = mkFn2 \tpl json -> analyseResult (FullBars.analyseSurface tpl (fromJson json))

-- | `analyze` with a host `PathSchema` (ADR-030): `schema(path, value) => boolean`
-- | answers "could this path hold this value?", suppressing potential findings the
-- | host's types rule out. `analyzeWith(schema, template, data)`.
analyzeWith :: Fn3 JsPathSchema String Json AnalyseResult
analyzeWith = mkFn3 \schema tpl json ->
  analyseResult (FullBars.analyseSurfaceWith (toPathSchema schema) tpl (fromJson json))

-- | Shared marshalling of an `analyseSurface*` outcome to the JS `AnalyseResult`.
analyseResult
  :: Either String
       { output :: String
       , report :: String
       , jsonata :: String
       , findings :: Array Analyse.Finding
       , evaluated :: Int
       }
  -> AnalyseResult
analyseResult = case _ of
  Left e -> { ok: false, findings: [], report: "", jsonata: "", output: "", evaluated: 0, error: e }
  Right r ->
    { ok: true
    , findings: r.findings
    , report: r.report
    , jsonata: r.jsonata
    , output: r.output
    , evaluated: r.evaluated
    , error: ""
    }

-- | A lint outcome (`Linter.Aliases`, the on-demand canonicalization lints) as a
-- | plain JS object: structured `findings` (severity, the offending `name`, the
-- | message pointing at the canonical form) and a `report` string that mirrors the
-- | `flatbars lint` CLI. `ok`/`error` carry a parse failure.
type LintResult =
  { ok :: Boolean
  , findings ::
      Array { severity :: String, name :: String, message :: String, line :: Int, column :: Int }
  , report :: String
  , error :: String
  }

-- | Lint a template for deprecated aliases and non-canonical scoped variables.
-- | `lint(template, dialect)`, where `dialect` is `"rawbars"` | `"fullbars"` |
-- | `"maxbars"` (anything else is treated as `"rawbars"`). FullBars lints aliases
-- | only (its `@`-data spellings are canonical there); RawBars/MaxBars also flag
-- | non-canonical scoped variables (`index` → `index0`, `partial-block` → `yield`).
-- | Never blocks rendering — this is a host/CI hygiene check (ADR-019).
lint :: Fn2 String String LintResult
lint = mkFn2 \tpl dialect ->
  let
    surface = dialect == "fullbars"
    opts = case dialect of
      "maxbars" -> maxOptions
      "fullbars" -> defaultParseOptions
      _ -> RawBars.coreOptions
  in
    case parseWith opts tpl of
      Left pes -> { ok: false, findings: [], report: "", error: renderParseErrorsAt tpl pes }
      Right { nodes } ->
        let
          issues = aliasWarnings nodes <> (if surface then [] else scopedCanonWarnings nodes)
          fmt i = sevText i.severity <> ": " <> i.message
          -- Refine the location to the offending NAME within its tag rather than
          -- the tag start: scan the tag slice for `name` and offset into it. The
          -- skeleton `Expr` carries no per-name spans, so `OperationRef.span` is the
          -- enclosing tag; this tag-local scan recovers name precision for the Lab's
          -- Lint-panel click-to-jump. A name repeated in one tag resolves to its
          -- first occurrence (a rare, minor imprecision; the tag is still correct).
          locate i = lineColumn tpl
            (i.span.start + fromMaybe 0 (indexOf (Pattern i.name) (spanText tpl i.span)))
        in
          { ok: true
          , findings: map
              ( \i ->
                  let
                    lc = locate i
                  in
                    { severity: sevText i.severity
                    , name: i.name
                    , message: i.message
                    , line: lc.line
                    , column: lc.column
                    }
              )
              issues
          , report:
              if Array.null issues then "ok: no lint findings" else joinWith "\n" (map fmt issues)
          , error: ""
          }

-- | The CLI/host spelling of a lint severity (matches `Show Severity`).
sevText :: Severity -> String
sevText = show

-- | A migrate outcome (`Linter.Migrate`) as a plain JS object: the rewritten
-- | MaxBars `source`, and the `residuals` the migrator flagged but did not rewrite
-- | (each a `kind`, a `message`, and a `suggestion`). `migrate(template)` —
-- | Handlebars → MaxBars source. `ok`/`error` carry a lex failure.
type MigrateOutcome =
  { ok :: Boolean
  , source :: String
  , residuals :: Array { kind :: String, message :: String, suggestion :: String }
  , error :: String
  }

migrate :: Fn1 String MigrateOutcome
migrate = mkFn1 \tpl -> case migrateToMaxBars tpl of
  Left pe -> { ok: false, source: "", residuals: [], error: renderParseErrorAt tpl pe }
  Right r ->
    { ok: true
    , source: r.source
    , residuals: map (\x -> { kind: x.kind, message: x.message, suggestion: x.suggestion })
        r.residuals
    , error: ""
    }

-- | Render a surface-dialect template against JS data. `renderSurface(template, data)`.
renderSurface :: Fn2 String Json Result
renderSurface = mkFn2 \tpl json -> result (FullBars.renderSurfaceDiag tpl (fromJson json))

-- | Render a *MaxBars* template (FullBars surface + infix/pipes + bare loop
-- | variables) against JS data. `renderMaxbars(template, data)`.
renderMaxbars :: Fn2 String Json Result
renderMaxbars = mkFn2 \tpl json -> result (MaxBars.renderMax tpl (fromJson json))

-- | Render a *MaxBars* template with a set of named *external* partials (each
-- | MaxBars surface source). `renderMaxbarsWithPartials(partials, template, data)`,
-- | where `partials` is a plain `{ name: source }` object — the MaxBars twin of
-- | `renderSurfaceWithPartials`. `{{> name}}` renders the registered partial.
renderMaxbarsWithPartials :: Fn3 (FO.Object String) String Json Result
renderMaxbarsWithPartials = mkFn3 \partials tpl json ->
  result (MaxBars.renderMaxWithPartials (FO.toUnfoldable partials) tpl (fromJson json))

-- | Render a MinBars (Mustache) template against JS data. `renderMinbars(template, data)`.
-- | Uses the language-agnostic Mustache rule (`0`/`""` truthy).
renderMinbars :: Fn2 String Json Result
renderMinbars = mkFn2 \tpl json -> result (MinBars.renderMinDiag tpl (fromJson json))

-- | Render a MinBars template under the **`mustache.js`-compatible** truthiness
-- | (`0`/`""` falsy, like Handlebars) — for hosts porting a `mustache.js` codebase
-- | (ADR-022). `renderMinbarsCompat(template, data)`.
renderMinbarsCompat :: Fn2 String Json Result
renderMinbarsCompat = mkFn2 \tpl json -> result (MinBars.renderMinCompat tpl (fromJson json))

-- | `renderMinbarsCompat` with a set of named partials, against JS data —
-- | `renderMinbarsCompatWithPartials(partials, template, data)`. The
-- | `mustache.js`-compat twin of `renderMustache`, for a Lab toggling MinBars to
-- | the JS truthiness rule with partials loaded.
renderMinbarsCompatWithPartials :: Fn3 (FO.Object String) String Json Result
renderMinbarsCompatWithPartials = mkFn3 \partials tpl json ->
  result (MinBars.renderMinCompatWith (FO.toUnfoldable partials) tpl (fromJson json))

-- | Render a surface template with a set of named partials (each a surface
-- | source). `renderSurfaceWithPartials(partials, template, data)`, where
-- | `partials` is a plain `{ name: source }` object — the lab's multi-document
-- | partials. `{{> name}}` renders the registered partial.
renderSurfaceWithPartials :: Fn3 (FO.Object String) String Json Result
renderSurfaceWithPartials = mkFn3 \partials tpl json ->
  result (FullBars.renderSurfaceWith (FO.toUnfoldable partials) tpl (fromJson json))

-- | Render a surface template with a host i18n translator seeded (ADR-029): the
-- | first-class seam that drives `t`/`number`/`date`/… The Lab and any JS host wire
-- | localization through this, not `registerHelper`. `renderSurfaceI18n(translator,
-- | template, data)`, where `translator` is a `(name, args) => string | null`.
renderSurfaceI18n :: Fn3 JsTranslator String Json Result
renderSurfaceI18n = mkFn3 \jt tpl json ->
  result (FullBars.renderSurfaceI18n (toTranslator jt) tpl (fromJson json))

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

-- | A host i18n translator (ADR-029): a JS `(name, args) => string | null`.
foreign import data JsTranslator :: Type

-- | Invoke a host translator over an op name + its JSON-marshalled args; a `hit`
-- | string is the localized text, `hit: false` means "no translation" (fall back).
foreign import callJsTranslatorImpl
  :: JsTranslator -> String -> Array Json -> { hit :: Boolean, value :: String }

-- | Marshal a host `JsTranslator` into the engine's `Translator` seam: op args
-- | Value→JSON, the result back to `Maybe String` (Nothing ⇒ fall back to the key).
toTranslator :: JsTranslator -> Translator
toTranslator jt = \name args ->
  let
    r = callJsTranslatorImpl jt name (map toJson args)
  in
    if r.hit then Just r.value else Nothing

-- | A host path schema (ADR-030): a JS `(path, value) => boolean` answering "could
-- | this path hold this value?".
foreign import data JsPathSchema :: Type

-- | Invoke a host path schema over a path + a JSON-marshalled candidate value.
foreign import callJsPathSchemaImpl :: JsPathSchema -> String -> Json -> Boolean

-- | Marshal a host `JsPathSchema` into the engine's `PathSchema` seam (the value is
-- | Value→JSON). A throwing host predicate defaults to admitting the what-if (handled
-- | in the FFI), so a buggy schema never hides a real divergence.
toPathSchema :: JsPathSchema -> Analyse.PathSchema
toPathSchema schema = \p v -> callJsPathSchemaImpl schema p (toJson v)

-- | Invoke a host helper (by `name`, for diagnostics) over JSON-marshalled args,
-- | tagging the outcome: `"ok"` (payload is the value), `"safe"` (payload is raw
-- | markup, ⇒ `VSafe`), `"arity"` (a declared-arity mismatch, ⇒ `ArityError`,
-- | matching the prelude), or `"error"` (the thrown message, ⇒ `HelperError`).
-- | Never throws into PureScript.
foreign import callJsHelperImpl
  :: String -> JsHelperFn -> Array Json -> { tag :: String, payload :: Json }

-- | Invoke a host helper used as a *block* (ADR-020): Handlebars-style, with a
-- | trailing `options` object exposing `hash`, `fn`, and `inverse`. `currentCtx`
-- | is the context for a no-arg `options.fn()`; the hash is passed as a `Json`
-- | (`jsonNull` ⇒ `{}`). `renderBody`/`renderInverse` are pure thunks
-- | `(ctx, opts) -> { ok, value, error }` (run `ctl.render`), which the FFI unwraps
-- | and throws in JS on `!ok`; `opts` is `options.fn`'s second argument
-- | (`{ data, blockParams }`), from which the PureScript side layers scoped `@vars`
-- | and binds the declared block-param names. Tags: `"safe"` (raw block output ⇒
-- | `VSafe`), `"arity"`, `"error"`.
foreign import callJsBlockHelperImpl
  :: String
  -> JsHelperFn
  -> Array Json -- positional args, already trimmed of the hash + block-param values
  -> Json -- currentCtx (for a no-arg options.fn())
  -> Json -- the surface hash object for options.hash (jsonNull ⇒ {})
  -> (Json -> Json -> { ok :: Boolean, value :: String, error :: String }) -- renderBody (ctx, opts)
  -> (Json -> Json -> { ok :: Boolean, value :: String, error :: String }) -- renderInverse (ctx, opts)
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
-- | Marshal one host JS function into an engine `Operation`, shared by every
-- | registrar facade (`renderWith` for FullBars; `renderRawWith`/`renderMaxWith`
-- | for RawBars/MaxBars, ADR-019 addendum). Usage decides inline vs block: a
-- | non-empty `ctl.children` means `pass:[{{#name}}…{{/name}}]`. Inline (ADR-018):
-- | args marshal Value→JSON, the result JSON→Value (escaped `VString`, or
-- | `safe`→`VSafe`). Block (ADR-020): the fn is called Handlebars-style with an
-- | `options` whose `hash`/`fn`/`inverse` come from the `Ctl` channel; `options.fn`'s
-- | `{ data, blockParams }` layers scoped `@vars` and binds the declared names; the
-- | result is raw (`VSafe`).
jsOperation :: String -> JsHelperFn -> Operation (Either Error) (RefEnv (Either Error))
jsOperation name fn = \ctl args ->
  if Array.null ctl.children then case callJsHelperImpl name fn (map toJson args) of
    r
      | r.tag == "safe" -> pure (VSafe (caseJsonString "" identity r.payload))
      | r.tag == "arity" -> throwError (ArityError (caseJsonString "" identity r.payload))
      | r.tag == "error" -> throwError (HelperError (caseJsonString "" identity r.payload))
      | otherwise -> pure (fromJson r.payload)
  else
    let
      clause = ctl.clause "else"
      -- The engine split the head's hash + block-param values into the trailing
      -- positional slots (hash, then the `as |…|` values); drop them so the JS fn
      -- sees Handlebars-style positional args.
      nDrop = Array.length ctl.blockParams + (if isJust ctl.hash then 1 else 0)
      forwardArgs = Array.take (Array.length args - nDrop) args
      -- The body frame from `options.fn(ctx, { data, blockParams })`: `data` keys
      -- become scoped `@vars`, and the declared `as |…|` names bind to the
      -- `blockParams` values — both layered over the inherited scope by `pushFrame`.
      optsFrame optsJson =
        let
          o = caseJsonObject FO.empty identity optsJson
          dataObj = caseJsonObject FO.empty identity (fromMaybe jsonNull (FO.lookup "data" o))
          bpVals = caseJsonArray [] identity (fromMaybe jsonNull (FO.lookup "blockParams" o))
          dataMap = Map.fromFoldable
            ( map (\(Tuple k v) -> Tuple k (constOperation (fromJson v)))
                (FO.toUnfoldable dataObj :: Array (Tuple String Json))
            )
          bpMap = Map.fromFoldable
            (Array.zipWith (\n v -> Tuple n (constOperation (fromJson v))) ctl.blockParams bpVals)
        in
          Map.union bpMap dataMap
      renderClause nodes ctxJson optsJson =
        case ctl.render (pushFrame (optsFrame optsJson) (fromJson ctxJson) ctl.env) nodes of
          Right s -> { ok: true, value: s, error: "" }
          Left e -> { ok: false, value: "", error: show e }
      r = callJsBlockHelperImpl name fn (map toJson forwardArgs) (toJson (refContext ctl.env))
        (maybe jsonNull toJson ctl.hash)
        (renderClause clause.before)
        (renderClause (fromMaybe [] clause.body))
    in
      case r.tag of
        "arity" -> throwError (ArityError (caseJsonString "" identity r.payload))
        "error" -> throwError (HelperError (caseJsonString "" identity r.payload))
        _ -> pure (VSafe (caseJsonString "" identity r.payload))

-- | Marshal a whole host operations/helpers bag into the engine's operation list.
marshalOps
  :: FO.Object JsHelperFn -> Array (Tuple String (Operation (Either Error) (RefEnv (Either Error))))
marshalOps = map (\(Tuple n fn) -> Tuple n (jsOperation n fn)) <<< FO.toUnfoldable

renderWith :: Fn4 (FO.Object JsHelperFn) (FO.Object String) String Json Result
renderWith = mkFn4 \helpers partials tpl json ->
  result
    ( FullBars.renderSurfaceWithHelpers (marshalOps helpers) (FO.toUnfoldable partials) tpl
        (fromJson json)
    )

-- | Render *RawBars* (core) source with host-registered *operations* (ADR-019
-- | addendum). `renderRawWith(operations, partials, template, data)`. Strict
-- | resolve; a block operation gets `options.fn`/`inverse` (+ `{ data }`) but no
-- | hash / block params (RawBars has no surface to write them). The boundary word
-- | is *operation* — FullBars' `renderWith` is the helper-named twin.
renderRawWith :: Fn4 (FO.Object JsHelperFn) (FO.Object String) String Json Result
renderRawWith = mkFn4 \operations partials tpl json ->
  result
    ( RawBars.renderWithOperations (marshalOps operations) (FO.toUnfoldable partials) tpl
        (fromJson json)
    )

-- | Render *MaxBars* source with host-registered *operations* (ADR-019 addendum).
-- | `renderMaxWith(operations, partials, template, data)`. The full block surface
-- | (hash + block params), over MaxBars' infix/pipe surface.
renderMaxWith :: Fn4 (FO.Object JsHelperFn) (FO.Object String) String Json Result
renderMaxWith = mkFn4 \operations partials tpl json ->
  result
    ( MaxBars.renderWithOperations (marshalOps operations) (FO.toUnfoldable partials) tpl
        (fromJson json)
    )

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

-- | Compile a *MaxBars* template to JS with a set of named external partials
-- | (each MaxBars surface source). `compileMaxbarsWithPartials(partials, template)`
-- | — the compiled twin of `renderMaxbarsWithPartials`.
compileMaxbarsWithPartials :: Fn2 (FO.Object String) String Result
compileMaxbarsWithPartials = mkFn2 \partials tpl ->
  compileResultAt tpl (MaxBars.compileMaxJsWith (FO.toUnfoldable partials) tpl)

-- | Compile a MinBars (Mustache) template to JS (ADR-016). `compileMinbars(template)`.
-- | Seeds the language-agnostic Mustache rule (`0`/`""` truthy).
compileMinbars :: Fn1 String Result
compileMinbars = mkFn1 \tpl -> compileResultAt tpl (MinBars.compileMinJs tpl)

-- | Compile a MinBars template to JS under the **`mustache.js`-compatible**
-- | truthiness (`0`/`""` falsy) — the compiled twin of `renderMinbarsCompat`.
-- | `compileMinbarsCompat(template)`.
compileMinbarsCompat :: Fn1 String Result
compileMinbarsCompat = mkFn1 \tpl -> compileResultAt tpl (MinBars.compileMinJsCompat tpl)

-- | Compile a MinBars template to JS with a set of named partials (each a
-- | Mustache source); `{{> name}}` is inlined. `compileMinbarsWithPartials(partials, template)`,
-- | where `partials` is a plain `{ name: source }` object.
compileMinbarsWithPartials :: Fn2 (FO.Object String) String Result
compileMinbarsWithPartials = mkFn2 \partials tpl ->
  compileResultAt tpl (MinBars.compileMinJsWith (FO.toUnfoldable partials) tpl)

-- | `compileMinbarsWithPartials` under the `mustache.js`-compat truthiness — the
-- | compiled twin of `renderMinbarsCompatWithPartials`.
-- | `compileMinbarsCompatWithPartials(partials, template)`.
compileMinbarsCompatWithPartials :: Fn2 (FO.Object String) String Result
compileMinbarsCompatWithPartials = mkFn2 \partials tpl ->
  compileResultAt tpl (MinBars.compileMinJsCompatWith (FO.toUnfoldable partials) tpl)

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

-- | Tokenize template source into the full ADR-017 token vocabulary for the given
-- | dialect: `tokenize(template, dialect)` returns a plain JS array of
-- | `{ from, to, kind, role }` (UTF-16 offsets + a kind tag + `"tag"`/`"interior"`).
-- | This is the superset `highlightSpans` projects (the tag-role spans plus the
-- | interior `string`/`number`/`operator` literals); the `flatbars-lsp`
-- | semantic-tokens server consumes it. See `FlatBars.Highlight`.
tokenize :: Fn2 String String (Array Highlight.TSpan)
tokenize = mkFn2 \tpl dialect -> Highlight.tokenizeSpans (highlightConfig dialect) tpl

-- | Located parse diagnostics for `src` under `dialect` (ADR-023):
-- | `diagnostics(template, dialect)` runs the RECOVERING parser with that
-- | dialect's options and returns every error as a plain JS object
-- | `{ line, column, offset, message }` (1-based line/column). It derives from the
-- | SAME parser the render path uses — fail-fast there, recovering here — so the
-- | editor flags exactly what the dialect would reject (e.g. `{{#if a == 1}}` in
-- | every surface but MaxBars). `flatbars-lsp` publishes these as squiggles.
diagnostics :: Fn2 String String (Array ParseDiagnostic)
diagnostics = mkFn2 \src dialect ->
  let
    opts = case dialect of
      "maxbars" -> maxOptions
      "minbars" -> MinBars.minOptions
      "rawbars" -> RawBars.coreOptions
      _ -> defaultParseOptions -- fullbars (parsed with the default options)
  in
    map (parseErrorAt src) (parseRecovering opts src).errors

-- | Map a dialect name to its highlight seams, mirroring each dialect's own parse
-- | settings (the single source of truth — drift is caught by `check:highlight`):
-- | RawBars/MaxBars/MinBars enable the `{{=A B=}}` set-delimiter tag
-- | (`mustacheDelims`), FullBars does not; the kernel dialects treat
-- | `else`/`elif` as clause separators, MinBars (Mustache) treats none; only
-- | MaxBars enables the infix-arithmetic interior lexer (`lexOptions.operatorChars`),
-- | so `+`/`-`/`*`/`/` carve as `operator` spans there and stay path punctuation
-- | elsewhere (`tokenize`'s interior axis, ADR-017). `extras`
-- | / `inheritance` mirror each dialect's parse gates, so a shape the dialect
-- | rejects is coloured `error` rather than painted valid: RawBars/MaxBars set
-- | `extras = false`; only MinBars enables `inheritance` (the Mustache
-- | `{{<}}`/`{{$}}` shapes).
highlightConfig :: String -> Highlight.HighlightConfig
highlightConfig = case _ of
  "maxbars" ->
    { lexConfig: maxOptions.lexConfig { keepLongComments = true }
    , clauseSeps: maxOptions.standaloneSeps
    , lexOptions: maxOptions.lexOptions
    , extras: false
    , inheritance: false
    , rawBlockHbs: false
    , rawBlockHash: true
    }
  "rawbars" ->
    -- RawBars does not enable set-delim (per ADR-015 amendment); use the
    -- default lex config so highlighting agrees with parsing and the
    -- editor flags `{{=A B=}}` in `.rawbars` files instead of accepting it.
    { lexConfig: defaultLexConfig { keepLongComments = true }
    , clauseSeps: kernelClauses
    , lexOptions: defaultLexOptions
    , extras: false
    , inheritance: false
    , rawBlockHbs: false
    , rawBlockHash: true
    }
  "minbars" ->
    { lexConfig: withSetDelims
    , clauseSeps: []
    , lexOptions: defaultLexOptions
    , extras: true
    , inheritance: true
    -- Mustache has no raw blocks: neither spelling.
    , rawBlockHbs: false
    , rawBlockHash: false
    }
  _ ->
    { lexConfig: defaultLexConfig { keepLongComments = true }
    , clauseSeps: kernelClauses
    , lexOptions: defaultLexOptions
    , extras: true
    , inheritance: false
    -- FullBars is Handlebars-faithful: the bare `{{{{name}}}}` only.
    , rawBlockHbs: true
    , rawBlockHash: false
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
  let
    -- The AST view runs the *recovering* parser (ADR-023), like the highlighter and
    -- `diagnostics`: it never blanks on a syntax error. A recovered `NodeError`
    -- lowers to nothing (`Kernel.Lower.nodeError`), so the tree is the best-effort
    -- valid structure; the located errors travel alongside in `errors`, the same
    -- set `diagnostics` reports (both project `parseRecovering` — gated by
    -- check:parse-views).
    -- each dialect parses with its own gates — the same mapping `diagnostics` uses
    -- (Lab vocabulary: "core" = RawBars, "surface" = FullBars), so the AST view and
    -- the Problems panel agree (gated by check:parse-views).
    opts = case dialect of
      "maxbars" -> maxOptions
      "core" -> RawBars.coreOptions
      _ -> defaultParseOptions
    r = parseRecovering opts src
    -- `core` is the austere syntax (no desugar); `surface` and `maxbars` desugar
    -- (MaxBars adds bare loop variables via `maxLoopVars`). Desugar passes a
    -- `NodeError` through; `lower` drops it.
    desugared = case dialect of
      "core" -> r.nodes
      "maxbars" -> desugarSurfaceWith maxLoopVars r.nodes
      _ -> desugarSurface r.nodes
    nodes = lower desugared
    errJson pe =
      let
        d = parseErrorAt src pe
      in
        obj
          [ Tuple "message" (str d.message)
          , Tuple "line" (int d.line)
          , Tuple "column" (int d.column)
          , Tuple "offset" (int d.offset)
          ]
  in
    obj
      [ Tuple "ast"
          ( obj
              [ Tuple "version" (str "flatbars-ast/v1")
              , Tuple "nodes" (arr (map rnode nodes))
              ]
          )
      , Tuple "errors" (arr (map errJson r.errors))
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
