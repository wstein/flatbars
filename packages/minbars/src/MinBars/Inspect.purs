-- | Context inspection for MinBars (Mustache), the `MinEnv` twin of
-- | `Kernel.Inspect` (ADR-035). Given a `target` (an output run's source span, from
-- | `MinBars.Provenance`), render and snapshot the context stack at every execution
-- | of the matching top-level emit — one per section iteration.
-- |
-- | A MinBars snapshot is narrower than the RefEnv one by design: Mustache is
-- | logic-less, so a section pushes a context frame but binds no loop variables —
-- | there is no `@index`/`@key`/`@first`/`@last` and no block-param `locals`. So a
-- | snapshot reports only the context chain: `this` (the top frame, what `{{.}}`
-- | reads), `parent` (the frame a missed name falls back to), and `root` (the
-- | original data at the bottom of the stack). The unused `Snapshot` fields are
-- | `Nothing`/`[]`, so the Lab's snapshot card renders both engines uniformly.
module MinBars.Inspect
  ( inspectMin
  , inspectMinWith
  , inspectMinCompat
  , inspectMinCompatWith
  ) where

import Prelude

import Control.Monad.Writer.Class (tell)
import Control.Monad.Writer.Trans (WriterT, runWriterT)
import Data.Either (Either(..))
import Data.List as List
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error, renderParseErrorAt)
import FlatBars.Span (Span)
import FlatBars.Value (Value(..))
import Kernel.Engine (runTemplate)
import Kernel.Inspect (Snapshot, Target)
import Kernel.Render (formatError)
import Kernel.Value (Truthy, mustache, mustacheJs)
import MinBars (parseMin)
import MinBars.Context (MinEnv, minDepth, minStack, seedEnv)
import MinBars.Prelude (minEngine)
import MinBars.Surface (desugar)

-- | The inspect monad: a pure host with a writer of snapshots, matching
-- | `Kernel.Inspect.Insp`.
type Insp = WriterT (Array Snapshot) (Either Error)

-- | Render `src`, capturing a snapshot at every top-level emit whose span matches
-- | `target` (in execution order — one per section iteration; empty when the span
-- | is never reached).
inspectMin :: Target -> String -> Value -> Either String (Array Snapshot)
inspectMin = inspectMinWith []

-- | `inspectMin` with named partials (parsed + desugared like the render path).
inspectMinWith
  :: Array (Tuple String String) -> Target -> String -> Value -> Either String (Array Snapshot)
inspectMinWith = runInspect mustache

-- | `inspectMin` under the `mustache.js`-compat rule — paired with
-- | `renderMinMappedCompat`. The inspector must seed the SAME rule the source map
-- | did, or the sections it re-executes (and the snapshots it captures) diverge from
-- | the spans the host clicked.
inspectMinCompat :: Target -> String -> Value -> Either String (Array Snapshot)
inspectMinCompat = inspectMinCompatWith []

inspectMinCompatWith
  :: Array (Tuple String String) -> Target -> String -> Value -> Either String (Array Snapshot)
inspectMinCompatWith = runInspect mustacheJs

-- | The shared inspect, seeding the given truthiness `rule`.
runInspect
  :: Truthy
  -> Array (Tuple String String)
  -> Target
  -> String
  -> Value
  -> Either String (Array Snapshot)
runInspect rule partialSrcs target src dat = case traverse compilePartial partialSrcs of
  Left e -> Left e
  Right ps -> case parseMin src of
    Left pe -> Left (renderParseErrorAt src pe)
    Right { nodes } ->
      let
        engine = (minEngine (seedEnv rule dat (Map.fromFoldable ps)))
          { recordEmit = inspectEmit target }
      in
        case runWriterT (runTemplate engine (desugar nodes)) of
          Left e -> Left (formatError src e)
          Right (Tuple _ snaps) -> Right snaps
  where
  compilePartial (Tuple name s) = case parseMin s of
    Left pe -> Left (renderParseErrorAt s pe)
    Right { nodes } -> Right (Tuple name (desugar nodes))

-- | Snapshot at a matching top-level emit. The span is matched only at
-- | `minDepth == 0` (the entry template, where `MinBars.Provenance` claims a span);
-- | a section iterating at the top level re-runs the emit per element, so this
-- | yields one snapshot per iteration.
inspectEmit :: Target -> MinEnv -> Span -> Insp String -> Insp String
inspectEmit target env span produce = do
  s <- produce
  when
    ( span.start == target.start && span.end == target.end && minDepth env == 0 && target.file ==
        "main"
    )
    (tell [ snapshot env ])
  pure s

-- | Build a MinBars snapshot from the context stack: `this` = the top frame,
-- | `parent` = the next frame down, `root` = the bottom frame. The loop-variable
-- | and block-param fields are absent (Mustache binds none).
snapshot :: MinEnv -> Snapshot
snapshot env =
  let
    stack = minStack env
  in
    { this: fromMaybe VNull (List.head stack)
    , parent: List.index stack 1
    , root: List.last stack
    , index: Nothing
    , index1: Nothing
    , key: Nothing
    , first: Nothing
    , last: Nothing
    , locals: []
    }
