-- | FlatBars — the reference template engine built on the BareBars framework.
-- |
-- | "Flat bars" to BareBars' "bare rods": one *possible* engine over the
-- | substrate (ADR-001). It supplies the Handlebars-flavoured meaning the
-- | framework deliberately omits — value policy (`truthy`/`escapeHtml`/
-- | `stringify`), an environment (`RefEnv`/`refEngine`), the prelude of helpers,
-- | and the desugaring walk (`lower`) — and wires them into convenience
-- | renderers. Swap any of it for a different engine without touching `barebars`.
module FlatBars
  ( module FlatBars.Value
  , module FlatBars.Env
  , module FlatBars.Prelude
  , module FlatBars.Lower
  , module FlatBars.Surface
  , preludeEnv
  , compile
  , renderWith
  , renderWithDiag
  , renderValue
  , renderAff
  , surfaceClauses
  , desugarSurface
  , compileSurface
  , renderSurface
  , renderSurfaceWith
  , renderSurfaceDiag
  , renderSurfaceValue
  , formatError
  ) where

import Prelude

import BareBars.Engine (runString, runTemplate)
import BareBars.Error (Error(ParseFailure), ParseError, renderParseErrorAt)
import BareBars.Parser (parse)
import BareBars.Syntax (Ident, Template)
import BareBars.ToValue (class ToValue, toValue)
import BareBars.Value (Value)
import Control.Monad.Error.Class (class MonadThrow)
import Control.Monad.Except.Trans (runExceptT)
import Data.Either (Either(..))
import Data.Map as Map
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import Effect.Aff (Aff)
import FlatBars.Env (RefEnv, constHelper, emptyEnv, refEngine, register, registerAll, registerPartials)
import FlatBars.Lower (RNode(..), escapingWarnings, lower)
import FlatBars.Prelude (prelude, preludeSchema)
import FlatBars.Surface (desugar, hoistInline)
import FlatBars.Value (escapeHtml, stringify, truthy)

-- | Build a FlatBars environment with the prelude, the given data as context,
-- | and a `root` helper returning the top-level data. Polymorphic in `m`.
preludeEnv :: forall m. MonadThrow Error m => Value -> RefEnv m
preludeEnv dat =
  registerAll prelude (register "root" (constHelper dat) (emptyEnv dat))

-- | Parse a core template and return a pure renderer closed over the engine.
compile :: String -> Either ParseError (Value -> Either Error String)
compile src = do
  tmpl <- parse src
  pure \dat -> runTemplate (refEngine (preludeEnv dat)) tmpl

-- | One-shot pure render: parse core source and render against prelude + data.
renderWith :: String -> Value -> Either String String
renderWith src dat = case runString (refEngine (preludeEnv dat)) src of
  Left e -> Left (show e)
  Right out -> Right out

-- | Format an engine `Error` against its source for a host boundary: a parse
-- | failure becomes a located `line:column: message` (xref host-api §7); every
-- | other error keeps its `show` form. This is what a JS/CLI facade should
-- | print instead of a bare offset.
formatError :: String -> Error -> String
formatError src = case _ of
  ParseFailure pe -> renderParseErrorAt src pe
  e -> show e

-- | `renderWith` with located parse-error messages (`formatError`).
renderWithDiag :: String -> Value -> Either String String
renderWithDiag src dat = case runString (refEngine (preludeEnv dat)) src of
  Left e -> Left (formatError src e)
  Right out -> Right out

-- | Render *core* source against native PureScript data — a record, `Array`,
-- | `Map`, etc. lowered via `ToValue` (host binding). `renderValue tmpl { name:
-- | "Ada" }`. Uses located error messages.
renderValue :: forall a. ToValue a => String -> a -> Either String String
renderValue src = renderWithDiag src <<< toValue

-- | The async instantiation: the same engine in `ExceptT Error Aff`, so
-- | effectful helpers/partials are possible. Proof the driver is monad-polymorphic.
renderAff :: String -> Value -> Aff (Either Error String)
renderAff src dat = runExceptT (runString (refEngine (preludeEnv dat)) src)

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
  tmpl <- parse src
  let
    { partials, template } = hoistInline (desugarSurface tmpl)
  pure \dat -> runTemplate (refEngine (registerPartials partials (preludeEnv dat))) template

-- | One-shot pure render of *Surface* source (paths, `{{ }}` auto-escape, …).
renderSurface :: String -> Value -> Either String String
renderSurface = renderSurfaceWith []

-- | Render Surface source with a set of named partials (each given as Surface
-- | source). `{{> name}}` renders a registered partial; `{{#inline "name"}}…`
-- | definitions in the template are hoisted into the registry too.
renderSurfaceWith :: Array (Tuple String String) -> String -> Value -> Either String String
renderSurfaceWith partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left (show e)
    Right pairs -> case parse src of
      Left e -> Left (show e)
      Right tmpl ->
        let
          { partials: inlineP, template } = hoistInline (desugarSurface tmpl)
          env = registerPartials (Map.union inlineP (Map.fromFoldable pairs)) (preludeEnv dat)
        in
          case runTemplate (refEngine env) template of
            Left e -> Left (show e)
            Right out -> Right out
  where
  compilePartial (Tuple name s) = case parse s of
    Left e -> Left e
    Right t -> Right (Tuple name (desugarSurface t))

-- | `renderSurface` with located parse-error messages (`formatError`): a parse
-- | failure reports `line:column`, an eval failure keeps its `show` form.
renderSurfaceDiag :: String -> Value -> Either String String
renderSurfaceDiag src dat = case parse src of
  Left pe -> Left (renderParseErrorAt src pe)
  Right tmpl ->
    let
      { partials, template } = hoistInline (desugarSurface tmpl)
      env = registerPartials partials (preludeEnv dat)
    in
      case runTemplate (refEngine env) template of
        Left e -> Left (formatError src e)
        Right out -> Right out

-- | Render *Surface* source against native PureScript data lowered via
-- | `ToValue` (host binding). `renderSurfaceValue tmpl { name: "Ada" }`. Uses
-- | located error messages.
renderSurfaceValue :: forall a. ToValue a => String -> a -> Either String String
renderSurfaceValue src = renderSurfaceDiag src <<< toValue
