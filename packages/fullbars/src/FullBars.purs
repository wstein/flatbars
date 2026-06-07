-- | FullBars — the reference template engine built on the FlatBars framework.
-- |
-- | "Flat bars" to FlatBars' "bare rods": one *possible* engine over the
-- | substrate (ADR-001). It supplies the Handlebars-flavoured meaning the
-- | framework deliberately omits — value policy (`truthy`/`escapeHtml`/
-- | `stringify`), an environment (`RefEnv`/`refEngine`), the prelude of helpers,
-- | and the desugaring walk (`lower`) — and wires them into convenience
-- | renderers. Swap any of it for a different engine without touching `flatbars`.
module FullBars
  ( module Kernel.Value
  , module Kernel.Env
  , module Kernel.Prelude
  , module Kernel.Lower
  , module Kernel.Render
  , module Kernel.Hoist
  , module FullBars.Surface
  , surfaceClauses
  , checkBareInline
  , desugarSurface
  , desugarSurfaceWith
  , compileSurface
  , renderSurface
  , renderSurfaceWith
  , renderSurfaceWithHelpers
  , renderSurfaceWithHelpersWith
  , renderSurfaceDiag
  , renderSurfaceDiagWith
  , renderSurfaceMapped
  , renderSurfaceMappedWith
  , renderSurfaceMappedDiagWith
  , inspectSurfaceWith
  , renderSurfaceValue
  , renderSurfaceI18n
  , analyseSurface
  , analyseSurfaceWith
  ) where

import Prelude

import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Foldable (elem)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error, ParseError(..), renderParseErrorAt, renderParseErrorsAt)
import FlatBars.Parser (ParseOptions, defaultParseOptions, parse, parseWith)
import FlatBars.Syntax (Ident, Template)
import FlatBars.Value (Value)
import FullBars.Surface (LoopVars, bareInlineOffset, desugar, desugarWith, noLoopVars)
import Kernel.Analyse (Finding, PathSchema, allFindings, anyPath, evaluatedCount, jsonataScaffold, reportMarkdown, runAnalysis)
import Kernel.Engine (Operation)
import Kernel.Env (RefEnv, constOperation, emptyEnv, liftEither, refEngine, refEngineWith, register, registerAll, registerPartialFiles, registerPartials, withTranslator, withTruthy, withYieldName)
import Kernel.Hoist (hoistInline)
import Kernel.Inspect (Snapshot, Target, inspectResolvedLenient)
import Kernel.Lower (RNode(..), directiveLints, escapingWarnings, lower)
import Kernel.Prelude (lenientResolve, prelude, preludeSchema)
import Kernel.Provenance (Segment, runResolvedLenientMapped)
import Kernel.Render (formatError, preludeEnv, runResolvedLenient)
import Kernel.ToValue (class ToValue, toValue)
import Kernel.Value (Translator, Truthy, escapeHtml, handlebars, minimal, mustache, nonEmpty, presence, stringify)
import Kernel.Walk (operationRefs)

-- | The clause-separator names this engine recognizes (so the surface knows a
-- | `{{else}}` is a clause marker, not escaped output).
surfaceClauses :: Array Ident
surfaceClauses = [ "else", "elif" ]

-- | Desugar Surface syntax to core syntax for this engine (surface.adoc §5).
desugarSurface :: Template -> Template
desugarSurface = desugar surfaceClauses

-- | Desugar with a dialect `LoopVars` resolver (MaxBars passes its loop-variable
-- | map; `desugarSurface` is `desugarSurfaceWith noLoopVars`).
desugarSurfaceWith :: LoopVars -> Template -> Template
desugarSurfaceWith lv = desugarWith lv surfaceClauses

-- | Reject a bare `{{#inline}}` block on the *strict* (FullBars/CLI) surface: an
-- | inline partial must be the decorator `{{#*inline "name"}}` (surface.adoc
-- | §5.7), reported as a located `DisallowedShape`. The decorator lexes as the
-- | distinct `Decorator` sigil, so a `Block Section "inline"` is unambiguously the
-- | bare misuse. MaxBars passes `strict = false` — it gates the decorator off and
-- | keeps the bare form as its only inline-partial spelling (left as-is).
checkBareInline :: Boolean -> Template -> Either ParseError Unit
checkBareInline strict nodes
  | strict = case bareInlineOffset nodes of
      Just off -> Left
        ( DisallowedShape "{{#inline}} (an inline partial uses the {{#*inline \"name\"}} decorator)"
            off
        )
      Nothing -> pure unit
  | otherwise = pure unit

-- | Parse + desugar Surface source into a compiled renderer. `{{#inline}}`
-- | definitions are hoisted into the partial registry before rendering.
compileSurface :: String -> Either ParseError (Value -> Either Error String)
compileSurface src = do
  { directives, nodes } <- lmap NEA.head (parse src)
  checkBareInline true nodes
  let
    { partials, template } = hoistInline (desugarSurface nodes)
  pure \dat -> runResolvedLenient directives (registerPartials partials) template dat

-- | One-shot pure render of *Surface* source (paths, `{{ }}` auto-escape, …).
renderSurface :: String -> Value -> Either String String
renderSurface = renderSurfaceWith []

-- | Render Surface source with a set of named partials (each given as Surface
-- | source). `{{> name}}` renders a registered partial; `{{#inline "name"}}…`
-- | definitions in the template are hoisted into the registry too.
renderSurfaceWith :: Array (Tuple String String) -> String -> Value -> Either String String
renderSurfaceWith partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parse src of
      Left e -> Left (show e)
      Right { nodes } | Left e <- checkBareInline true nodes -> Left (renderParseErrorAt src e)
      Right { directives, nodes } ->
        let
          { partials: inlineP, template } = hoistInline (desugarSurface nodes)
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          setup = registerPartials (Map.union inlineP externalT)
        in
          case runResolvedLenient directives setup template dat of
            Left e -> Left (show e)
            Right out -> Right out
  where
  -- a named *external* partial: parse + desugar its body. Every partial renders
  -- under the engine's single truthiness rule now (ADR-022) — no per-file mode.
  compilePartial (Tuple name s) = case parse s of
    Left e -> Left (show e)
    Right { nodes } -> Right { name, template: desugarSurface nodes }

-- | Like `renderSurface`, but also returns a source map (ADR-035): each `Segment`
-- | ties a run of the output back to the tag in the entry template that produced
-- | it. The map degrades to `[]` if a block helper transforms its body's output.
renderSurfaceMapped
  :: String -> Value -> Either String { output :: String, segments :: Array Segment }
renderSurfaceMapped = renderSurfaceMappedWith []

-- | `renderSurfaceMapped` with named external partials (each Surface source) — the
-- | mapped twin of `renderSurfaceWith`. Emits produced inside a partial tile the
-- | output but carry no entry-template span.
renderSurfaceMappedWith
  :: Array (Tuple String String)
  -> String
  -> Value
  -> Either String { output :: String, segments :: Array Segment }
renderSurfaceMappedWith = renderSurfaceMappedDiagWith true noLoopVars defaultParseOptions handlebars

-- | The mapped twin of `renderSurfaceDiagWith`, parameterised by dialect: the
-- | bare-`{{#inline}}` strictness, the `LoopVars` resolver, the parse options, and
-- | the truthiness rule. FullBars passes the surface defaults; MaxBars passes its
-- | own (`maxLoopVars` / `maxOptions` / `nonEmpty`). Returns the output plus a
-- | tiling source map (located parse/render errors as `Left`).
renderSurfaceMappedDiagWith
  :: Boolean
  -> LoopVars
  -> ParseOptions
  -> Truthy
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String { output :: String, segments :: Array Segment }
renderSurfaceMappedDiagWith strict lv opts truthy partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parseWith opts src of
      Left pes -> Left (renderParseErrorsAt src pes)
      Right { nodes } | Left e <- checkBareInline strict nodes -> Left (renderParseErrorAt src e)
      Right { nodes } ->
        let
          { partials: inlineP, template } = hoistInline (desugarSurfaceWith lv nodes)
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          -- inline partials index "main" (where they are defined); externals index
          -- their own source — the file dimension of the source map (ADR-035).
          partialFiles = Map.union (map (const "main") inlineP)
            (Map.fromFoldable (map (\p -> Tuple p.name p.name) ps))
          setup =
            registerPartialFiles partialFiles
              <<< withTruthy truthy
              <<< withYieldName (if opts.partialBlocks then "partial-block" else "yield")
              <<< registerPartials (Map.union inlineP externalT)
        in
          lmap (formatError src) (runResolvedLenientMapped setup template dat)
  where
  compilePartial (Tuple name s) = case parseWith opts s of
    Left pes -> Left (renderParseErrorsAt s pes)
    Right { nodes } -> Right { name, template: desugarSurfaceWith lv nodes }

-- | Context Inspector (ADR-035): snapshot the render context at the source span
-- | `target` (an output run's provenance) — one snapshot per execution of the
-- | matching emit. The Surface twin of `renderSurfaceMappedWith`, sharing the file
-- | dimension so a span inside a partial resolves there.
inspectSurfaceWith
  :: Target
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String (Array Snapshot)
inspectSurfaceWith target partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parse src of
      Left e -> Left (show e)
      Right { nodes } | Left e <- checkBareInline true nodes -> Left (renderParseErrorAt src e)
      Right { nodes } ->
        let
          { partials: inlineP, template } = hoistInline (desugarSurface nodes)
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          partialFiles = Map.union (map (const "main") inlineP)
            (Map.fromFoldable (map (\p -> Tuple p.name p.name) ps))
          setup = registerPartialFiles partialFiles <<< registerPartials
            (Map.union inlineP externalT)
        in
          lmap (formatError src) (inspectResolvedLenient setup target template dat)
  where
  compilePartial (Tuple name s) = case parse s of
    Left e -> Left (show e)
    Right { nodes } -> Right { name, template: desugarSurface nodes }

-- | `renderSurfaceWith` plus host-registered inline helpers (ADR-018): each
-- | `(name, helper)` is registered into the env alongside the prelude and the
-- | partials, so a `{{loud x}}` resolves to the supplied helper. The JS facade
-- | marshals user functions into these `Operation`s; the interpreter and the
-- | compiled path (which routes the same names through `rt.call` →
-- | `rt.register`) therefore agree. Parse errors are located (`line:column`).
renderSurfaceWithHelpers
  :: Array (Tuple String (Operation (Either Error) (RefEnv (Either Error))))
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String String
renderSurfaceWithHelpers = renderSurfaceWithHelpersWith true noLoopVars defaultParseOptions
  handlebars

-- | `renderSurfaceWithHelpers` parameterised by the dialect's `LoopVars` and
-- | `ParseOptions`, so MaxBars (`renderWithOperations`, ADR-019 addendum) registers
-- | host operations over *its* surface (infix/pipes/loop vars). FullBars is the
-- | `noLoopVars` / `defaultParseOptions` specialisation above. The leading
-- | `strict` flag gates the bare-`{{#inline}}` rejection (`checkBareInline`):
-- | `true` for FullBars/CLI, `false` for MaxBars.
renderSurfaceWithHelpersWith
  :: Boolean
  -> LoopVars
  -> ParseOptions
  -> Truthy
  -> Array (Tuple String (Operation (Either Error) (RefEnv (Either Error))))
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String String
renderSurfaceWithHelpersWith strict lv opts truthy helpers partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parseWith opts src of
      Left pes -> Left (renderParseErrorsAt src pes)
      Right { nodes } | Left e <- checkBareInline strict nodes -> Left (renderParseErrorAt src e)
      Right { directives, nodes } ->
        let
          { partials: inlineP, template } = hoistInline (desugarSurfaceWith lv nodes)
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          setup =
            withTruthy truthy
              -- ADR-005 amendment: the dialect that accepts Handlebars `{{#> }}`
              -- block partials (`opts.partialBlocks` — FullBars) exposes the body as
              -- `partial-block`; the others (MaxBars, reusing this path) use `yield`.
              <<< withYieldName (if opts.partialBlocks then "partial-block" else "yield")
              <<< registerAll helpers
              <<< registerPartials (Map.union inlineP externalT)
        in
          case runResolvedLenient directives setup template dat of
            Left e -> Left (formatError src e)
            Right out -> Right out
  where
  -- mirrors `renderSurfaceWith.compilePartial`, but locates the error and uses the
  -- dialect's parse options + loop-var desugar.
  compilePartial (Tuple name s) = case parseWith opts s of
    Left es -> Left (renderParseErrorsAt s es)
    Right { nodes } -> Right { name, template: desugarSurfaceWith lv nodes }

-- | `renderSurface` with located parse-error messages (`formatError`): a parse
-- | failure reports `line:column`, an eval failure keeps its `show` form.
renderSurfaceDiag :: String -> Value -> Either String String
renderSurfaceDiag = renderSurfaceDiagWith true noLoopVars defaultParseOptions handlebars

-- | `renderSurfaceDiag` with explicit parse options and a dialect `LoopVars`
-- | resolver (the CLI/config + dialect path; FullBars passes `noLoopVars`,
-- | MaxBars its loop-variable map). The leading `strict` flag gates the
-- | bare-`{{#inline}}` rejection: `true` for FullBars/CLI, `false` for MaxBars.
renderSurfaceDiagWith
  :: Boolean -> LoopVars -> ParseOptions -> Truthy -> String -> Value -> Either String String
renderSurfaceDiagWith strict lv opts truthy src dat = case parseWith opts src of
  Left pes -> Left (renderParseErrorsAt src pes)
  Right { nodes } | Left e <- checkBareInline strict nodes -> Left (renderParseErrorAt src e)
  Right { directives, nodes } ->
    let
      { partials, template } = hoistInline (desugarSurfaceWith lv nodes)
    in
      case
        runResolvedLenient directives
          ( withTruthy truthy
              <<< withYieldName (if opts.partialBlocks then "partial-block" else "yield")
              <<< registerPartials partials
          )
          template
          dat
        of
        Left e -> Left (formatError src e)
        Right out -> Right out

-- | Render *Surface* source against native PureScript data lowered via
-- | `ToValue` (host binding). `renderSurfaceValue tmpl { name: "Ada" }`. Uses
-- | located error messages.
renderSurfaceValue :: forall a. ToValue a => String -> a -> Either String String
renderSurfaceValue src = renderSurfaceDiag src <<< toValue

-- | Render Surface source with a host i18n `Translator` seeded (ADR-029): the
-- | first-class seam that drives `t`/`number`/`date`/`selectPlural`/`relative`,
-- | seeded exactly like the truthiness rule (`withTranslator`, the i18n analogue of
-- | `withTruthy`). This is how a host (the Lab, the `flatbars-js` facade) wires
-- | localization — not `registerHelper`. Located parse/eval errors as `Left`.
renderSurfaceI18n :: Translator -> String -> Value -> Either String String
renderSurfaceI18n tr src dat = case parse src of
  Left es -> Left (renderParseErrorsAt src es)
  Right { nodes } | Left e <- checkBareInline true nodes -> Left (renderParseErrorAt src e)
  Right { directives, nodes } ->
    let
      { partials, template } = hoistInline (desugarSurface nodes)
    in
      case
        runResolvedLenient directives (withTranslator tr <<< registerPartials partials) template dat
        of
        Left e -> Left (formatError src e)
        Right out -> Right out

-- | Analyse mode (ADR-022 Part B): render `src` against `dat` and return the
-- | (byte-identical) output plus a markdown report of every truthiness decision
-- | that would branch differently on another engine — with a concrete fix each —
-- | and a reviewable JSONata data-cleanup scaffold. Pure (the trace rides a
-- | writer); located parse/eval errors as `Left`.
analyseSurface
  :: String
  -> Value
  -> Either String
       { output :: String
       , report :: String
       , jsonata :: String
       , findings :: Array Finding
       , evaluated :: Int
       }
analyseSurface = analyseSurfaceWith anyPath

-- | `analyseSurface` with a host `PathSchema` (ADR-030): the host plugs in "could
-- | path `p` hold value `v`?" so it can suppress *potential* findings its own types
-- | rule out (e.g. "`count` is always a present positive number"). The default
-- | (`analyseSurface`) supplies `anyPath`, admitting every what-if.
analyseSurfaceWith
  :: PathSchema
  -> String
  -> Value
  -> Either String
       { output :: String
       , report :: String
       , jsonata :: String
       , findings :: Array Finding
       , evaluated :: Int
       }
analyseSurfaceWith schema src dat = case parse src of
  Left es -> Left (renderParseErrorsAt src es)
  Right { nodes } | Left e <- checkBareInline true nodes -> Left (renderParseErrorAt src e)
  Right { nodes } ->
    let
      { partials, template } = hoistInline (desugarSurface nodes)
    in
      case
        runAnalysis (refEngineWith lenientResolve) (registerPartials partials) template dat
        of
        Left e -> Left (formatError src e)
        Right r -> Right
          { output: r.output
          , report: reportMarkdown schema src r.decisions <> i18nNote template
          , jsonata: jsonataScaffold src r.decisions
          , findings: allFindings schema src r.decisions
          , evaluated: evaluatedCount r.decisions
          }

-- | The blessed i18n operations (ADR-029) — the names the host `Translator` drives.
i18nOpNames :: Array Ident
i18nOpNames = [ "t", "number", "date", "selectPlural", "relative" ]

-- | The ADR-029 flag, made precise by the first-class seam: analyse mode renders
-- | with **no translator seeded** (`RefEnv.translator = Nothing`), so every i18n op
-- | necessarily fell back to its key/value. Surface that as an informational report
-- | note (not a truthiness finding — i18n has no branch that flips), so a host sees
-- | "wire a translator or ship keys". Silent off a template that uses no i18n op.
i18nNote :: Template -> String
i18nNote template =
  let
    used = Array.filter (\r -> elem r.name i18nOpNames) (operationRefs template)
  in
    if Array.null used then ""
    else
      "\n\n## ℹ Localization (ADR-029)\n"
        <> "This template calls "
        <> show (Array.length used)
        <> " i18n operation(s) ("
        <> joinWith ", " (Array.nub (map _.name used))
        <> ") — analysed with **no translator wired**, so each rendered its key/value "
        <> "unchanged. Register a host translator (`registerTranslator`, or "
        <> "`withTranslator` in PureScript) or they ship untranslated."
