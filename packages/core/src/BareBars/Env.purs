-- | The helper environment. See `docs/modules/ROOT/pages/evaluation.adoc` §3.3.
-- |
-- | `helpers` is a stack of frames; name resolution searches inner-to-outer.
-- | A block helper pushes a frame for its body and pops it afterwards — this is
-- | the whole of "scope". `context` is the current data, reached only via the
-- | `this` helper.
-- |
-- | v1 fixes the result monad to `Either Error` (pure). `Helper` is a newtype so
-- | that the otherwise-cyclic synonyms (`Env` mentions `Helper`, `Helper`
-- | mentions `Env`/`HelperCtx`) are well-founded.
module BareBars.Env
  ( Helper(..)
  , HelperCtx
  , Render
  , Env
  , runHelper
  , constHelper
  , emptyEnv
  , register
  , registerAll
  , lookupHelper
  , pushFrame
  , pushHelpers
  ) where

import BareBars.Error (Error)
import BareBars.Syntax (Template)
import BareBars.Value (Value)
import Data.Either (Either(..))
import Data.Foldable (foldl)
import Data.List (List(..), (:))
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))

-- | BareBars drives the whole walk (inversion of control): it resolves and
-- | invokes helpers, and hands each one a `HelperCtx` — a *control handle*
-- | whose every field calls back into BareBars. A helper never walks the tree
-- | itself; it asks BareBars to.
newtype Helper = Helper (HelperCtx -> Array Value -> Either Error Value)

-- | Render any template against any environment — the callback BareBars exposes
-- | to helpers so they can render captured bodies and clauses on their terms.
type Render = Env -> Template -> Either Error String

-- | The control handle a helper receives. `env` is the current environment;
-- | `body` is the captured skeleton subtree (`[]` for an inline application);
-- | `render` is the inversion-of-control callback. A block helper interprets
-- | `body` however it likes — including reaching into *nested clause blocks*.
type HelperCtx =
  { env :: Env
  , body :: Template
  , render :: Render
  }

type Env =
  { helpers :: List (Map String Helper)
  , context :: Value
  }

runHelper :: Helper -> HelperCtx -> Array Value -> Either Error Value
runHelper (Helper f) = f

-- | A nullary helper that always returns a fixed value (the common case for
-- | scoped helpers like `index`, `first`, `this`).
constHelper :: Value -> Helper
constHelper v = Helper \_ _ -> Right v

-- | An environment with the given context and a single empty helper frame.
emptyEnv :: Value -> Env
emptyEnv ctx = { helpers: Map.empty : Nil, context: ctx }

-- | Register a helper into the innermost frame.
register :: String -> Helper -> Env -> Env
register name h env = case env.helpers of
  Nil -> env { helpers = Map.singleton name h : Nil }
  top : rest -> env { helpers = Map.insert name h top : rest }

registerAll :: Array (Tuple String Helper) -> Env -> Env
registerAll pairs env = foldl (\e (Tuple n h) -> register n h e) env pairs

-- | Resolve a helper name, searching frames inner-to-outer.
lookupHelper :: String -> Env -> Maybe Helper
lookupHelper name env = go env.helpers
  where
  go Nil = Nothing
  go (m : rest) = case Map.lookup name m of
    Just h -> Just h
    Nothing -> go rest

-- | Push a new frame and set a new context (what `this` returns in the body).
pushFrame :: Map String Helper -> Value -> Env -> Env
pushFrame frame ctx env = env { helpers = frame : env.helpers, context = ctx }

-- | Push a new helper frame without changing the context.
pushHelpers :: Map String Helper -> Env -> Env
pushHelpers frame env = env { helpers = frame : env.helpers }
