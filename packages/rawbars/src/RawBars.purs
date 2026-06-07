-- | **RawBars** — the austere base of the dialect ladder (RawBars ⊂ FullBars ⊂
-- | MaxBars). It renders/compiles the *core* skeleton syntax directly — explicit
-- | `pass:[{{{ lookup this "x" }}}]`, no surface sugar — against the shared
-- | *reference engine*. (FullBars adds the surface desugar; MaxBars adds operators
-- | and pipes. The engine, value policy, prelude, and compiler are all shared.)
-- |
-- | This is a thin dialect layer: it reuses the reference engine's `runResolved`
-- | (`Kernel.Render`: parse → seed the prelude env → engine) and the
-- | shared compiler's `Emit` (`FlatBars.Compile.Emit.coreEmit` — the strict emit,
-- | matching RawBars' strict `runResolved`: no value-helper sectioning), swapping in
-- | *no* surface desugar. Note it depends on `kernel` + `flatbars-compile`, *not*
-- | the `fullbars` package — its dependency closure is FullBars-free (see ADR-008).
-- | It exists so the three dialects are symmetric packages over one engine.
module RawBars
  ( coreOptions
  , render
  , renderDiag
  , renderValue
  , renderWithOperations
  , renderMapped
  , renderMappedWith
  , inspect
  , inspectWith
  , renderAff
  , compile
  , compileWith
  , compileJs
  , compileJsWith
  ) where

import Prelude

import Control.Monad.Except.Trans (runExceptT)
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Map as Map
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import Effect.Aff (Aff)
import FlatBars.Compile (compile) as Driver
import FlatBars.Compile.Emit (coreEmit, metaFor)
import FlatBars.Error (Error(ParseFailure), ParseError, renderParseErrorsAt)
import FlatBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import FlatBars.Value (Value)
import Kernel.Engine (Operation)
import Kernel.Env (RefEnv, registerAll, registerPartialFiles, registerPartials, withTruthy, withYieldName)
import Kernel.Hoist (hoistInline)
import Kernel.Inspect (Snapshot, Target, inspectResolvedStrict)
import Kernel.Provenance (Segment, runResolvedMapped)
import Kernel.Render (formatError, runResolved)
import Kernel.ToValue (class ToValue, toValue)
import Kernel.Value (nonEmpty)

--------------------------------------------------------------------------------
-- Rendering (core syntax + the FullBars engine)
--------------------------------------------------------------------------------

-- | RawBars is the austere dialect: it rejects the Handlebars-only tag shapes
-- | (`{{{{…}}}}` raw blocks, `{{^…}}` inverse, `{{&…}}` unescaped) — `extras`
-- | off. Front-end knobs like standalone trimming still pass through.
-- |
-- | Set delimiters are NOT enabled (per ADR-015 amendment): `{{=<% %>=}}` is a
-- | Mustache feature and only MinBars accepts it. RawBars, MaxBars, and FullBars
-- | all reject set-delim directives — the dialect ladder treats set-delim as
-- | MinBars-exclusive so the four surfaces have a single, consistent answer to
-- | "does delimiter switching work here?" instead of three yeses and one no.
coreOptions :: ParseOptions
coreOptions = defaultParseOptions
  { extras = false
  , decorators = false
  , partialBlocks = false
  -- RawBars uses the FlatBars `{{{{#name}}}}` raw-block spelling, not the
  -- Handlebars bare `{{{{name}}}}` form.
  , rawBlockHbs = false
  , rawBlockHash = true
  }

-- | Parse core source and return a pure renderer (the engine's fixed `handlebars`
-- | truthiness rule applies; ADR-022).
compile :: String -> Either ParseError (Value -> Either Error String)
compile = compileWith coreOptions

-- | `compile` with explicit parse options; RawBars always rejects extras.
compileWith :: ParseOptions -> String -> Either ParseError (Value -> Either Error String)
compileWith opts src = do
  { directives, nodes } <- lmap NEA.head $ parseWith
    (opts { extras = false, decorators = false, partialBlocks = false })
    src
  let h = hoistInline nodes
  pure \dat -> runResolved directives
    (withTruthy nonEmpty <<< withYieldName "yield" <<< registerPartials h.partials)
    h.template
    dat

-- | One-shot render of core source against data.
render :: String -> Value -> Either String String
render src dat = case parseWith coreOptions src of
  Left pes -> Left (show (ParseFailure pes))
  Right { directives, nodes } ->
    let
      h = hoistInline nodes
    in
      lmap show
        ( runResolved directives
            (withTruthy nonEmpty <<< withYieldName "yield" <<< registerPartials h.partials)
            h.template
            dat
        )

-- | `render` with located parse-error messages (`line:column:`).
renderDiag :: String -> Value -> Either String String
renderDiag src dat = case parseWith coreOptions src of
  Left pes -> Left (renderParseErrorsAt src pes)
  Right { directives, nodes } ->
    let
      h = hoistInline nodes
    in
      lmap (formatError src)
        ( runResolved directives
            (withTruthy nonEmpty <<< withYieldName "yield" <<< registerPartials h.partials)
            h.template
            dat
        )

-- | Render core source against native PureScript data (lowered via `ToValue`).
renderValue :: forall a. ToValue a => String -> a -> Either String String
renderValue src = renderDiag src <<< toValue

-- | Render core source with host-registered *operations* and (core-source)
-- | partials (ADR-019 addendum). RawBars stays *strict* — an unknown head is
-- | `UnknownHelper`, never `blockHelperMissing` — and has no surface sugar, so a
-- | block operation gets `options.fn`/`inverse` (and `options.fn(ctx, { data })`)
-- | but no `options.hash` / block params (there is no `k=v` or `as |…|` to write).
-- | "operation" is the native boundary word; FullBars' twin is `renderWith` (helper).
renderWithOperations
  :: Array (Tuple String (Operation (Either Error) (RefEnv (Either Error))))
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String String
renderWithOperations operations partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parseWith coreOptions src of
      Left pes -> Left (renderParseErrorsAt src pes)
      Right { directives, nodes } ->
        let
          h = hoistInline nodes
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          -- Inline definitions in the template win over same-named external
          -- partials (left-biased union), matching FullBars.
          setup =
            withTruthy nonEmpty
              <<< withYieldName "yield"
              <<< registerAll operations
              <<< registerPartials (Map.union h.partials externalT)
        in
          lmap (formatError src) (runResolved directives setup h.template dat)
  where
  compilePartial (Tuple name s) = case parseWith coreOptions s of
    Left es -> Left (renderParseErrorsAt s es)
    Right { nodes } -> Right { name, template: nodes }

-- | Render core source and return a source map alongside the output (ADR-035) —
-- | the core twin of `renderSurfaceMapped`. RawBars stays strict and uses the
-- | `nonEmpty` truthiness rule.
renderMapped :: String -> Value -> Either String { output :: String, segments :: Array Segment }
renderMapped = renderMappedWith []

-- | `renderMapped` with named external partials (each core source).
renderMappedWith
  :: Array (Tuple String String)
  -> String
  -> Value
  -> Either String { output :: String, segments :: Array Segment }
renderMappedWith partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parseWith coreOptions src of
      Left pes -> Left (renderParseErrorsAt src pes)
      Right { nodes } ->
        let
          h = hoistInline nodes
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          -- inline partials index "main"; externals index their own source (ADR-035).
          partialFiles = Map.union (map (const "main") h.partials)
            (Map.fromFoldable (map (\p -> Tuple p.name p.name) ps))
          setup =
            registerPartialFiles partialFiles
              <<< withTruthy nonEmpty
              <<< withYieldName "yield"
              <<< registerPartials (Map.union h.partials externalT)
        in
          lmap (formatError src) (runResolvedMapped setup h.template dat)
  where
  compilePartial (Tuple name s) = case parseWith coreOptions s of
    Left es -> Left (renderParseErrorsAt s es)
    Right { nodes } -> Right { name, template: nodes }

-- | Context Inspector for core (ADR-035) — the core twin of `inspectSurfaceWith`,
-- | snapshotting the render context at a source span. RawBars stays strict.
inspect :: Target -> String -> Value -> Either String (Array Snapshot)
inspect target = inspectWith target []

-- | `inspect` with named external partials (each core source).
inspectWith
  :: Target
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String (Array Snapshot)
inspectWith target partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parseWith coreOptions src of
      Left pes -> Left (renderParseErrorsAt src pes)
      Right { nodes } ->
        let
          h = hoistInline nodes
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          partialFiles = Map.union (map (const "main") h.partials)
            (Map.fromFoldable (map (\p -> Tuple p.name p.name) ps))
          setup =
            registerPartialFiles partialFiles
              <<< withTruthy nonEmpty
              <<< withYieldName "yield"
              <<< registerPartials (Map.union h.partials externalT)
        in
          lmap (formatError src) (inspectResolvedStrict setup target h.template dat)
  where
  compilePartial (Tuple name s) = case parseWith coreOptions s of
    Left es -> Left (renderParseErrorsAt s es)
    Right { nodes } -> Right { name, template: nodes }

-- | The async instantiation: the same engine in `ExceptT Error Aff`.
renderAff :: String -> Value -> Aff (Either Error String)
renderAff src dat = case parseWith coreOptions src of
  Left pe -> pure (Left (ParseFailure pe))
  Right { directives, nodes } ->
    let
      h = hoistInline nodes
    in
      runExceptT
        ( runResolved directives
            (withTruthy nonEmpty <<< withYieldName "yield" <<< registerPartials h.partials)
            h.template
            dat
        )

--------------------------------------------------------------------------------
-- Compilation (core syntax → JS, via the shared driver + FullBars Emit)
--------------------------------------------------------------------------------

-- | Compile core source to a JS ES module. `{{#inline "name"}}` definitions are
-- | hoisted into the partial registry (the shared `Kernel.Hoist.hoistInline`),
-- | exactly as `render` does and as FullBars/MaxBars compile — so RawBars differs
-- | only in surface syntax, not capability (ADR-005/008).
compileJs :: String -> Either ParseError String
compileJs = compileJsWith coreOptions

-- | `compileJs` with explicit parse options; RawBars always rejects extras.
compileJsWith :: ParseOptions -> String -> Either ParseError String
compileJsWith opts src = do
  { nodes } <- lmap NEA.head $ parseWith
    (opts { extras = false, decorators = false, partialBlocks = false })
    src
  let h = hoistInline nodes
  pure
    ( Driver.compile (metaFor "rt.truthyNonEmpty" "yield") coreEmit (Map.toUnfoldable h.partials)
        h.template
    )
