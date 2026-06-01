-- | The shared *render glue*: assemble the prelude environment, resolve a file's
-- | `@truthiness` mode, seed it, and run the engine. Dialect-agnostic — every
-- | dialect (RawBars/FullBars/MaxBars) renders through `runResolved`, so it lives
-- | in the kernel, not in any one dialect.
module Kernel.Render
  ( preludeEnv
  , runResolved
  , formatError
  ) where

import Prelude

import Control.Monad.Error.Class (class MonadThrow)
import FlatBars.Error (Error(ParseFailure), renderParseErrorAt)
import FlatBars.Syntax (Directive, Template)
import FlatBars.Value (Value)
import Kernel.Engine (runTemplate)
import Kernel.Env (RefEnv, constHelper, emptyEnv, liftEither, refEngine, register, registerAll, withFalsy)
import Kernel.Prelude (prelude)
import Kernel.Value (resolveTruthiness)

-- | An environment with the reference prelude, the given data as context, and a
-- | `root` helper returning the top-level data. Polymorphic in `m`.
preludeEnv :: forall m. MonadThrow Error m => Value -> RefEnv m
preludeEnv dat =
  registerAll prelude (register "root" (constHelper dat) (emptyEnv dat))

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
runResolved directives setup nodes dat = do
  fs <- liftEither (resolveTruthiness directives)
  runTemplate (refEngine (withFalsy fs (setup (preludeEnv dat)))) nodes

-- | Format an engine `Error` against its source for a host boundary: a parse
-- | failure becomes a located `line:column: message`; everything else keeps its
-- | `show` form. What a JS/CLI facade should print instead of a bare offset.
formatError :: String -> Error -> String
formatError src = case _ of
  ParseFailure pe -> renderParseErrorAt src pe
  e -> show e
