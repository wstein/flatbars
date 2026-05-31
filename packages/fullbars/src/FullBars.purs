-- | FullBars — the reference template engine built on the BareBars framework.
-- |
-- | "Flat bars" to BareBars' "bare rods": one *possible* engine over the
-- | substrate (ADR-001). It supplies the Handlebars-flavoured meaning the
-- | framework deliberately omits — value policy (`truthy`/`escapeHtml`/
-- | `stringify`), an environment (`RefEnv`/`refEngine`), the prelude of helpers,
-- | and the desugaring walk (`lower`) — and wires them into convenience
-- | renderers. Swap any of it for a different engine without touching `barebars`.
module FullBars
  ( module Kernel.Value
  , module Kernel.Env
  , module Kernel.Prelude
  , module Kernel.Lower
  , module Kernel.Render
  , module FullBars.Surface
  , surfaceClauses
  , desugarSurface
  , compileSurface
  , renderSurface
  , renderSurfaceWith
  , renderSurfaceDiag
  , renderSurfaceDiagWith
  , renderSurfaceValue
  ) where

import Prelude

import BareBars.Error (Error, ParseError, renderParseErrorAt)
import BareBars.Parser (ParseOptions, defaultParseOptions, parse, parseWith)
import BareBars.Syntax (Ident, Template)
import BareBars.Value (Value)
import Data.Either (Either(..))
import Data.Map as Map
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FullBars.Surface (desugar, hoistInline)
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

-- | `renderSurface` with located parse-error messages (`formatError`): a parse
-- | failure reports `line:column`, an eval failure keeps its `show` form.
renderSurfaceDiag :: String -> Value -> Either String String
renderSurfaceDiag = renderSurfaceDiagWith defaultParseOptions

-- | `renderSurfaceDiag` with explicit parse options (CLI/config path).
renderSurfaceDiagWith :: ParseOptions -> String -> Value -> Either String String
renderSurfaceDiagWith opts src dat = case parseWith opts src of
  Left pe -> Left (renderParseErrorAt src pe)
  Right { directives, nodes } ->
    let
      { partials, template } = hoistInline (desugarSurface nodes)
    in
      case runResolved directives (registerPartials partials) template dat of
        Left e -> Left (formatError src e)
        Right out -> Right out

-- | Render *Surface* source against native PureScript data lowered via
-- | `ToValue` (host binding). `renderSurfaceValue tmpl { name: "Ada" }`. Uses
-- | located error messages.
renderSurfaceValue :: forall a. ToValue a => String -> a -> Either String String
renderSurfaceValue src = renderSurfaceDiag src <<< toValue
