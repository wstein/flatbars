-- | Source maps (ADR-035): a *mapped* render that, alongside the output string,
-- | returns `Segment`s tying contiguous runs of the output back to the template
-- | tags that produced them — the data the playground's provenance UI links on.
-- |
-- | The interpret driver (`Kernel.Engine`) assembles output functionally, and a
-- | block helper may transform its body's output (e.g. a user `loud` helper), so
-- | naive leaf-logging can desync from the actual bytes. This module is therefore
-- | *correct-or-absent*: it records a leaf per emit/text run, then verifies the
-- | recorded runs reconstruct the output exactly; if they do not (a transforming
-- | helper), it returns `[]` and the capability gates off rather than lying.
-- |
-- | Offsets are JS string indices (UTF-16 code units, via `CodeUnits.length`), so
-- | the browser consumes them with no byte↔char conversion. Emits inside a partial
-- | (`depth > 0`) record without a source span — they tile the output but do not
-- | claim a location in the entry template (full multi-file linking is a follow-up).
module Kernel.Provenance
  ( Segment
  , runResolvedMapped
  , runResolvedLenientMapped
  ) where

import Prelude

import Control.Monad.Writer.Class (listen, tell)
import Control.Monad.Writer.Trans (WriterT, runWriterT)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.String.CodeUnits as CodeUnits
import Data.String.Common (joinWith)
import Data.Traversable (mapAccumL)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error)
import FlatBars.Span (Span)
import FlatBars.Syntax (Template)
import FlatBars.Value (Value)
import Kernel.Engine (Engine, runTemplate)
import Kernel.Env (RefEnv, refDepth, refEngine, refEngineWith)
import Kernel.Prelude (lenientResolve)
import Kernel.Render (preludeEnv)

-- | A contiguous run of output tied to its source. `out`/`len` are JS string
-- | indices (UTF-16 code units) into the output; `start`/`end` are the tag's span
-- | in the entry template, present on `emit` runs that originate there.
type Segment =
  { out :: Int
  , len :: Int
  , kind :: String -- "text" | "emit"
  , start :: Maybe Int
  , end :: Maybe Int
  }

-- | A recorded leaf, before offsets are computed.
type RawSeg = { isEmit :: Boolean, span :: Maybe Span, text :: String }

-- | The mapped render monad: a pure `Either Error` host with a writer of leaves.
type Prov = WriterT (Array RawSeg) (Either Error)

-- | Render `nodes` with the strict reference engine, returning the output plus its
-- | source map (RawBars).
runResolvedMapped
  :: (RefEnv Prov -> RefEnv Prov)
  -> Template
  -> Value
  -> Either Error { output :: String, segments :: Array Segment }
runResolvedMapped = runMappedUsing refEngine

-- | Like `runResolvedMapped`, with FullBars' lenient resolve (FullBars / MaxBars).
runResolvedLenientMapped
  :: (RefEnv Prov -> RefEnv Prov)
  -> Template
  -> Value
  -> Either Error { output :: String, segments :: Array Segment }
runResolvedLenientMapped = runMappedUsing (refEngineWith lenientResolve)

runMappedUsing
  :: (RefEnv Prov -> Engine Prov (RefEnv Prov))
  -> (RefEnv Prov -> RefEnv Prov)
  -> Template
  -> Value
  -> Either Error { output :: String, segments :: Array Segment }
runMappedUsing toEngine setup nodes dat =
  let
    engine = (toEngine (setup (preludeEnv dat)))
      { recordText = recordTextProv, recordEmit = recordEmitProv }
  in
    case runWriterT (runTemplate engine nodes) of
      Left e -> Left e
      Right (Tuple output raws) -> Right { output, segments: assemble output raws }

-- | Log a literal-text run (no source span), skipping empty runs.
recordTextProv :: RefEnv Prov -> String -> Prov Unit
recordTextProv _ text
  | text == "" = pure unit
  | otherwise = tell [ { isEmit: false, span: Nothing, text } ]

-- | Run an expression render and log ONE emit run for it — unless it already
-- | logged sub-runs (a partial expanding its body), in which case those cover the
-- | output and no outer run is added. An emit produced inside a partial (`depth >
-- | 0`) records no source span: it tiles the output but does not claim a location
-- | in the entry template.
recordEmitProv :: RefEnv Prov -> Span -> Prov String -> Prov String
recordEmitProv env span produce = do
  Tuple s sub <- listen produce
  when (s /= "" && Array.null sub) $
    tell [ { isEmit: true, span: if refDepth env > 0 then Nothing else Just span, text: s } ]
  pure s

-- | Turn ordered leaves into tiling segments — but only if they reconstruct the
-- | output exactly. Any mismatch (a transforming block helper) yields `[]`.
assemble :: String -> Array RawSeg -> Array Segment
assemble output raws
  | joinWith "" (map _.text raws) /= output = []
  | otherwise = (mapAccumL step 0 raws).value
      where
      step at r =
        { accum: at + CodeUnits.length r.text
        , value:
            { out: at
            , len: CodeUnits.length r.text
            , kind: if r.isEmit then "emit" else "text"
            , start: map _.start r.span
            , end: map _.end r.span
            }
        }
