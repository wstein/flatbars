-- | FullBars — the reference template engine built on the BareBars framework.
-- |
-- | "Flat bars" to BareBars' "bare rods": one *possible* engine over the
-- | substrate (ADR-001). It supplies the Handlebars-flavoured meaning the
-- | framework deliberately omits — value policy (`truthy`/`escapeHtml`/
-- | `stringify`), an environment (`RefEnv`/`refEngine`), the prelude of helpers,
-- | and the desugaring walk (`lower`) — and wires them into convenience
-- | renderers. Swap any of it for a different engine without touching `barebars`.
module FullBars
  ( module FullBars.Value
  , module FullBars.Env
  , module FullBars.Prelude
  , module FullBars.Lower
  , module FullBars.Surface
  , preludeEnv
  , surfaceClauses
  , desugarSurface
  , compileSurface
  , renderSurface
  , renderSurfaceWith
  , renderSurfaceDiag
  , renderSurfaceDiagWith
  , renderSurfaceValue
  , formatError
  , runResolved
  ) where

import Prelude

import BareBars.Engine (runTemplate)
import BareBars.Error (Error(ParseFailure), ParseError, renderParseErrorAt)
import BareBars.Parser (ParseOptions, defaultParseOptions, parse, parseWith)
import BareBars.Syntax (Directive, Ident, Template)
import BareBars.ToValue (class ToValue, toValue)
import BareBars.Value (Value)
import Control.Monad.Error.Class (class MonadThrow)
import Data.Either (Either(..))
import Data.Map as Map
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FullBars.Env (RefEnv, constHelper, emptyEnv, liftEither, refEngine, register, registerAll, registerPartials, registerPartialsFalsy, withFalsy)
import FullBars.Lower (RNode(..), crossBoundaryWarnings, directiveLints, escapingWarnings, lower)
import FullBars.Prelude (prelude, preludeSchema)
import FullBars.Surface (desugar, hoistInline)
import FullBars.Value (FalsySet, FalsyShape(..), aliasSet, always, escapeHtml, handlebars, isFalsy, minimal, presence, resolveTruthiness, stringify, truthy)

-- | Build a FullBars environment with the prelude, the given data as context,
-- | and a `root` helper returning the top-level data. Polymorphic in `m`.
preludeEnv :: forall m. MonadThrow Error m => Value -> RefEnv m
preludeEnv dat =
  registerAll prelude (register "root" (constHelper dat) (emptyEnv dat))

-- | Render `nodes` against a prelude env seeded with the falsy-set resolved from
-- | the template's header `directives` — the engine's truthiness *application*
-- | point (truthiness spec §4.2). `setup` adds anything extra to the env (e.g.
-- | surface partials). A resolution failure is thrown into `m`.
runResolved
  :: forall m
   . MonadThrow Error m
  => Array Directive
  -> (RefEnv m -> RefEnv m)
  -> Template
  -> Value
  -> m String
runResolved directives setup nodes dat = do
  fs <- liftEither (resolveTruthiness directives)
  runTemplate (refEngine (withFalsy fs (setup (preludeEnv dat)))) nodes

-- | Format an engine `Error` against its source for a host boundary: a parse
-- | failure becomes a located `line:column: message` (xref host-api §7); every
-- | other error keeps its `show` form. This is what a JS/CLI facade should
-- | print instead of a bare offset.
formatError :: String -> Error -> String
formatError src = case _ of
  ParseFailure pe -> renderParseErrorAt src pe
  e -> show e

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
