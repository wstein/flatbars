-- | The shared *render glue*: assemble the prelude environment (with the engine's
-- | fixed truthiness rule) and run the engine. Dialect-agnostic — every dialect
-- | (RawBars/FullBars/MaxBars) renders through `runResolved`, so it lives in the
-- | kernel, not in any one dialect.
module Kernel.Render
  ( preludeEnv
  , runResolved
  , runResolvedLenient
  , formatError
  ) where

import Prelude

import Control.Monad.Error.Class (class MonadThrow)
import FlatBars.Error (Error(ParseFailure), renderParseErrorAt)
import FlatBars.Syntax (Directive, Template)
import FlatBars.Value (Value)
import Kernel.Engine (Engine, runTemplate)
import Kernel.Env (RefEnv, constOperation, emptyEnv, refEngine, refEngineWith, register, registerAll)
import Kernel.Prelude (lenientResolve, prelude)

-- | An environment with the reference prelude, the given data as context, and a
-- | `root` helper returning the top-level data. Polymorphic in `m`.
preludeEnv :: forall m. MonadThrow Error m => Value -> RefEnv m
preludeEnv dat =
  registerAll prelude (register "root" (constOperation dat) (emptyEnv dat))

-- | Render `nodes` against a prelude env (the engine's fixed truthiness rule —
-- | the `handlebars` default `emptyEnv` installs; ADR-022). `setup` adds anything
-- | extra to the env (e.g. partials). The `directives` argument is retained for
-- | call-site compatibility but no longer selects a truthiness mode — there is no
-- | per-file `@truthiness` anymore.
runResolved
  :: forall m
   . MonadThrow Error m
  => Array Directive
  -> (RefEnv m -> RefEnv m)
  -> Template
  -> Value
  -> m String
runResolved = runResolvedUsing refEngine

-- | Like `runResolved`, but with FullBars' Handlebars-style *lenient resolve*: a
-- | `{{#x}}` block over data iterates / renders rather than erroring — whether `x`
-- | is unregistered or a prelude value helper used as a bare block
-- | (`Kernel.Prelude.lenientResolve`). FullBars (and MaxBars, its superset) render
-- | through this; RawBars keeps the strict `runResolved`.
runResolvedLenient
  :: forall m
   . MonadThrow Error m
  => Array Directive
  -> (RefEnv m -> RefEnv m)
  -> Template
  -> Value
  -> m String
runResolvedLenient = runResolvedUsing (refEngineWith lenientResolve)

-- | Shared body of `runResolved` / `runResolvedLenient`, parameterised by how the
-- | seeded environment becomes an `Engine` (strict vs lenient resolve).
runResolvedUsing
  :: forall m
   . MonadThrow Error m
  => (RefEnv m -> Engine m (RefEnv m))
  -> Array Directive
  -> (RefEnv m -> RefEnv m)
  -> Template
  -> Value
  -> m String
runResolvedUsing toEngine _directives setup nodes dat =
  runTemplate (toEngine (setup (preludeEnv dat))) nodes

-- | Format an engine `Error` against its source for a host boundary: a parse
-- | failure becomes a located `line:column: message`; everything else keeps its
-- | `show` form. What a JS/CLI facade should print instead of a bare offset.
formatError :: String -> Error -> String
formatError src = case _ of
  ParseFailure pe -> renderParseErrorAt src pe
  e -> show e
