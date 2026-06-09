-- | **MaxBars → Trussbars AOT compatibility lint.** MaxBars is the language;
-- | *Trussbars* is its production Rust implementation, whose default backend (AOT)
-- | compiles a MaxBars template to typed Rust. AOT accepts a *subset* of the full
-- | dynamic language ("names are static, data is dynamic, the two never cross"):
-- | some constructs are rejected by the compiler front-end, and two more are
-- | *type* errors the front-end emits but `rustc` (or the VM's `--vm-compat`
-- | verifying proxy) rejects. This module reports both, so an author in the Lab
-- | knows whether their MaxBars will build under Trussbars before they leave the
-- | playground.
-- |
-- | Two tiers, by how they are decided:
-- |
-- |  * **Structural** (data-free, *drift-proof*): we run the real AOT front-end
-- |    (`MaxBars.Rust.compileMaxRustCommentedWith`, threaded with the same external
-- |    partials the render uses) and surface its located rejection verbatim —
-- |    computed (data-derived) field names, *computed* partials, host
-- |    helpers (`t`/`number`/…), non-`raw` raw blocks, unknown helpers. (Dict
-- |    literals are *accepted* — the emitter synthesizes a struct for them.) The
-- |    lint *is* the compiler's own rejection set, so it can never
-- |    drift from what AOT actually accepts. (One finding — the compiler
-- |    short-circuits on the first reject, exactly as a compiler would.)
-- |
-- |  * **Data-driven** (needs the sample data; the verifying-proxy rules): two
-- |    checks the front-end emits but `rustc`/`--vm-compat` reject, because without
-- |    a host schema they can only be decided from a value — *numeric truthiness*
-- |    (`{{#if count}}`: AOT has no `Truthy for f64`, write `count > 0`) and
-- |    *bare-struct output* (`{{user}}`: a struct has no `ToText`). We observe these
-- |    by rendering against the data under instrumented `if`/`unless`/`and`/`or`/
-- |    `not` and `escapeHtml` operations that `tell` a finding for a `VNumber`
-- |    condition / a `VObject` output, then delegate to the real operation (output
-- |    is byte-identical). List-all: every offending tag the data reaches.
-- |
-- | The verdict (`compatible`) is `compileMaxRust` accepts AND no data finding — the
-- | precise AOT-compat condition the Rust VM's `--vm-compat` proxy checks. A drift
-- | gate (`trussbars/conformance`) holds this PureScript verdict and the Rust one in
-- | lock-step on the corpus.
module MaxBars.Compat
  ( CompatFinding
  , CompatReport
  , compatReport
  , compatReportWith
  ) where

import Prelude

import Control.Monad.Error.Class (throwError)
import Control.Monad.Writer.Class (tell)
import Control.Monad.Writer.Trans (WriterT, runWriterT)
import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Foldable (for_)
import Data.Int as Int
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String (Pattern(..))
import Data.String as Str
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error(..), ParseError)
import FlatBars.Parser (parseWith)
import FlatBars.Span (Span, lineColumn)
import FlatBars.Syntax (Template)
import FlatBars.Value (Value(..))
import FullBars (desugarSurfaceWith, hoistInline)
import Kernel.Engine (Operation, runTemplate)
import Kernel.Env (RefEnv, refEngineWith, registerAll, registerPartials, withTruthy, withYieldName)
import Kernel.Prelude (lenientResolve, prelude)
import Kernel.Render (preludeEnv)
import Kernel.Value (nonEmpty)
import MaxBars (maxLoopVars, maxOptions)
import MaxBars.Rust (compileMaxRustCommentedWith)

-- | One incompatibility, located in the MaxBars source and ready for a host UI
-- | (the Lab's Trussbars panel). `severity` is always `"Err"` (an incompatibility
-- | is a build failure under AOT); `rule` is a stable kind a UI can group on
-- | (`"aot-structural"`, `"numeric-truthiness"`, `"struct-output"`).
type CompatFinding =
  { severity :: String
  , rule :: String
  , message :: String
  , line :: Int
  , column :: Int
  }

-- | The verdict plus every finding. `compatible` is true exactly when the template
-- | would build under Trussbars AOT: the front-end accepts it *and* the sample data
-- | drove no numeric-truthiness / struct-output type error.
type CompatReport =
  { compatible :: Boolean
  , findings :: Array CompatFinding
  }

-- | Lint MaxBars `src` against the sample `dat` for Trussbars AOT compatibility,
-- | with no external partials.
compatReport :: String -> Value -> Either ParseError CompatReport
compatReport = compatReportWith []

-- | `compatReport` with named *external* partials (each MaxBars surface source) — the
-- | host/Lab-registered partials a `{{> name}}` resolves to. They are threaded into
-- | *both* tiers, exactly as the render path threads them: the structural front-end
-- | inlines them (so a `{{> styles}}` resolving to a provided partial is not
-- | mis-reported as an "unknown partial"), and the data-driven trace registers them
-- | so a partial-using template still renders for the numeric/struct observations.
-- | A parse error short-circuits to `Left`.
compatReportWith
  :: Array (Tuple String String) -> String -> Value -> Either ParseError CompatReport
compatReportWith externalSrcs src dat = do
  { nodes } <- lmap NEA.head (parseWith maxOptions src)
  externals <- traverse parsePartial externalSrcs
  let
    { partials: inlineP, template } = hoistInline (desugarSurfaceWith maxLoopVars nodes)
    allPartials = Map.union inlineP (Map.fromFoldable externals)
    structural = structuralFinding externalSrcs src
    dataDriven = dataFindings src allPartials template dat
    findings = structural <> dataDriven
  pure { compatible: Array.null findings, findings }

-- | Parse + desugar a named external partial into the registry form (its desugared
-- | body), so it can be `Map.union`'d alongside the template's inline partials.
parsePartial :: Tuple String String -> Either ParseError (Tuple String Template)
parsePartial (Tuple name s) = do
  { nodes } <- lmap NEA.head (parseWith maxOptions s)
  pure (Tuple name (desugarSurfaceWith maxLoopVars nodes))

--------------------------------------------------------------------------------
-- Structural tier — delegate to the real AOT front-end (drift-proof)
--------------------------------------------------------------------------------

-- | The AOT front-end's own rejection, located, as zero or one finding. We compile
-- | with the *commented* emitter and a `"main"` file label so every "unsupported …"
-- | reason is prefixed `main:<line>:<col>: ` — the breadcrumb we parse back into a
-- | location. The context type is a placeholder: only the accept/reject verdict and
-- | the reason matter here, never the emitted Rust.
structuralFinding :: Array (Tuple String String) -> String -> Array CompatFinding
structuralFinding externalSrcs src =
  let
    r = compileMaxRustCommentedWith externalSrcs "main" "TrussbarsCtx" src
  in
    if r.ok then []
    else
      let
        loc = parseLocated r.err
      in
        [ { severity: "Err"
          , rule: "aot-structural"
          , message: "Trussbars AOT can't compile this: " <> stripUnsupported loc.message
          , line: loc.line
          , column: loc.column
          }
        ]

-- | Parse a `main:<line>:<col>: <reason>` breadcrumb (the commented emitter's
-- | located-error form) into a location + bare reason. Falls back to `1:1` with the
-- | whole string when the prefix is absent (e.g. an un-located build error).
parseLocated :: String -> { line :: Int, column :: Int, message :: String }
parseLocated err = case Str.stripPrefix (Pattern "main:") err of
  Just rest -> case Str.indexOf (Pattern ": ") rest of
    Just i ->
      let
        parts = Str.split (Pattern ":") (Str.take i rest)
      in
        { line: intAt parts 0, column: intAt parts 1, message: Str.drop (i + 2) rest }
    Nothing -> fallback
  Nothing -> fallback
  where
  fallback = { line: 1, column: 1, message: err }
  intAt parts k = fromMaybe 1 (Int.fromString =<< Array.index parts k)

-- | Drop the emitter's internal `unsupported: ` lead-in (the message already gets a
-- | friendlier "Trussbars AOT can't compile this: " prefix).
stripUnsupported :: String -> String
stripUnsupported m = fromMaybe m (Str.stripPrefix (Pattern "unsupported: ") m)

--------------------------------------------------------------------------------
-- Data-driven tier — render under instrumentation, observe the value rules
--------------------------------------------------------------------------------

-- | The instrumentation monad: a finding-accumulating writer over the engine's pure
-- | `Either Error`. No effects — like `Kernel.Analyse`, the trace is the writer's
-- | output, so a data-driven lint is as pure as a normal render.
type TraceM = WriterT (Array CompatFinding) (Either Error)

-- | Render `template` against `dat` with MaxBars' real engine (lenient resolve,
-- | `nonEmpty` truthiness), instrumented for the two value-typed AOT rules. The
-- | render takes two shapes:
-- |
-- |  * It **succeeds** — every truthiness condition the data reached `tell`s a
-- |    finding for a `VNumber` (numeric truthiness), and we return them all
-- |    (list-all).
-- |  * A `VObject` reaches output — the engine cannot stringify it (it is a struct
-- |    output, the AOT no-`ToText` rule), so `escapeWrap` throws a *located*,
-- |    encoded error first. The render aborts; we decode that one finding. (A
-- |    `WriterT`-over-`Either` discards its log on `Left`, so a located throw is the
-- |    only way struct output can carry a location.)
-- |
-- | Any other render error (the template genuinely fails on this data) yields no
-- | data finding — the structural verdict and the Lab's normal error panel cover it.
dataFindings :: String -> Map.Map String Template -> Template -> Value -> Array CompatFinding
dataFindings src partials template dat =
  case runWriterT (runTemplate (refEngineWith lenientResolve env) template) of
    Right (Tuple _ found) -> found
    Left err -> decodeCompat err
  where
  env :: RefEnv TraceM
  env =
    registerAll (compatWrappers src)
      ( withTruthy nonEmpty
          $ withYieldName "yield"
          $ registerPartials partials
          $ preludeEnv dat
      )

-- | The wrapped operations. Each looks up the real prelude operation, `tell`s a
-- | finding when its observed value trips an AOT rule, then delegates — so the
-- | render is byte-identical and only the trace is added (the `Kernel.Analyse`
-- | pattern). The conditions catch *numeric truthiness*; `escapeHtml` catches
-- | *bare-struct output*.
compatWrappers :: String -> Array (Tuple String (Operation TraceM (RefEnv TraceM)))
compatWrappers src = Array.mapMaybe wrapCond conds <> Array.mapMaybe wrapEscape [ "escapeHtml" ]
  where
  preludeMap = Map.fromFoldable prelude
  -- `true` ⇒ every argument is a condition (`and`/`or`); `false` ⇒ only the first.
  conds =
    [ Tuple "if" false, Tuple "unless" false, Tuple "not" false, Tuple "and" true, Tuple "or" true ]
  wrapCond (Tuple name variadic) = wrap name (condWrap src variadic)
  wrapEscape name = wrap name (escapeWrap src)
  wrap name mk = (\orig -> Tuple name (mk orig)) <$> Map.lookup name preludeMap

-- | Wrap a truthiness condition: `tell` a numeric-truthiness finding for each tested
-- | argument that resolved to a `VNumber` (AOT has no `Truthy for f64` — every
-- | numeric condition is a compile error, the 0 case included), then run the real op.
condWrap
  :: String
  -> Boolean
  -> Operation TraceM (RefEnv TraceM)
  -> Operation TraceM (RefEnv TraceM)
condWrap src variadic orig ctl args = do
  let tested = if variadic then args else Array.take 1 args
  for_ tested \v -> case v of
    VNumber _ -> tell
      [ findingAt src ctl.span "numeric-truthiness"
          "Trussbars AOT: numeric truthiness is a compile error — test explicitly, e.g. `count > 0`."
      ]
    _ -> pure unit
  orig ctl args

-- | Wrap `escapeHtml` (the desugar target of every `{{ … }}` output): a `VObject`
-- | reaching output is a struct with no `ToText` under AOT, which the engine also
-- | refuses to stringify. Throw a *located, encoded* error so the finding keeps its
-- | source position (the writer's log is lost on the `Left` either way). Otherwise
-- | delegate (byte-identical).
escapeWrap :: String -> Operation TraceM (RefEnv TraceM) -> Operation TraceM (RefEnv TraceM)
escapeWrap src orig ctl args = case Array.head args of
  Just (VObject _) ->
    throwError
      ( encodeCompat
          ( findingAt src ctl.span "struct-output"
              "Trussbars AOT: a struct/object has no text form — output one of its fields instead."
          )
      )
  _ -> orig ctl args

-- | Build a located finding from a span into `src`.
findingAt :: String -> Span -> String -> String -> CompatFinding
findingAt src span rule message =
  let
    lc = lineColumn src span.start
  in
    { severity: "Err", rule, message, line: lc.line, column: lc.column }

-- | Smuggle a located finding through the engine's `Error` channel (the only way to
-- | carry it out of a render that aborts) — a `HelperError` whose message is the
-- | finding's fields joined by an unlikely separator. `decodeCompat` reverses it.
sepCh :: String
sepCh = "\x1f"

encodeCompat :: CompatFinding -> Error
encodeCompat f = HelperError
  (Str.joinWith sepCh [ "COMPAT", f.rule, show f.line, show f.column, f.message ])

-- | Recover a `[finding]` from an aborted render's error, or `[]` if the error is a
-- | genuine template failure rather than our encoded struct-output signal.
decodeCompat :: Error -> Array CompatFinding
decodeCompat = case _ of
  HelperError m -> case Str.split (Pattern sepCh) m of
    [ "COMPAT", rule, line, column, message ] ->
      [ { severity: "Err"
        , rule
        , message
        , line: fromMaybe 1 (Int.fromString line)
        , column: fromMaybe 1 (Int.fromString column)
        }
      ]
    _ -> []
  _ -> []
