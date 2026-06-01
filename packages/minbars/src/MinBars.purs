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

import Prelude

import BareBars.Error (ParseError, renderParseErrorAt)
import BareBars.Lexer (tokenizeTemplate)
import BareBars.Parser (ParseOptions, buildFromTokens, collectDirectives, defaultParseOptions)
import BareBars.Syntax (Directive, Template)
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
import MinBars.Standalone (mustacheStandalone)
import MinBars.Surface (desugar)

-- | Parse options for the MinBars surface: `extras = true` so the Handlebars-extra
-- | shapes Mustache also uses — `{{^…}}` (inverted) and `{{&…}}` (unescaped) — are
-- | accepted; `inheritance = true` so the Mustache-inheritance shapes `{{<p}}`
-- | (parent) and `{{$b}}` (block) parse; `trimStandalone = false` because MinBars
-- | does **not** use the core's Handlebars-flavored standalone pass — it runs its
-- | own Mustache pass (`MinBars.Standalone`) over the token stream instead (the
-- | eligible-tag set and the partial-indentation capture differ; §4.8).
minOptions :: ParseOptions
minOptions = defaultParseOptions
  { extras = true, inheritance = true, trimStandalone = false }

-- | Parse MinBars source into directives + nodes, applying the Mustache
-- | standalone-whitespace pass (`MinBars.Standalone`) between tokenizing and
-- | building the tree. This is MinBars' replacement for the core `parseWith`
-- | pipeline: it interposes the dialect-specific standalone pass on the raw token
-- | stream (which still carries comments, needed for comment-standalone) before
-- | the core tree builder drops comments and parses interiors.
parseMin :: String -> Either ParseError { directives :: Array Directive, nodes :: Template }
parseMin src = do
  toks <- tokenizeTemplate src
  directives <- collectDirectives toks
  nodes <- buildFromTokens minOptions (mustacheStandalone toks)
  pure { directives, nodes }

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
  compilePartial (Tuple name s) = case parseMin s of
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
renderCore partials src dat = case parseMin src of
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
