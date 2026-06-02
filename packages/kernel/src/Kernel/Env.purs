-- | The *reference* engine's environment and `Engine` instance.
-- |
-- | The driver (`Kernel.Engine`) is environment-agnostic; this module is one
-- | concrete choice: a stack of helper frames plus the current context. A
-- | different engine could pick an entirely different `env` type — that is the
-- | point of the pluggable driver. `RefEnv` is a newtype (not a synonym) so the
-- | otherwise-cyclic reference `RefEnv → Operation → Ctl → RefEnv` is well-founded.
module Kernel.Env
  ( RefEnv(..)
  , refContext
  , refFalsy
  , withFalsy
  , constOperation
  , emptyEnv
  , register
  , registerAll
  , lookupOperation
  , pushFrame
  , pushHelpers
  , registerPartial
  , registerPartials
  , registerPartialsFalsy
  , lookupPartial
  , lookupPartialFalsy
  , refDepth
  , enterPartial
  , recursionBudget
  , refEngine
  , refEngineWith
  , liftEither
  ) where

import Prelude

import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Either (Either, either)
import Data.Foldable (foldl)
import Data.List (List(..), (:))
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error(..))
import FlatBars.Syntax (Ident, Template, splitBlockArgs)
import FlatBars.Value (Value)
import Kernel.Engine (Engine, Operation)
import Kernel.Value (FalsySet, handlebars, stringify)

-- | Lift a pure `Either Error` into the engine monad — the single place the
-- | `Left e -> throwError e` plumbing lives, shared by `refEngine` and helpers.
liftEither :: forall m a. MonadThrow Error m => Either Error a -> m a
liftEither = either throwError pure

newtype RefEnv m = RefEnv
  { context :: Value
  , helpers :: List (Map String (Operation m (RefEnv m)))
  , partials :: Map String Template -- named templates, for the `partial` helper
  , falsy :: FalsySet -- the active truthiness mode (per file/partial)
  -- each *external* partial's own truthiness mode (resolved from its own
  -- `@truthiness`); an entry here means "switch to this mode when entering that
  -- partial". Inline (same-file) partials have no entry — they inherit the
  -- file's mode lexically. See truthiness spec §5.
  , partialFalsy :: Map String FalsySet
  -- how many partials deep this environment is. `partialH` bumps it on entry and
  -- refuses to recurse past `recursionBudget`, so a cyclic partial raises a
  -- located `RecursionLimit` rather than overflowing the stack.
  , depth :: Int
  }

refContext :: forall m. RefEnv m -> Value
refContext (RefEnv e) = e.context

-- | The active falsy-set governing `if`/`unless`/`and`/`or`/`not` in this
-- | environment. Lexically scoped: a partial renders under its own env (and so
-- | its own mode); see the truthiness spec §4.2/§5.
refFalsy :: forall m. RefEnv m -> FalsySet
refFalsy (RefEnv e) = e.falsy

-- | Seed the active truthiness mode (the engine resolves it from the file's
-- | `@truthiness` directive; absent ⇒ the `handlebars` default already set by
-- | `emptyEnv`). Partials get their own via `registerPartials` + a re-seed.
withFalsy :: forall m. FalsySet -> RefEnv m -> RefEnv m
withFalsy fs (RefEnv e) = RefEnv (e { falsy = fs })

-- | A nullary helper that always returns a fixed value (scoped helpers like
-- | `index`, `first`, `this`).
constOperation :: forall m. Applicative m => Value -> Operation m (RefEnv m)
constOperation v = \_ _ -> pure v

-- | An environment with the given context and a single empty helper frame.
emptyEnv :: forall m. Value -> RefEnv m
emptyEnv ctx = RefEnv
  { context: ctx
  , helpers: Map.empty : Nil
  , partials: Map.empty
  , falsy: handlebars
  , partialFalsy: Map.empty
  , depth: 0
  }

-- | The maximum number of nested partials the engine renders before raising
-- | `RecursionLimit`. A cyclic partial (e.g. one that includes itself) would
-- | otherwise recurse forever and overflow the stack; this caps it.
recursionBudget :: Int
recursionBudget = 64

-- | The current partial nesting depth.
refDepth :: forall m. RefEnv m -> Int
refDepth (RefEnv e) = e.depth

-- | Enter one partial deeper: increment the depth counter. Threaded into the
-- | env a partial body renders under, so nested partials accumulate.
enterPartial :: forall m. RefEnv m -> RefEnv m
enterPartial (RefEnv e) = RefEnv (e { depth = e.depth + 1 })

-- | Register a helper into the innermost frame.
register :: forall m. String -> Operation m (RefEnv m) -> RefEnv m -> RefEnv m
register name h (RefEnv e) = RefEnv case e.helpers of
  Nil -> e { helpers = Map.singleton name h : Nil }
  top : rest -> e { helpers = Map.insert name h top : rest }

registerAll :: forall m. Array (Tuple String (Operation m (RefEnv m))) -> RefEnv m -> RefEnv m
registerAll pairs env = foldl (\acc (Tuple n h) -> register n h acc) env pairs

-- | Resolve a helper name, searching frames inner-to-outer.
lookupOperation :: forall m. String -> RefEnv m -> Maybe (Operation m (RefEnv m))
lookupOperation name (RefEnv e) = go e.helpers
  where
  go Nil = Nothing
  go (m : rest) = case Map.lookup name m of
    Just h -> Just h
    Nothing -> go rest

-- | Push a new frame and set a new context (what `this` returns in the body).
pushFrame :: forall m. Map String (Operation m (RefEnv m)) -> Value -> RefEnv m -> RefEnv m
pushFrame frame ctx (RefEnv e) = RefEnv (e { helpers = frame : e.helpers, context = ctx })

-- | Push a new helper frame without changing the context.
pushHelpers :: forall m. Map String (Operation m (RefEnv m)) -> RefEnv m -> RefEnv m
pushHelpers frame (RefEnv e) = RefEnv (e { helpers = frame : e.helpers })

-- | Register a named partial template (the body the `partial` helper renders).
registerPartial :: forall m. String -> Template -> RefEnv m -> RefEnv m
registerPartial name tmpl (RefEnv e) = RefEnv (e { partials = Map.insert name tmpl e.partials })

registerPartials :: forall m. Map String Template -> RefEnv m -> RefEnv m
registerPartials ps (RefEnv e) = RefEnv (e { partials = Map.union ps e.partials })

-- | Register the truthiness modes of *external* partials (each resolved from its
-- | own `@truthiness`), so the `partial` helper switches into them. Partials
-- | without an entry inherit the current (file) mode.
registerPartialsFalsy :: forall m. Map String FalsySet -> RefEnv m -> RefEnv m
registerPartialsFalsy fs (RefEnv e) = RefEnv (e { partialFalsy = Map.union fs e.partialFalsy })

-- | Look up a registered partial by name.
lookupPartial :: forall m. String -> RefEnv m -> Maybe Template
lookupPartial name (RefEnv e) = Map.lookup name e.partials

-- | A partial's own truthiness mode, if it declared one (external partials only).
lookupPartialFalsy :: forall m. String -> RefEnv m -> Maybe FalsySet
lookupPartialFalsy name (RefEnv e) = Map.lookup name e.partialFalsy

-- | The reference `Engine`: resolve from the frame stack (throwing
-- | `UnknownHelper`), stringify via `Value.stringify`.
refEngine :: forall m. MonadThrow Error m => RefEnv m -> Engine m (RefEnv m)
refEngine = refEngineWith (\_ name -> throwError (UnknownHelper name))

-- | Like `refEngine`, but with a pluggable *missing-helper* policy: `onMissing`
-- | is consulted when no frame defines `name`. The strict default (`refEngine`)
-- | throws `UnknownHelper`; FullBars supplies a `blockHelperMissing` fallback
-- | (Handlebars-style implicit sections) so a bare `{{#x}}` over data iterates /
-- | renders rather than erroring. RawBars keeps the strict default — the
-- | divergence stays a per-dialect choice, not a core change.
refEngineWith
  :: forall m
   . MonadThrow Error m
  => (RefEnv m -> Ident -> m (Operation m (RefEnv m)))
  -> RefEnv m
  -> Engine m (RefEnv m)
refEngineWith onMissing initial =
  { initial
  , resolve: \env name -> case lookupOperation name env of
      Just h -> pure h
      Nothing -> onMissing env name
  , stringify: \v -> liftEither (stringify v)
  -- The marker-aware split (ADR-020 Phase 3). Recognises FullBars' `@hash`/`@param`
  -- block markers; a no-op for RawBars/MaxBars, which emit none — so this is safe
  -- as the shared default. `splitBlockArgs` demarkers the positional list, so
  -- built-in helpers receive exactly the values they did before.
  , blockArgs: splitBlockArgs
  }
