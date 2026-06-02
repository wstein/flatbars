-- | The shared *render glue*: assemble the prelude environment, resolve a file's
-- | `@truthiness` mode, seed it, and run the engine. Dialect-agnostic — every
-- | dialect (RawBars/FullBars/MaxBars) renders through `runResolved`, so it lives
-- | in the kernel, not in any one dialect.
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
import Kernel.Env (RefEnv, constOperation, emptyEnv, liftEither, refEngine, refEngineWith, register, registerAll, withFalsy)
import Kernel.Prelude (blockHelperMissing, prelude)
import Kernel.Value (resolveTruthiness)

-- | An environment with the reference prelude, the given data as context, and a
-- | `root` helper returning the top-level data. Polymorphic in `m`.
preludeEnv :: forall m. MonadThrow Error m => Value -> RefEnv m
preludeEnv dat =
  registerAll prelude (register "root" (constOperation dat) (emptyEnv dat))

-- | Render `nodes` against a prelude env seeded with the falsy-set resolved from
-- | the template's header `directives` — the truthiness *application* point
-- | (spec §4.2). `setup` adds anything extra to the env (e.g. partials). A
-- | resolution failure is thrown into `m`.
runResolved
  :: forall m
   . MonadThrow Error m
  => Array Directive
  -> (RefEnv m -> RefEnv m)
  -> Template
  -> Value
  -> m String
runResolved = runResolvedUsing refEngine

-- | Like `runResolved`, but with FullBars' Handlebars-style *missing-helper*
-- | policy: an unregistered `{{#x}}` block over data iterates / renders rather
-- | than erroring (`Kernel.Prelude.blockHelperMissing`). FullBars (and MaxBars,
-- | its superset) render through this; RawBars keeps the strict `runResolved`.
runResolvedLenient
  :: forall m
   . MonadThrow Error m
  => Array Directive
  -> (RefEnv m -> RefEnv m)
  -> Template
  -> Value
  -> m String
runResolvedLenient = runResolvedUsing (refEngineWith blockHelperMissing)

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
runResolvedUsing toEngine directives setup nodes dat = do
  fs <- liftEither (resolveTruthiness directives)
  runTemplate (toEngine (withFalsy fs (setup (preludeEnv dat)))) nodes

-- | Format an engine `Error` against its source for a host boundary: a parse
-- | failure becomes a located `line:column: message`; everything else keeps its
-- | `show` form. What a JS/CLI facade should print instead of a bare offset.
formatError :: String -> Error -> String
formatError src = case _ of
  ParseFailure pe -> renderParseErrorAt src pe
  e -> show e
