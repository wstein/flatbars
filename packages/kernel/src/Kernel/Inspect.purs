-- | Context inspection (ADR-035): capture the render-context at a source span, for
-- | the playground's Context Inspector. Given a `target` (an emit run's source
-- | provenance — `{ file, start, end }`), render and snapshot the environment at
-- | every execution of the matching emit — one per loop iteration — reporting
-- | `this`, the scoped vars (`parent`/`root`/`index`/…), and the block-param
-- | `locals`. Built on the same instrumented render as the source map: a no-op
-- | `recordEmit` is swapped for one that matches the span and snapshots.
module Kernel.Inspect
  ( Target
  , Snapshot
  , inspectResolvedLenient
  , inspectResolvedStrict
  ) where

import Prelude

import Control.Monad.Writer.Class (tell)
import Control.Monad.Writer.Trans (WriterT, runWriterT)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Foldable (elem)
import Data.Map as Map
import Data.Maybe (Maybe(..), maybe)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error)
import FlatBars.Span (Span)
import FlatBars.Syntax (Template)
import FlatBars.Value (Value(..))
import Kernel.Engine (Ctl, Engine, runTemplate)
import Kernel.Env (RefEnv, innermostFrame, lookupOperation, refContext, refCurrentFile, refEngine, refEngineWith)
import Kernel.Prelude (lenientResolve)
import Kernel.Render (preludeEnv)

-- | An output run's source provenance, as the host clicked it.
type Target = { file :: String, start :: Int, end :: Int }

-- | A render-context snapshot. Scoped vars absent from the scope are `Nothing`;
-- | `locals` are the block-param bindings (`as |a b|`).
type Snapshot =
  { this :: Value
  , parent :: Maybe Value
  , root :: Maybe Value
  , index :: Maybe Value
  , index1 :: Maybe Value
  , key :: Maybe Value
  , first :: Maybe Value
  , last :: Maybe Value
  , locals :: Array (Tuple String Value)
  }

-- | The inspect monad: a pure host with a writer of snapshots.
type Insp = WriterT (Array Snapshot) (Either Error)

-- | Render `nodes`, capturing a snapshot at every emit whose tag span + file match
-- | `target` (in execution order; empty when the span is never reached). The lenient
-- | variant is for FullBars / MaxBars; the strict one for RawBars.
inspectResolvedLenient
  :: (RefEnv Insp -> RefEnv Insp) -> Target -> Template -> Value -> Either Error (Array Snapshot)
inspectResolvedLenient = inspectUsing (refEngineWith lenientResolve)

inspectResolvedStrict
  :: (RefEnv Insp -> RefEnv Insp) -> Target -> Template -> Value -> Either Error (Array Snapshot)
inspectResolvedStrict = inspectUsing refEngine

inspectUsing
  :: (RefEnv Insp -> Engine Insp (RefEnv Insp))
  -> (RefEnv Insp -> RefEnv Insp)
  -> Target
  -> Template
  -> Value
  -> Either Error (Array Snapshot)
inspectUsing toEngine setup target nodes dat =
  let
    engine = (toEngine (setup (preludeEnv dat))) { recordEmit = inspectEmit target }
  in
    case runWriterT (runTemplate engine nodes) of
      Left e -> Left e
      Right (Tuple _ snaps) -> Right snaps

inspectEmit :: Target -> RefEnv Insp -> Span -> Insp String -> Insp String
inspectEmit target env span produce = do
  s <- produce
  when (span.start == target.start && span.end == target.end && refCurrentFile env == target.file)
    do
      snap <- snapshot env
      tell [ snap ]
  pure s

-- | Build a context snapshot from the env at a matching emit.
snapshot :: RefEnv Insp -> Insp Snapshot
snapshot env = do
  parent <- resolveOpt "parent" env
  root <- resolveOpt "root" env
  index <- resolveOpt "index0" env
  index1 <- resolveOpt "index1" env
  key <- resolveOpt "key" env
  first <- resolveOpt "first" env
  last <- resolveOpt "last" env
  locals <- resolveLocals env
  pure { this: refContext env, parent, root, index, index1, key, first, last, locals }

-- | Resolve a scoped helper to its value (the loop/with bindings are nullary
-- | constant ops), or `Nothing` when not in scope.
resolveOpt :: String -> RefEnv Insp -> Insp (Maybe Value)
resolveOpt name env = case lookupOperation name env of
  Nothing -> pure Nothing
  Just op -> Just <$> op (dummyCtl env) []

-- | The block-param locals: the innermost frame's keys minus the known scoped
-- | vars. Only a block frame (marked by `@parentchain`) carries locals; the bare
-- | prelude frame yields none.
resolveLocals :: RefEnv Insp -> Insp (Array (Tuple String Value))
resolveLocals env =
  let
    frame = innermostFrame env
  in
    if not (Map.member "@parentchain" frame) then pure []
    else
      traverse (\name -> Tuple name <$> resolveValue name env)
        (Array.filter (\k -> not (elem k knownScoped)) (Array.fromFoldable (Map.keys frame)))

resolveValue :: String -> RefEnv Insp -> Insp Value
resolveValue name env = maybe (pure VNull) (\op -> op (dummyCtl env) []) (lookupOperation name env)

-- | The names the engine's loop/with frames bind, excluded from `locals`.
knownScoped :: Array String
knownScoped =
  [ "this"
  , "index"
  , "index0"
  , "index1"
  , "rindex0"
  , "rindex1"
  , "length"
  , "key"
  , "first"
  , "last"
  , "parent"
  , "root"
  , "loop"
  , "@parentchain"
  ]

-- | A minimal control handle for running a nullary constant operation: the scoped
-- | bindings ignore every field but `env` (which `this` reads).
dummyCtl :: RefEnv Insp -> Ctl Insp (RefEnv Insp)
dummyCtl env =
  { env
  , children: []
  , span: { start: 0, end: 0 }
  , render: \_ _ -> pure ""
  , eval: \_ _ -> pure VNull
  , clause: \_ -> { before: [], body: Nothing }
  , hash: Nothing
  , blockParams: []
  , loopLabel: Nothing
  }
