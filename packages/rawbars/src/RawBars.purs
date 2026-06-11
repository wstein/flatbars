-- | **RawBars** — the austere base of the dialect ladder (RawBars ⊂ ClassicBars ⊂
-- | MaxBars). It renders/compiles the *core* skeleton syntax directly — explicit
-- | `pass:[{{{ lookup this "x" }}}]`, no surface sugar — against the shared
-- | *reference engine*. (ClassicBars adds the surface desugar; MaxBars adds operators
-- | and pipes. The engine, value policy, prelude, and compiler are all shared.)
-- |
-- | This is a thin dialect layer: it reuses the reference engine's `runResolved`
-- | (`Kernel.Render`: parse → seed the prelude env → engine) and the
-- | shared compiler's `Emit` (`FlatBars.Compile.Emit.coreEmit` — the strict emit,
-- | matching RawBars' strict `runResolved`: no value-helper sectioning), swapping in
-- | *no* surface desugar. Note it depends on `kernel` + `flatbars-compile`, *not*
-- | the `classicbars` package — its dependency closure is ClassicBars-free (see ADR-008).
-- | It exists so the three dialects are symmetric packages over one engine.
module RawBars
  ( render
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
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import Effect.Aff (Aff)
import FlatBars.Compile (compile) as Driver
import FlatBars.Compile.Emit (coreEmit, metaFor)
import FlatBars.Error (Error(ParseFailure), ParseError(DisallowedShape), renderParseErrorsAt)
import FlatBars.Parser (ParseOptions, parseWith)
import FlatBars.Syntax (Directive, Template)
import FlatBars.Value (Value)
import Kernel.CaseSugar (braceControlViolation, caseLeadingViolation)
import Kernel.Engine (Operation)
import Kernel.Env (RefEnv, registerAll, registerPartialFiles, registerPartials, withTruthy, withYieldName)
import Kernel.Hoist (hoistInline)
import Kernel.Inspect (Snapshot, Target, inspectResolvedStrict)
import Kernel.Prelude (blockHelperNames)
import Kernel.Provenance (Segment, runResolvedMapped)
import Kernel.Render (formatError, runResolved)
import Kernel.SetSugar (liftSet, reservedBindingViolation)
import Kernel.ToValue (class ToValue, toValue)
import Kernel.Value (nonEmpty)
import RawBars.Parser as RawParser

--------------------------------------------------------------------------------
-- Rendering (core syntax + the ClassicBars engine)
--------------------------------------------------------------------------------

-- | Parse core source, enforcing the one `{{#case}}` surface rule the parser can't: only
-- | whitespace may precede the first `{{when}}` arm (docs/12). `case` itself is a first-class
-- | engine operation (`Kernel.Prelude.caseH`) — the `{{#case}}` block flows to the engine
-- | unchanged; this only adds the located leading-content error. Every RawBars entry point
-- | parses through here so the rule is enforced consistently.
type Parsed = { directives :: Array Directive, nodes :: Template }

-- | The RawBars surface-strict checks over a parse result: the `{{#case}}`
-- | leading-content rule (docs/12), and — in the statementTags surface — rejecting
-- | legacy `{{ }}` control flow + reserved-name bindings, then lifting
-- | `{% set NAME = … %}` → `{% local %}` over its sibling tail (docs-17). Shared by the
-- | owned RawBars parse (`parseRaw`) and the configurable one (`parseCore`).
checkCore
  :: Boolean
  -> String
  -> Either (NEA.NonEmptyArray ParseError) Parsed
  -> Either (NEA.NonEmptyArray ParseError) Parsed
checkCore stmtTags src = case _ of
  Left pes -> Left pes
  Right r -> case firstViolation r.nodes of
    Just v -> Left (NEA.singleton (DisallowedShape v.shape v.off))
    Nothing -> Right (if stmtTags then r { nodes = liftSet r.nodes } else r)
  where
  firstViolation nodes
    | stmtTags =
        case braceControlViolation [ "else", "elif", "when" ] src nodes of
          Just v -> Just v
          Nothing -> case reservedBindingViolation blockHelperNames nodes of
            Just v -> Just v
            Nothing -> caseLeadingViolation nodes
    | otherwise = caseLeadingViolation nodes

-- | Parse RawBars-dialect source through the *owned* `RawBars.Parser` (ADR-041),
-- | applying the surface-strict checks (statement tags always on). Every RawBars
-- | render/compile entry parses through here.
parseRaw :: String -> Either (NEA.NonEmptyArray ParseError) Parsed
parseRaw src = checkCore true src (RawParser.parse src)

-- | Parse with explicit `ParseOptions` through the *shared* parser — the configurable
-- | path the CLI uses for core syntax with custom `--delimiters` (RawBars-the-dialect
-- | has no set delimiters, but the CLI may set the initial pair). The shared parser is
-- | never a `{% %}` statement-tag surface (ADR-041), so the strict checks run in their
-- | non-statementTags form.
parseCore :: ParseOptions -> String -> Either (NEA.NonEmptyArray ParseError) Parsed
parseCore opts src = checkCore false src (parseWith opts src)

-- | Build a pure renderer from a parsed template (the engine's fixed `nonEmpty`
-- | truthiness rule applies; ADR-022).
mkRenderer :: Parsed -> Value -> Either Error String
mkRenderer { directives, nodes } =
  let
    h = hoistInline nodes
  in
    \dat -> runResolved directives
      (withTruthy nonEmpty <<< withYieldName "yield" <<< registerPartials h.partials)
      h.template
      dat

-- | Parse RawBars source and return a pure renderer.
compile :: String -> Either ParseError (Value -> Either Error String)
compile src = mkRenderer <$> lmap NEA.head (parseRaw src)

-- | `compile` with explicit parse options (the CLI's configurable core path); RawBars
-- | always rejects extras.
compileWith :: ParseOptions -> String -> Either ParseError (Value -> Either Error String)
compileWith opts src =
  mkRenderer <$> lmap NEA.head
    (parseCore (opts { extras = false, decorators = false, partialBlocks = false }) src)

-- | One-shot render of core source against data.
render :: String -> Value -> Either String String
render src dat = case parseRaw src of
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
renderDiag src dat = case parseRaw src of
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
-- | "operation" is the native boundary word; ClassicBars' twin is `renderWith` (helper).
renderWithOperations
  :: Array (Tuple String (Operation (Either Error) (RefEnv (Either Error))))
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String String
renderWithOperations operations partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parseRaw src of
      Left pes -> Left (renderParseErrorsAt src pes)
      Right { directives, nodes } ->
        let
          h = hoistInline nodes
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          -- Inline definitions in the template win over same-named external
          -- partials (left-biased union), matching ClassicBars.
          setup =
            withTruthy nonEmpty
              <<< withYieldName "yield"
              <<< registerAll operations
              <<< registerPartials (Map.union h.partials externalT)
        in
          lmap (formatError src) (runResolved directives setup h.template dat)
  where
  compilePartial (Tuple name s) = case parseRaw s of
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
    Right ps -> case parseRaw src of
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
  compilePartial (Tuple name s) = case parseRaw s of
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
    Right ps -> case parseRaw src of
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
  compilePartial (Tuple name s) = case parseRaw s of
    Left es -> Left (renderParseErrorsAt s es)
    Right { nodes } -> Right { name, template: nodes }

-- | The async instantiation: the same engine in `ExceptT Error Aff`.
renderAff :: String -> Value -> Aff (Either Error String)
renderAff src dat = case parseRaw src of
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
-- Compilation (core syntax → JS, via the shared driver + ClassicBars Emit)
--------------------------------------------------------------------------------

-- | Compile core source to a JS ES module. `{{#inline "name"}}` definitions are
-- | hoisted into the partial registry (the shared `Kernel.Hoist.hoistInline`),
-- | exactly as `render` does and as ClassicBars/MaxBars compile — so RawBars differs
-- | only in surface syntax, not capability (ADR-005/008).
compileJs :: String -> Either ParseError String
compileJs src = emitJs <$> lmap NEA.head (parseRaw src)

-- | `compileJs` with explicit parse options (the CLI's configurable core path); RawBars
-- | always rejects extras.
compileJsWith :: ParseOptions -> String -> Either ParseError String
compileJsWith opts src =
  emitJs <$> lmap NEA.head
    (parseCore (opts { extras = false, decorators = false, partialBlocks = false }) src)

-- | Emit the compiled JS ES module for a parsed RawBars template.
emitJs :: Parsed -> String
emitJs { nodes } =
  let
    h = hoistInline nodes
  in
    Driver.compile (metaFor "rt.truthyNonEmpty" "yield") coreEmit (Map.toUnfoldable h.partials)
      h.template
