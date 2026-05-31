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
  , renderAff
  , surfaceClauses
  , desugarSurface
  , compileSurface
  , renderSurface
  ) where

import Prelude

import BareBars.Engine (runString, runTemplate)
import BareBars.Error (Error, ParseError)
import BareBars.Parser (parse)
import BareBars.Syntax (Ident, Template)
import BareBars.Value (Value)
import Control.Monad.Error.Class (class MonadThrow)
import Control.Monad.Except.Trans (runExceptT)
import Data.Either (Either(..))
import Effect.Aff (Aff)
import FlatBars.Env (RefEnv, constHelper, emptyEnv, refEngine, register, registerAll)
import FlatBars.Lower (RNode(..), escapingWarnings, lower)
import FlatBars.Prelude (prelude, preludeSchema)
import FlatBars.Surface (desugar)
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

-- | The async instantiation: the same engine in `ExceptT Error Aff`, so
-- | effectful helpers/partials are possible. Proof the driver is monad-polymorphic.
renderAff :: String -> Value -> Aff (Either Error String)
renderAff src dat = runExceptT (runString (refEngine (preludeEnv dat)) src)

-- | The clause-separator names this engine recognizes (so the surface knows a
-- | `{{else}}` is a clause marker, not escaped output).
surfaceClauses :: Array Ident
surfaceClauses = [ "else" ]

-- | Desugar Surface syntax to core syntax for this engine (surface.adoc §5).
desugarSurface :: Template -> Template
desugarSurface = desugar surfaceClauses

-- | Parse + desugar Surface source into a compiled renderer.
compileSurface :: String -> Either ParseError (Value -> Either Error String)
compileSurface src = do
  tmpl <- parse src
  let core = desugarSurface tmpl
  pure \dat -> runTemplate (refEngine (preludeEnv dat)) core

-- | One-shot pure render of *Surface* source (paths, `{{ }}` auto-escape, …).
renderSurface :: String -> Value -> Either String String
renderSurface src dat = case parse src of
  Left e -> Left (show e)
  Right tmpl -> case runTemplate (refEngine (preludeEnv dat)) (desugarSurface tmpl) of
    Left e -> Left (show e)
    Right out -> Right out
