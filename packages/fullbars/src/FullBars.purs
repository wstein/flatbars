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
  , module FullBars.Surface
  , surfaceClauses
  , desugarSurface
  , desugarSurfaceWith
  , compileSurface
  , renderSurface
  , renderSurfaceWith
  , renderSurfaceWithHelpers
  , renderSurfaceDiag
  , renderSurfaceDiagWith
  , renderSurfaceValue
  ) where

import Prelude

import Data.Either (Either(..))
import Data.Map as Map
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error, ParseError, renderParseErrorAt)
import FlatBars.Parser (ParseOptions, defaultParseOptions, parse, parseWith)
import FlatBars.Syntax (Ident, Template)
import FlatBars.Value (Value)
import FullBars.Surface (LoopVars, desugar, desugarWith, hoistInline, noLoopVars)
import Kernel.Engine (Helper)
import Kernel.Env (RefEnv, constHelper, emptyEnv, liftEither, refEngine, register, registerAll, registerPartials, registerPartialsFalsy, withFalsy)
import Kernel.Lower (RNode(..), crossBoundaryWarnings, directiveLints, escapingWarnings, lower)
import Kernel.Prelude (prelude, preludeSchema)
import Kernel.Render (formatError, preludeEnv, runResolved)
import Kernel.ToValue (class ToValue, toValue)
import Kernel.Value (FalsySet, FalsyShape(..), aliasSet, always, escapeHtml, handlebars, isFalsy, minimal, presence, resolveTruthiness, stringify, truthy)

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

-- | Parse + desugar Surface source into a compiled renderer. `{{#inline}}`
-- | definitions are hoisted into the partial registry before rendering.
compileSurface :: String -> Either ParseError (Value -> Either Error String)
compileSurface src = do
  { directives, nodes } <- parse src
  let
    { partials, template } = hoistInline (desugarSurface nodes)
  pure \dat -> runResolved directives (registerPartials partials) template dat

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
      Right { directives, nodes } ->
        let
          { partials: inlineP, template } = hoistInline (desugarSurface nodes)
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          externalF = Map.fromFoldable (map (\p -> Tuple p.name p.falsy) ps)
          -- external partials carry their own resolved mode; inline partials
          -- (in `inlineP`) get no entry and inherit the file's mode (§5).
          setup = registerPartialsFalsy externalF <<< registerPartials (Map.union inlineP externalT)
        in
          case runResolved directives setup template dat of
            Left e -> Left (show e)
            Right out -> Right out
  where
  -- a named *external* partial: parse + desugar its body and resolve its own
  -- `@truthiness` (a different file ⇒ its own lexical mode).
  compilePartial (Tuple name s) = case parse s of
    Left e -> Left (show e)
    Right { directives, nodes } -> case resolveTruthiness directives of
      Left e -> Left (show e)
      Right falsy -> Right { name, template: desugarSurface nodes, falsy }

-- | `renderSurfaceWith` plus host-registered inline helpers (ADR-018): each
-- | `(name, helper)` is registered into the env alongside the prelude and the
-- | partials, so a `{{loud x}}` resolves to the supplied helper. The JS facade
-- | marshals user functions into these `Helper`s; the interpreter and the
-- | compiled path (which routes the same names through `rt.call` →
-- | `rt.register`) therefore agree. Parse errors are located (`line:column`).
renderSurfaceWithHelpers
  :: Array (Tuple String (Helper (Either Error) (RefEnv (Either Error))))
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String String
renderSurfaceWithHelpers helpers partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parse src of
      Left pe -> Left (renderParseErrorAt src pe)
      Right { directives, nodes } ->
        let
          { partials: inlineP, template } = hoistInline (desugarSurface nodes)
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          externalF = Map.fromFoldable (map (\p -> Tuple p.name p.falsy) ps)
          setup =
            registerAll helpers
              <<< registerPartialsFalsy externalF
              <<< registerPartials (Map.union inlineP externalT)
        in
          case runResolved directives setup template dat of
            Left e -> Left (formatError src e)
            Right out -> Right out
  where
  -- mirrors `renderSurfaceWith.compilePartial`, but locates the error.
  compilePartial (Tuple name s) = case parse s of
    Left e -> Left (renderParseErrorAt s e)
    Right { directives, nodes } -> case resolveTruthiness directives of
      Left e -> Left (show e)
      Right falsy -> Right { name, template: desugarSurface nodes, falsy }

-- | `renderSurface` with located parse-error messages (`formatError`): a parse
-- | failure reports `line:column`, an eval failure keeps its `show` form.
renderSurfaceDiag :: String -> Value -> Either String String
renderSurfaceDiag = renderSurfaceDiagWith noLoopVars defaultParseOptions

-- | `renderSurfaceDiag` with explicit parse options and a dialect `LoopVars`
-- | resolver (the CLI/config + dialect path; FullBars passes `noLoopVars`,
-- | MaxBars its loop-variable map).
renderSurfaceDiagWith :: LoopVars -> ParseOptions -> String -> Value -> Either String String
renderSurfaceDiagWith lv opts src dat = case parseWith opts src of
  Left pe -> Left (renderParseErrorAt src pe)
  Right { directives, nodes } ->
    let
      { partials, template } = hoistInline (desugarSurfaceWith lv nodes)
    in
      case runResolved directives (registerPartials partials) template dat of
        Left e -> Left (formatError src e)
        Right out -> Right out

-- | Render *Surface* source against native PureScript data lowered via
-- | `ToValue` (host binding). `renderSurfaceValue tmpl { name: "Ada" }`. Uses
-- | located error messages.
renderSurfaceValue :: forall a. ToValue a => String -> a -> Either String String
renderSurfaceValue src = renderSurfaceDiag src <<< toValue
