-- | BareBars — the host API. See `docs/modules/ROOT/pages/host-api.adoc`.
-- |
-- | Re-exports the core types and the polymorphic engine driver, and wires the
-- | reference engine + prelude into convenience functions. The driver is
-- | monad- and environment-polymorphic; this module provides two ready
-- | instantiations: a pure host (`Either Error`) and an async one
-- | (`ExceptT Error Aff`).
module BareBars
  ( module BareBars.Syntax
  , module BareBars.Value
  , module BareBars.Error
  , module BareBars.Engine
  , module BareBars.Env
  , module BareBars.Lower
  , module BareBars.Parser
  , module BareBars.Prelude
  , module BareBars.Span
  , module BareBars.Walk
  , preludeEnv
  , compile
  , renderWith
  , renderAff
  ) where

import Prelude

import BareBars.Engine (Ctl, Engine, Helper, runString, runTemplate)
import BareBars.Env (RefEnv, constHelper, emptyEnv, refEngine, register, registerAll)
import BareBars.Error (Error, ParseError)
import BareBars.Lower (RNode(..), escapingWarnings, lower)
import BareBars.Parser (parse)
import BareBars.Prelude (prelude, preludeSchema)
import BareBars.Span (Span, lineColumn, spanText)
import BareBars.Syntax (Expr(..), Node(..), Template)
import BareBars.Value (Value(..), stringify, truthy)
import BareBars.Walk (Algebra, foldTemplate, helperRefs, splitClause, validate)
import Control.Monad.Error.Class (class MonadThrow)
import Control.Monad.Except.Trans (runExceptT)
import Data.Either (Either(..))
import Effect.Aff (Aff)

-- | Build a reference environment with the prelude, the given data as context,
-- | and a `root` helper returning the top-level data. Polymorphic in `m`.
preludeEnv :: forall m. MonadThrow Error m => Value -> RefEnv m
preludeEnv dat =
  registerAll prelude (register "root" (constHelper dat) (emptyEnv dat))

-- | Parse a *core* template and return a pure renderer closed over the
-- | reference engine.
compile :: String -> Either ParseError (Value -> Either Error String)
compile src = do
  tmpl <- parse src
  pure \dat -> runTemplate (refEngine (preludeEnv dat)) tmpl

-- | One-shot pure render: parse core source and render against prelude + data.
renderWith :: String -> Value -> Either String String
renderWith src dat = case runString (refEngine (preludeEnv dat)) src of
  Left e -> Left (show e)
  Right out -> Right out

-- | The async instantiation: the same engine and prelude, but in
-- | `ExceptT Error Aff`, so effectful helpers and partials are possible. Proof
-- | that the driver is monad-polymorphic.
renderAff :: String -> Value -> Aff (Either Error String)
renderAff src dat = runExceptT (runString (refEngine (preludeEnv dat)) src)
