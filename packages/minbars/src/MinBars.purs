-- | **MinBars** — the Mustache-compatible engine, the fourth member of the
-- | dialect ladder (RawBars · MinBars · FullBars · MaxBars). It is a *peer*
-- | engine to FullBars over the shared substrate: it reuses the skeleton parser,
-- | the `Value` ADT, the IoC walker, and the truthiness machinery, but supplies
-- | its own context-stack environment (`MinBars.Context`), its own Mustache
-- | prelude (`MinBars.Prelude`), and its own surface desugar
-- | (`MinBars.Surface`).
-- |
-- | This phase covers the Mustache *core*: escaped/raw interpolation, dotted
-- | names, the implicit iterator, polymorphic sections, inverted sections,
-- | comments, and (context-inheriting) partials. Inheritance, dynamic names,
-- | standalone-whitespace stripping, and set-delimiters are later phases.
module MinBars
  ( minOptions
  , renderMin
  , renderMinWith
  , renderMinDiag
  ) where

import BareBars.Error (renderParseErrorAt)
import BareBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import BareBars.Syntax (Template)
import BareBars.Value (Value)
import Data.Either (Either(..))
import Data.Map (Map)
import Data.Map as Map
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import Kernel.Engine (runTemplate)
import Kernel.Render (formatError)
import Kernel.Value (mustache, resolveTruthinessWith)
import MinBars.Context (seedEnv)
import MinBars.Prelude (minEngine)
import MinBars.Surface (desugar)

-- | Parse options for the MinBars surface: `extras = true` so the Handlebars-extra
-- | shapes Mustache also uses — `{{^…}}` (inverted) and `{{&…}}` (unescaped) — are
-- | accepted; `inheritance = true` so the Mustache-inheritance shapes `{{<p}}`
-- | (parent) and `{{$b}}` (block) parse; `trimStandalone = false` because
-- | standalone-whitespace handling is a later phase (leave the surrounding
-- | whitespace raw for now).
minOptions :: ParseOptions
minOptions = defaultParseOptions
  { extras = true, inheritance = true, trimStandalone = false }

-- | One-shot pure render of MinBars (Mustache) source against root data.
renderMin :: String -> Value -> Either String String
renderMin = renderMinWith []

-- | Render MinBars source with a set of named partials, each given as Mustache
-- | source (parsed + desugared, like `FullBars.renderSurfaceWith`). `{{> name}}`
-- | renders the registered partial under the current context stack.
renderMinWith :: Array (Tuple String String) -> String -> Value -> Either String String
renderMinWith partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> renderCore (Map.fromFoldable ps) src dat
  where
  compilePartial (Tuple name s) = case parseWith minOptions s of
    Left pe -> Left (renderParseErrorAt s pe)
    Right { nodes } -> Right (Tuple name (desugar nodes))

-- | `renderMin` — the located-error entry (parse failures report `line:column`,
-- | eval failures keep their `show` form). `renderMin`/`renderMinWith` share this
-- | machinery, mapping every error to a `String`.
renderMinDiag :: String -> Value -> Either String String
renderMinDiag = renderMin

-- | The shared glue: parse → resolve `@truthiness` against the `mustache` default
-- | → desugar → seed the env (stack = `[data]`, partials, falsy, depth 0) →
-- | run. Every error is rendered to a `String` for the host boundary.
renderCore :: Map String Template -> String -> Value -> Either String String
renderCore partials src dat = case parseWith minOptions src of
  Left pe -> Left (renderParseErrorAt src pe)
  Right { directives, nodes } -> case resolveTruthinessWith mustache directives of
    Left e -> Left (formatError src e)
    Right falsy ->
      let
        seeded = seedEnv dat partials falsy
      in
        case runTemplate (minEngine seeded) (desugar nodes) of
          Left e -> Left (formatError src e)
          Right out -> Right out
