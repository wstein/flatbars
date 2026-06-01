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
  , compileMinJs
  , compileMinJsWith
  ) where

import Prelude

import Data.Array as Array
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Foldable (elem)
import Data.List (List(..), (:))
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Compile (compile)
import FlatBars.Compile.Emit (falsyLiteral, runtimeVersion)
import FlatBars.Error (Error(..), ParseError(..), renderParseErrorAt)
import FlatBars.Lexer (LexConfig, defaultLexConfig, tokenizeTemplate)
import FlatBars.Parser (ParseOptions, buildFromTokens, collectDirectives, defaultParseOptions)
import FlatBars.Syntax (Directive, Expr(..), Node(..), Template)
import FlatBars.Value (Value(..))
import Kernel.Engine (runTemplate)
import Kernel.Render (formatError)
import Kernel.Value (FalsySet, mustache, resolveTruthinessWith)
import MinBars.Compile (minEmit)
import MinBars.Context (seedEnv)
import MinBars.Prelude (indentTemplate, minEngine)
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

-- | MinBars lexes with Mustache set-delimiters enabled (`{{=<% %>=}}`). Each
-- | template — including every partial, which is parsed by its own `parseMin` —
-- | starts at the default `{{`/`}}` pair, so delimiter changes are template-scoped
-- | (they never leak across a partial boundary), per the Mustache spec.
minLexConfig :: LexConfig
minLexConfig = defaultLexConfig { mustacheDelims = true }

-- | Parse MinBars source into directives + nodes, applying the Mustache
-- | standalone-whitespace pass (`MinBars.Standalone`) between tokenizing and
-- | building the tree. This is MinBars' replacement for the core `parseWith`
-- | pipeline: it interposes the dialect-specific standalone pass on the raw token
-- | stream (which still carries comments, needed for comment-standalone) before
-- | the core tree builder drops comments and parses interiors.
parseMin :: String -> Either ParseError { directives :: Array Directive, nodes :: Template }
parseMin src = do
  toks <- tokenizeTemplate minLexConfig src
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

-- | Compile MinBars (Mustache) source to a JS ES module (ADR-016) with no
-- | partials registered (`{{> p}}` then renders `""`, as the interpreter does for
-- | a missing partial). See `compileMinJsWith` for the partial-aware entry.
compileMinJs :: String -> Either ParseError String
compileMinJs = compileMinJsWith []

-- | Compile MinBars (Mustache) source to a JS ES module, reusing the
-- | dialect-agnostic `FlatBars.Compile` driver with MinBars' own `Emit`
-- | (`MinBars.Compile.minEmit`) over the `m*` runtime ops. The emitted function
-- | runs against `runtime/flatbars-runtime.mjs`; `compile_conformance.mjs` asserts
-- | it is byte-identical to `renderMin`/`renderMinWith`.
-- |
-- | Slice 2 (partials): `{{> p}}` is *inlined* — the partial's desugared template
-- | is spliced at the call site with `indentTemplate` applied (the standalone
-- | indent is a compile-time literal), in the caller's scope, so context
-- | inheritance and standalone-indent re-application match the interpreter exactly
-- | (which renders the same `indentTemplate indent tmpl` under the caller's env).
-- | A missing partial inlines to nothing (`""`).
-- |
-- | Out of scope, rejected with a `DisallowedShape` (loud, never a miscompile):
-- | *recursive* partials (a cycle cannot be inlined — the interpreter bounds them
-- | at run time), *dynamic-name* partials `{{>* name}}` (the name is unknown until
-- | run time), and *inheritance* (`{{<p}}` / `{{$b}}`, ADR-016 slice 3).
compileMinJsWith :: Array (Tuple String String) -> String -> Either ParseError String
compileMinJsWith partialSrcs src = do
  { directives, nodes } <- parseMin src
  falsy <- lmap toParseError (resolveTruthinessWith mustache directives)
  partials <- Map.fromFoldable <$> traverse parsePartial partialSrcs
  inlined <- inlinePartials partials Nil (desugar nodes)
  if hasUnsupported inlined then
    Left (DisallowedShape "inheritance — {{<p}} / {{$b}} (MinBars compile is ADR-016 slice 3)" 0)
  else Right (compile (minMeta falsy) minEmit [] inlined)
  where
  parsePartial (Tuple name s) = parseMin s <#> \r -> Tuple name (desugar r.nodes)
  toParseError = case _ of
    DirectiveError m o -> BadDirective m o
    e -> BadDirective (show e) 0

-- | The MinBars compile metadata: the runtime version, the `$falsy` const (the
-- | file's resolved mode, `mustache` by default), and the root-stack seed.
minMeta :: FalsySet -> { runtimeVersion :: String, preamble :: String, seed :: String }
minMeta falsy =
  { runtimeVersion
  , preamble: "const $falsy = " <> falsyLiteral falsy <> ";\n"
  , seed: "rt.mseed(data, $falsy)"
  }

-- | Inline every static `{{> p}}` into the (desugared) template, carrying the
-- | call-site standalone indent and tracking the inlining chain to reject cycles.
-- | The result is partial-free, ready for the slice-1 `minEmit`.
inlinePartials :: Map String Template -> List String -> Template -> Either ParseError Template
inlinePartials partials chain tmpl = Array.concat <$> traverse expand tmpl
  where
  expand = case _ of
    -- a static partial reference `(partial "name" "indent")` — splice it in.
    Output _ (App "partial" [ Lit (VString name), Lit (VString indent) ])
      | elem name chain -> Left
          (DisallowedShape ("recursive partial '" <> name <> "' (MinBars compile)") 0)
      | otherwise -> case Map.lookup name partials of
          Nothing -> Right [] -- missing partial ⇒ "" (Mustache: never an error)
          Just body -> inlinePartials partials (name : chain) (indentTemplate indent body)
    -- a dynamic-name partial `{{>* name}}` resolves at run time ⇒ cannot inline.
    Output _ (App "partial" _) ->
      Left (DisallowedShape "dynamic-name partial {{>* …}} (MinBars compile)" 0)
    Block sp sig name args body -> (\b -> [ Block sp sig name args b ]) <$> inlinePartials partials
      chain
      body
    other -> Right [ other ]

-- | Does the (already partial-inlined) template still use an unsupported
-- | construct? Only inheritance remains — parent templates / block overrides.
hasUnsupported :: Template -> Boolean
hasUnsupported = Array.any case _ of
  Block _ _ name _ body -> name == "parent" || name == "block" || hasUnsupported body
  _ -> false
