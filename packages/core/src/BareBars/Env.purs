-- | The *reference* engine's environment and `Engine` instance.
-- |
-- | The driver (`BareBars.Engine`) is environment-agnostic; this module is one
-- | concrete choice: a stack of helper frames plus the current context. A
-- | different engine could pick an entirely different `env` type — that is the
-- | point of the pluggable driver. `RefEnv` is a newtype (not a synonym) so the
-- | otherwise-cyclic reference `RefEnv → Helper → Ctl → RefEnv` is well-founded.
module BareBars.Env
  ( RefEnv(..)
  , refContext
  , constHelper
  , emptyEnv
  , register
  , registerAll
  , lookupHelper
  , pushFrame
  , pushHelpers
  , refEngine
  ) where

import Prelude

import BareBars.Engine (Engine, Helper)
import BareBars.Error (Error(..))
import BareBars.Value (Value, stringify)
import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Either (Either(..))
import Data.Foldable (foldl)
import Data.List (List(..), (:))
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))

newtype RefEnv m = RefEnv
  { context :: Value
  , helpers :: List (Map String (Helper m (RefEnv m)))
  }

refContext :: forall m. RefEnv m -> Value
refContext (RefEnv e) = e.context

-- | A nullary helper that always returns a fixed value (scoped helpers like
-- | `index`, `first`, `this`).
constHelper :: forall m. Applicative m => Value -> Helper m (RefEnv m)
constHelper v = \_ _ -> pure v

-- | An environment with the given context and a single empty helper frame.
emptyEnv :: forall m. Value -> RefEnv m
emptyEnv ctx = RefEnv { context: ctx, helpers: Map.empty : Nil }

-- | Register a helper into the innermost frame.
register :: forall m. String -> Helper m (RefEnv m) -> RefEnv m -> RefEnv m
register name h (RefEnv e) = RefEnv case e.helpers of
  Nil -> e { helpers = Map.singleton name h : Nil }
  top : rest -> e { helpers = Map.insert name h top : rest }

registerAll :: forall m. Array (Tuple String (Helper m (RefEnv m))) -> RefEnv m -> RefEnv m
registerAll pairs env = foldl (\acc (Tuple n h) -> register n h acc) env pairs

-- | Resolve a helper name, searching frames inner-to-outer.
lookupHelper :: forall m. String -> RefEnv m -> Maybe (Helper m (RefEnv m))
lookupHelper name (RefEnv e) = go e.helpers
  where
  go Nil = Nothing
  go (m : rest) = case Map.lookup name m of
    Just h -> Just h
    Nothing -> go rest

-- | Push a new frame and set a new context (what `this` returns in the body).
pushFrame :: forall m. Map String (Helper m (RefEnv m)) -> Value -> RefEnv m -> RefEnv m
pushFrame frame ctx (RefEnv e) = RefEnv (e { helpers = frame : e.helpers, context = ctx })

-- | Push a new helper frame without changing the context.
pushHelpers :: forall m. Map String (Helper m (RefEnv m)) -> RefEnv m -> RefEnv m
pushHelpers frame (RefEnv e) = RefEnv (e { helpers = frame : e.helpers })

-- | The reference `Engine`: resolve from the frame stack (throwing
-- | `UnknownHelper`), stringify via `Value.stringify`.
refEngine :: forall m. MonadThrow Error m => RefEnv m -> Engine m (RefEnv m)
refEngine initial =
  { initial
  , resolve: \env name -> case lookupHelper name env of
      Just h -> pure h
      Nothing -> throwError (UnknownHelper name)
  , stringify: \v -> case stringify v of
      Left e -> throwError e
      Right s -> pure s
  }
