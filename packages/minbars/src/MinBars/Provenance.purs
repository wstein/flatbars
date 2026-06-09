-- | Source maps for MinBars (Mustache), the `MinEnv` twin of `Kernel.Provenance`
-- | (ADR-035). A *mapped* render returns, alongside the output, the `Segment`s
-- | tying contiguous output runs back to the template tags that produced them — the
-- | data the Lab's provenance UI links on, and the source spans the Context
-- | Inspector (`MinBars.Inspect`) targets.
-- |
-- | The recorders are MinBars-specific only in their env: MinBars has no
-- | per-file tracking in `MinEnv`, so every run is tagged `"main"`, and a span is
-- | claimed only at `minDepth == 0` (a top-level emit) — an emit inside a partial
-- | tiles the output but claims no location in the entry template, exactly as the
-- | RefEnv provenance does for `depth > 0`. The tiling+verification (`assemble`,
-- | "correct-or-absent") is reused from `Kernel.Provenance` unchanged, so a
-- | transforming render still yields `[]` rather than a lie.
module MinBars.Provenance
  ( renderMinMapped
  , renderMinMappedWith
  ) where

import Prelude

import Control.Monad.Writer.Class (listen, tell)
import Control.Monad.Writer.Trans (WriterT, runWriterT)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error, ParseError, renderParseErrorAt)
import FlatBars.Span (Span)
import FlatBars.Syntax (Template)
import FlatBars.Value (Value)
import Kernel.Engine (runTemplate)
import Kernel.Provenance (RawSeg, Segment, assemble)
import Kernel.Render (formatError)
import Kernel.Value (mustache)
import MinBars (parseMin)
import MinBars.Context (MinEnv, minDepth, seedEnv)
import MinBars.Prelude (minEngine)
import MinBars.Surface (desugar)

-- | The mapped render monad: a pure `Either Error` host with a writer of leaves,
-- | matching `Kernel.Provenance.Prov`.
type Prov = WriterT (Array RawSeg) (Either Error)

-- | Render a MinBars template, returning the output and its source map. Mirrors
-- | `renderMin` (the spec `mustache` rule), but through the instrumented engine.
renderMinMapped :: String -> Value -> Either String { output :: String, segments :: Array Segment }
renderMinMapped = renderMinMappedWith []

-- | `renderMinMapped` with named partials (each parsed + desugared like the render
-- | path, so an emit inside a partial body still tiles the output).
renderMinMappedWith
  :: Array (Tuple String String)
  -> String
  -> Value
  -> Either String { output :: String, segments :: Array Segment }
renderMinMappedWith partialSrcs src dat = case traverse compilePartial partialSrcs of
  Left e -> Left e
  Right ps -> case parseMin src of
    Left pe -> Left (renderParseErrorAt src pe)
    Right { nodes } ->
      let
        engine = (minEngine (seedEnv mustache dat (Map.fromFoldable ps)))
          { recordText = recordTextProv, recordEmit = recordEmitProv }
      in
        case runWriterT (runTemplate engine (desugar nodes)) of
          Left e -> Left (formatError src e)
          Right (Tuple output raws) -> Right { output, segments: assemble output raws }
  where
  compilePartial :: Tuple String String -> Either String (Tuple String Template)
  compilePartial (Tuple name s) = case parseMin s of
    Left (pe :: ParseError) -> Left (renderParseErrorAt s pe)
    Right { nodes } -> Right (Tuple name (desugar nodes))

-- | Log a literal-text run (no source span), tagged `"main"`, skipping empty runs.
recordTextProv :: MinEnv -> String -> Prov Unit
recordTextProv _ text
  | text == "" = pure unit
  | otherwise = tell [ { isEmit: false, file: "main", span: Nothing, text } ]

-- | Run an emit and log ONE run for it — unless it already logged sub-runs (a
-- | section iterating, or a partial expanding its body), in which case those cover
-- | the output. A span is claimed only at the top level (`minDepth == 0`); a deeper
-- | emit tiles but does not claim a location in the entry template.
recordEmitProv :: MinEnv -> Span -> Prov String -> Prov String
recordEmitProv env span produce = do
  Tuple s sub <- listen produce
  when (s /= "" && Array.null sub) $
    tell
      [ { isEmit: true
        , file: "main"
        , span: if minDepth env == 0 then Just span else Nothing
        , text: s
        }
      ]
  pure s
