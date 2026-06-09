-- | Truthiness portability analysis for MinBars (Mustache), the narrower sibling
-- | of `FullBars.analyseSurface` (ADR-022). The machinery is identical — render
-- | the template in a `WriterT` that records, at every condition, the value tested
-- | and the named rules whose verdict differs — but the engine sits at a different
-- | point on the truthiness axis: MinBars renders on the language-agnostic
-- | `mustache-spec` rule (`0`/`""`/`{}` truthy, as Ruby/Python Mustache), whereas
-- | `mustache.js` follows the `handlebars` rule (`0`/`""` falsy). So the one
-- | portability question this surfaces is "would `mustache.js` branch the other
-- | way?", and a `flips under: handlebars` finding answers it.
-- |
-- | MinBars has only two branching operations — `section` (`{{#x}}`) and
-- | `inverted` (`{{^x}}`) — and only their *scalar* form is a truthiness decision
-- | (a section over an array is iteration, never the `0`/`""` flip), so the engine
-- | wrapper records a decision exactly there. The report/findings/jsonata
-- | formatting is the shared, engine-agnostic `Kernel.Analyse` code over the
-- | resulting `Decision` trace.
module MinBars.Analyse
  ( analyseMin
  , analyseMinWith
  , minbarsLabels
  ) where

import Prelude

import Control.Monad.Writer.Class (tell)
import Control.Monad.Writer.Trans (WriterT, runWriterT)
import Data.Either (Either(..))
import Data.Map (Map)
import Data.Map as Map
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error, renderParseErrorAt)
import FlatBars.Syntax (Template)
import FlatBars.Value (Value(..))
import Kernel.Analyse (Decision, Finding, ReportLabels, allFindings, anyPath, divergence, evaluatedCount, jsonataScaffold, reportMarkdownWith)
import Kernel.Engine (Engine, Operation, runTemplate)
import Kernel.Render (formatError)
import Kernel.Value (mustache)
import MinBars (parseMin)
import MinBars.Context (MinEnv, minTruthy, seedEnv)
import MinBars.Prelude (minEngine)
import MinBars.Surface (desugar)

-- | The decision-accumulating writer over the engine's `Either Error` (no effects;
-- | the trace is the writer output), mirroring `Kernel.Analyse.AnalyseM`.
type AnalyseM = WriterT (Array Decision) (Either Error)

-- | The MinBars report prose for `Kernel.Analyse.reportMarkdownWith`: the engine
-- | renders on `mustache-spec`, so a `flips under` entry names `mustache.js`'
-- | divergent `handlebars` reading rather than the other way round.
minbarsLabels :: ReportLabels
minbarsLabels =
  { engineRule: "mustache-spec"
  , legend:
      "_MinBars renders on the language-agnostic `mustache-spec` rule"
        <> " (`0`/`\"\"`/`{}` truthy, as Ruby/Python Mustache). `mustache.js` instead"
        <> " follows the `handlebars` rule (`0`/`\"\"` falsy), so a finding's"
        <> " `flips under: handlebars` is exactly where `mustache.js` branches the"
        <> " other way._"
  }

-- | The MinBars engine with `section`/`inverted` wrapped to record a truthiness
-- | `Decision` at each scalar test. Built from the real `minEngine` so the render
-- | semantics are byte-identical to a normal MinBars render — the wrapper only
-- | observes, then delegates.
analysedEngine :: MinEnv -> Engine AnalyseM MinEnv
analysedEngine seeded = base
  { resolve = wrap base.resolve, resolveStrict = wrap base.resolveStrict }
  where
  base = minEngine seeded

  wrap
    :: (MinEnv -> String -> AnalyseM (Operation AnalyseM MinEnv))
    -> MinEnv
    -> String
    -> AnalyseM (Operation AnalyseM MinEnv)
  wrap resolve env name = do
    op <- resolve env name
    pure (if name == "section" || name == "inverted" then observe name op else op)

  observe :: String -> Operation AnalyseM MinEnv -> Operation AnalyseM MinEnv
  observe name op ctl args = do
    case args of
      [ v ] -> record name ctl.env ctl.span v
      _ -> pure unit
    op ctl args

  -- A section/inverted over an array is iteration (or list-emptiness), never the
  -- `0`/`""`/`{}` scalar flip, so only a non-array value is a truthiness decision.
  record name env span v = case v of
    VArray _ -> pure unit
    _ ->
      let
        here = minTruthy env v
      in
        tell
          [ { kind: "cond"
            , span
            , op: name
            , value: v
            , truthyHere: here
            , diverges: divergence v here
            }
          ]

-- | Render `nodes` under the analysed engine, returning the output and the full
-- | decision trace. Seeds the spec (`mustache`) rule — the MinBars default — so
-- | `here` in every decision is MinBars' own verdict.
runAnalysisMin
  :: Map String Template
  -> Value
  -> Template
  -> Either Error { output :: String, decisions :: Array Decision }
runAnalysisMin partials dat nodes =
  runWriterT (runTemplate (analysedEngine (seedEnv mustache dat partials)) nodes) <#>
    \(Tuple output decisions) -> { output, decisions }

-- | Analyse a MinBars template against sample data — the same `{ output, report,
-- | jsonata, findings, evaluated }` shape `FullBars.analyseSurface` returns, so the
-- | JS facade and Lab marshal both identically.
analyseMin
  :: String
  -> Value
  -> Either String
       { output :: String
       , report :: String
       , jsonata :: String
       , findings :: Array Finding
       , evaluated :: Int
       }
analyseMin = analyseMinWith []

-- | `analyseMin` with named partials (each `Tuple name source`), parsed and
-- | desugared like the render path so a section inside a partial is analysed too.
analyseMinWith
  :: Array (Tuple String String)
  -> String
  -> Value
  -> Either String
       { output :: String
       , report :: String
       , jsonata :: String
       , findings :: Array Finding
       , evaluated :: Int
       }
analyseMinWith partialSrcs src dat = case traverse compilePartial partialSrcs of
  Left e -> Left e
  Right ps -> case parseMin src of
    Left pe -> Left (renderParseErrorAt src pe)
    Right { nodes } -> case runAnalysisMin (Map.fromFoldable ps) dat (desugar nodes) of
      Left e -> Left (formatError src e)
      Right r -> Right
        { output: r.output
        , report: reportMarkdownWith minbarsLabels anyPath src r.decisions
        , jsonata: jsonataScaffold src r.decisions
        , findings: allFindings anyPath src r.decisions
        , evaluated: evaluatedCount r.decisions
        }
  where
  compilePartial (Tuple name s) = case parseMin s of
    Left pe -> Left (renderParseErrorAt s pe)
    Right { nodes } -> Right (Tuple name (desugar nodes))
