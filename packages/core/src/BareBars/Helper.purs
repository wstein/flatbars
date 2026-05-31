-- | Arity-checked argument combinators for building helpers.
-- |
-- | This is engine-agnostic plumbing: it carries *no* value policy (truthiness,
-- | escaping, stringification) and *no* registry shape — those belong to an
-- | engine. What it removes is the boilerplate every value helper would
-- | otherwise repeat: destructure `Array Value`, and on the wrong count throw a
-- | consistent `ArityError`.
-- |
-- | Each combinator pairs a runtime `Helper` with the `Arity` it enforces, as an
-- | `ArgSpec`. Because the arity lives in one place, an engine can project *both*
-- | the runtime helper and a validation `Schema` entry from the same value — the
-- | runtime guard and the static check can never drift. Ranged arities reuse
-- | `BareBars.Walk.arityOk`, the very predicate `validate` uses.
-- |
-- | Helpers that need the control handle (block helpers, `this`) or bespoke
-- | argument handling (`lookup`, `dict`) are written directly against `Helper`;
-- | these combinators are for the common value-helper shapes.
module BareBars.Helper
  ( ArgSpec
  , nullary
  , unary
  , binary
  , variadic
  , atLeast
  ) where

import Prelude

import BareBars.Engine (Helper)
import BareBars.Error (Error(..))
import BareBars.Value (Value)
import BareBars.Walk (Arity(..), arityOk, arityText)
import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Array as Array

-- | A runtime helper paired with the arity it enforces. An engine reads `.run`
-- | for execution and `.arity` for its validation schema — one source of truth.
type ArgSpec m env = { arity :: Arity, run :: Helper m env }

-- | Throw the standard arity error for `name`, given the expected arity and the
-- | arguments actually received.
wrongArity :: forall m a. MonadThrow Error m => String -> Arity -> Array Value -> m a
wrongArity name arity args =
  throwError
    ( ArityError
        ( name <> ": expected " <> arityText arity <> " argument(s), got "
            <> show (Array.length args)
        )
    )

-- | A nullary helper: ignores the control handle and arguments.
nullary :: forall m env. MonadThrow Error m => m Value -> String -> ArgSpec m env
nullary v name =
  { arity: Exactly 0
  , run: \_ args -> case args of
      [] -> v
      _ -> wrongArity name (Exactly 0) args
  }

-- | A one-argument value helper.
unary :: forall m env. MonadThrow Error m => (Value -> m Value) -> String -> ArgSpec m env
unary f name =
  { arity: Exactly 1
  , run: \_ args -> case args of
      [ a ] -> f a
      _ -> wrongArity name (Exactly 1) args
  }

-- | A two-argument value helper.
binary
  :: forall m env. MonadThrow Error m => (Value -> Value -> m Value) -> String -> ArgSpec m env
binary f name =
  { arity: Exactly 2
  , run: \_ args -> case args of
      [ a, b ] -> f a b
      _ -> wrongArity name (Exactly 2) args
  }

-- | A variadic helper accepting any number of arguments (no arity check).
variadic :: forall m env. (Array Value -> m Value) -> String -> ArgSpec m env
variadic f _ = { arity: AnyArity, run: \_ args -> f args }

-- | A variadic helper requiring at least `k` arguments (reuses `arityOk`).
atLeast
  :: forall m env. MonadThrow Error m => Int -> (Array Value -> m Value) -> String -> ArgSpec m env
atLeast k f name =
  { arity: AtLeast k
  , run: \_ args ->
      if arityOk (AtLeast k) (Array.length args) then f args
      else wrongArity name (AtLeast k) args
  }
