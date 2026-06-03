-- | **RawBars** — the austere base of the dialect ladder (RawBars ⊂ FullBars ⊂
-- | MaxBars). It renders/compiles the *core* skeleton syntax directly — explicit
-- | `pass:[{{{ lookup this "x" }}}]`, no surface sugar — against the shared
-- | *reference engine*. (FullBars adds the surface desugar; MaxBars adds operators
-- | and pipes. The engine, value policy, prelude, and compiler are all shared.)
-- |
-- | This is a thin dialect layer: it reuses the reference engine's `runResolved`
-- | (`Kernel.Render`: parse → seed the prelude env → engine) and the
-- | shared compiler's `Emit` (`FlatBars.Compile.Emit.fullbarsEmit`), swapping in
-- | *no* surface desugar. Note it depends on `kernel` + `flatbars-compile`, *not*
-- | the `fullbars` package — its dependency closure is FullBars-free (see ADR-008).
-- | It exists so the three dialects are symmetric packages over one engine.
module RawBars
  ( render
  , renderDiag
  , renderValue
  , renderWithOperations
  , renderAff
  , compile
  , compileWith
  , compileJs
  , compileJsWith
  ) where

import Prelude

import Control.Monad.Except.Trans (runExceptT)
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Map as Map
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import Effect.Aff (Aff)
import FlatBars.Compile (compile) as Driver
import FlatBars.Compile.Emit (fullbarsEmit, metaFor, resolveForCompile)
import FlatBars.Error (Error(ParseFailure), ParseError, renderParseErrorAt)
import FlatBars.Lexer (defaultLexConfig)
import FlatBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import FlatBars.Value (Value)
import Kernel.Engine (Operation)
import Kernel.Env (RefEnv, registerAll, registerPartials)
import Kernel.Render (formatError, runResolved)
import Kernel.ToValue (class ToValue, toValue)

--------------------------------------------------------------------------------
-- Rendering (core syntax + the FullBars engine)
--------------------------------------------------------------------------------

-- | RawBars is the austere dialect: it rejects the Handlebars-only tag shapes
-- | (`{{{{…}}}}` raw blocks, `{{^…}}` inverse, `{{&…}}` unescaped) — `extras`
-- | off. Front-end knobs like standalone trimming still pass through.
-- |
-- | Set delimiters are enabled (`mustacheDelims`): RawBars and MaxBars are
-- | non-Handlebars dialects, so inline `{{=<% %>=}}` and the
-- | `{{! @delimiters: <% %> }}` directive both work (ADR-015). FullBars — the
-- | Handlebars-faithful dialect — leaves them off (Handlebars has no set
-- | delimiters).
coreOptions :: ParseOptions
coreOptions = defaultParseOptions
  { extras = false
  , decorators = false
  , partialBlocks = false
  , lexConfig = defaultLexConfig { mustacheDelims = true }
  }

-- | Parse core source and return a pure renderer (the engine's fixed `handlebars`
-- | truthiness rule applies; ADR-022).
compile :: String -> Either ParseError (Value -> Either Error String)
compile = compileWith coreOptions

-- | `compile` with explicit parse options; RawBars always rejects extras.
compileWith :: ParseOptions -> String -> Either ParseError (Value -> Either Error String)
compileWith opts src = do
  { directives, nodes } <- parseWith
    (opts { extras = false, decorators = false, partialBlocks = false })
    src
  pure \dat -> runResolved directives identity nodes dat

-- | One-shot render of core source against data.
render :: String -> Value -> Either String String
render src dat = case parseWith coreOptions src of
  Left pe -> Left (show (ParseFailure pe))
  Right { directives, nodes } -> lmap show (runResolved directives identity nodes dat)

-- | `render` with located parse-error messages (`line:column:`).
renderDiag :: String -> Value -> Either String String
renderDiag src dat = case parseWith coreOptions src of
  Left pe -> Left (renderParseErrorAt src pe)
  Right { directives, nodes } -> lmap (formatError src) (runResolved directives identity nodes dat)

-- | Render core source against native PureScript data (lowered via `ToValue`).
renderValue :: forall a. ToValue a => String -> a -> Either String String
renderValue src = renderDiag src <<< toValue

-- | Render core source with host-registered *operations* and (core-source)
-- | partials (ADR-019 addendum). RawBars stays *strict* — an unknown head is
-- | `UnknownHelper`, never `blockHelperMissing` — and has no surface sugar, so a
-- | block operation gets `options.fn`/`inverse` (and `options.fn(ctx, { data })`)
-- | but no `options.hash` / block params (there is no `k=v` or `as |…|` to write).
-- | "operation" is the native boundary word; FullBars' twin is `renderWith` (helper).
renderWithOperations
  :: Array (Tuple String (Operation (Either Error) (RefEnv (Either Error))))
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String String
renderWithOperations operations partialSrcs src dat =
  case traverse compilePartial partialSrcs of
    Left e -> Left e
    Right ps -> case parseWith coreOptions src of
      Left pe -> Left (renderParseErrorAt src pe)
      Right { directives, nodes } ->
        let
          externalT = Map.fromFoldable (map (\p -> Tuple p.name p.template) ps)
          setup =
            registerAll operations
              <<< registerPartials externalT
        in
          lmap (formatError src) (runResolved directives setup nodes dat)
  where
  compilePartial (Tuple name s) = case parseWith coreOptions s of
    Left e -> Left (renderParseErrorAt s e)
    Right { nodes } -> Right { name, template: nodes }

-- | The async instantiation: the same engine in `ExceptT Error Aff`.
renderAff :: String -> Value -> Aff (Either Error String)
renderAff src dat = case parseWith coreOptions src of
  Left pe -> pure (Left (ParseFailure pe))
  Right { directives, nodes } -> runExceptT (runResolved directives identity nodes dat)

--------------------------------------------------------------------------------
-- Compilation (core syntax → JS, via the shared driver + FullBars Emit)
--------------------------------------------------------------------------------

-- | Compile core source to a JS ES module. Core does *not* hoist `{{#inline}}`
-- | (matching `render`): an `{{#inline}}` is a no-op and a partial to an
-- | unregistered name is a runtime error.
compileJs :: String -> Either ParseError String
compileJs = compileJsWith coreOptions

-- | `compileJs` with explicit parse options; RawBars always rejects extras.
compileJsWith :: ParseOptions -> String -> Either ParseError String
compileJsWith opts src = do
  { directives, nodes } <- parseWith
    (opts { extras = false, decorators = false, partialBlocks = false })
    src
  fs <- resolveForCompile directives
  pure (Driver.compile (metaFor fs) fullbarsEmit [] nodes)
