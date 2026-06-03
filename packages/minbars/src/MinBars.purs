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
  , renderMinDelimsDiag
  , compileMinJs
  , compileMinJsWith
  ) where

import Prelude

import Data.Array as Array
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
import FlatBars.Syntax (Directive, Expr(..), Node(..), Sigil(..), Template)
import FlatBars.Value (Value(..))
import Kernel.Engine (runTemplate)
import Kernel.Env (recursionBudget)
import Kernel.Render (formatError)
import Kernel.Value (mustache)
import MinBars.Compile (minEmit)
import MinBars.Context (seedEnv)
import MinBars.Prelude (harvestBlocks, indentTemplate, leadingIndent, minEngine)
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
  -- the Handlebars block sigils `{{#*}}` (decorator) / `{{#>}}` (partial block) are
  -- not part of the Mustache surface, so they stay gated off (a located error).
  { extras = true
  , inheritance = true
  , decorators = false
  , partialBlocks = false
  , trimStandalone = false
  }

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
parseMin = parseMinWith minLexConfig

-- | `parseMin` with the lexer config explicit, so the main template can start at
-- | a custom initial delimiter pair (`--mustache --delimiters '<% %>'`). Partials
-- | still parse with `minLexConfig` (the default pair), per Mustache's
-- | template-scoped delimiters.
parseMinWith
  :: LexConfig -> String -> Either ParseError { directives :: Array Directive, nodes :: Template }
parseMinWith cfg src = do
  toks <- tokenizeTemplate cfg src
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
renderCore = renderCoreWith minLexConfig

-- | `renderCore` with the main template's lexer config explicit (so it can start
-- | at a custom initial delimiter pair).
renderCoreWith :: LexConfig -> Map String Template -> String -> Value -> Either String String
renderCoreWith cfg partials src dat = case parseMinWith cfg src of
  Left pe -> Left (renderParseErrorAt src pe)
  Right { nodes } ->
    let
      seeded = seedEnv dat partials
    in
      case runTemplate (minEngine seeded) (desugar nodes) of
        Left e -> Left (formatError src e)
        Right out -> Right out

-- | Render MinBars (Mustache) source whose *initial* delimiters are `d` rather
-- | than the default `{{`/`}}` — the `flatbars --mustache --delimiters '<% %>'`
-- | path. Mustache `{{=A B=}}`-style switching still applies, relative to the
-- | initial pair. No partials (the CLI render-only path).
renderMinDelimsDiag
  :: { open :: String, close :: String } -> String -> Value -> Either String String
renderMinDelimsDiag d = renderCoreWith (minLexConfig { open = d.open, close = d.close }) Map.empty

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
-- | The pipeline is parse → resolve `@truthiness` → desugar → `inline` (resolve
-- | partials + inheritance into a partial-free, inheritance-free template; see
-- | its doc) → `compile`. The only constructs `inline` cannot express are
-- | rejected with a `DisallowedShape` (loud, never a miscompile): a *recursive*
-- | partial and a *dynamic-name* partial/parent (`{{>* }}` / `{{<* }}`).
compileMinJsWith :: Array (Tuple String String) -> String -> Either ParseError String
compileMinJsWith partialSrcs src = do
  { nodes } <- parseMin src
  partials <- Map.fromFoldable <$> traverse parsePartial partialSrcs
  inlined <- inline partials Map.empty Nil 0 (desugar nodes)
  Right (compile minMeta minEmit [] inlined)
  where
  parsePartial (Tuple name s) = parseMin s <#> \r -> Tuple name (desugar r.nodes)

-- | The MinBars compile metadata: the runtime version, the `$falsy` const (the
-- | engine's fixed `mustache` rule — ADR-022, no per-file `@truthiness`), and the
-- | root-stack seed.
minMeta :: { runtimeVersion :: String, preamble :: String, seed :: String }
minMeta =
  { runtimeVersion
  , preamble: "const $falsy = " <> falsyLiteral mustache <> ";\n"
  , seed: "rt.mseed(data, $falsy)"
  }

-- | Resolve partials and inheritance into a partial-free, inheritance-free
-- | template the slice-1 `minEmit` can compile. Everything here is static — block
-- | resolution never consults data — so the whole expansion happens at compile
-- | time, mirroring the interpreter (`MinBars.Prelude`).
-- |
-- |  * `partials` — registered partial templates (desugared); `overrides` — the
-- |    active `{{$b}}` block overrides (outer-wins via left-biased `Map.union`);
-- |    `chain` — the partial-inlining chain (cycle guard); `depth` — the parent
-- |    nesting (bounded by the recursion budget, like the interpreter).
-- |  * `{{> p}}` static partial: spliced with `indentTemplate`; a *recursive*
-- |    partial (data-driven, cannot be inlined) or a *dynamic-name* `{{>* }}` is
-- |    rejected (loud).
-- |  * `{{<p}}` parent: harvest the body's `{{$b}}` overrides, layer them under
-- |    any inherited ones (inherited = more-derived = wins), and inline the parent
-- |    template (`indentTemplate` for a standalone parent). Bounded by the budget;
-- |    a true cycle errors (the interpreter does too, at run time).
-- |  * `{{$b}}` block site: emit the override if one is active (reindented at the
-- |    expansion site when standalone — §4.6.2), else the default body.
inline
  :: Map String Template
  -> Map String Template
  -> List String
  -> Int
  -> Template
  -> Either ParseError Template
inline partials overrides chain depth tmpl = Array.concat <$> traverse one tmpl
  where
  recurse = inline partials overrides chain depth
  one = case _ of
    Output _ (App "partial" [ Lit (VString name), Lit (VString indent) ])
      | elem name chain -> Left
          (DisallowedShape ("recursive partial '" <> name <> "' (MinBars compile)") 0)
      | otherwise -> case Map.lookup name partials of
          Nothing -> Right []
          Just body -> inline partials overrides (name : chain) depth (indentTemplate indent body)
    Output _ (App "partial" _) ->
      Left (DisallowedShape "dynamic-name partial {{>* …}} (MinBars compile)" 0)
    -- `{{<p}}` — expand the parent template under the merged overrides.
    Block _ Section "parent" [ Lit (VString p), Lit (VString pindent) ] body
      | depth >= recursionBudget -> Left
          (DisallowedShape "inheritance recursion exceeded the budget (MinBars compile)" 0)
      | otherwise -> case Map.lookup p partials of
          Nothing -> Right []
          Just ptmpl ->
            inline partials (Map.union overrides (harvestBlocks body)) chain (depth + 1)
              (indentTemplate pindent ptmpl)
    Block _ Section "parent" _ _ ->
      Left (DisallowedShape "dynamic-name parent {{<* …}} (MinBars compile)" 0)
    -- `{{$b}}` — the override (reindented when standalone) or the default body.
    Block sp Section "block" args body -> case Array.head args of
      Just (Lit (VString name)) -> case Map.lookup name overrides of
        Nothing -> recurse body -- no override ⇒ the default body, never reindented
        Just override -> do
          inlinedOverride <- recurse override
          if Array.length args >= 2 then do
            expand <- expansionIndent (blockIndent args) body
            Right [ Block sp Section "@reindent" [ Lit (VString expand) ] inlinedOverride ]
          else Right inlinedOverride
      _ -> Left (DisallowedShape "malformed block override (MinBars compile)" 0)
    -- ordinary section / inverted: recurse into the body (overrides carry through;
    -- the data push is a runtime concern and does not touch the override stack).
    Block sp sig name args body -> (\b -> [ Block sp sig name args b ]) <$> recurse body
    other -> Right [ other ]

-- | A standalone block's captured indent (its arity-2 trailing literal).
blockIndent :: Array Expr -> String
blockIndent args = case Array.index args 1 of
  Just (Lit (VString s)) -> s
  _ -> ""

-- | The expansion indent for a standalone override (§4.6.2): the tag's own indent
-- | when non-empty, else the default body's *intrinsic* indentation — the leading
-- | whitespace of its first (already standalone-stripped) content line. A default
-- | that does not begin with static content has no statically-known intrinsic
-- | indent, so it is rejected (loud) rather than miscompiled.
expansionIndent :: String -> Template -> Either ParseError String
expansionIndent indent body
  | indent /= "" = Right indent
  | otherwise = case Array.head body of
      Just (Content s) -> Right (leadingIndent s)
      _ -> Left
        ( DisallowedShape "intrinsic block indentation with a non-static default (MinBars compile)"
            0
        )
