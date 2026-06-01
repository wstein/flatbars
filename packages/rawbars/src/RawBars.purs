-- | **RawBars** — the austere base of the dialect ladder (RawBars ⊂ FullBars ⊂
-- | MaxBars). It renders/compiles the *core* skeleton syntax directly — explicit
-- | `pass:[{{{ lookup this "x" }}}]`, no surface sugar — against the shared
-- | *reference engine*. (FullBars adds the surface desugar; MaxBars adds operators
-- | and pipes. The engine, value policy, prelude, and compiler are all shared.)
-- |
-- | This is a thin dialect layer: it reuses the reference engine's `runResolved`
-- | (`Kernel.Render`: parse → resolve `@truthiness` → seed → engine) and the
-- | shared compiler's `Emit` (`FlatBars.Compile.Emit.fullbarsEmit`), swapping in
-- | *no* surface desugar. Note it depends on `kernel` + `flatbars-compile`, *not*
-- | the `fullbars` package — its dependency closure is FullBars-free (see ADR-008).
-- | It exists so the three dialects are symmetric packages over one engine.
module RawBars
  ( render
  , renderDiag
  , renderValue
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
import Effect.Aff (Aff)
import FlatBars.Compile (compile) as Driver
import FlatBars.Compile.Emit (fullbarsEmit, metaFor, resolveForCompile)
import FlatBars.Error (Error(ParseFailure), ParseError, renderParseErrorAt)
import FlatBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import FlatBars.Value (Value)
import Kernel.Render (formatError, runResolved)
import Kernel.ToValue (class ToValue, toValue)

--------------------------------------------------------------------------------
-- Rendering (core syntax + the FullBars engine)
--------------------------------------------------------------------------------

-- | RawBars is the austere dialect: it rejects the Handlebars-only tag shapes
-- | (`{{{{…}}}}` raw blocks, `{{^…}}` inverse, `{{&…}}` unescaped) — `extras`
-- | off. Front-end knobs like standalone trimming still pass through.
coreOptions :: ParseOptions
coreOptions = defaultParseOptions { extras = false }

-- | Parse core source and return a pure renderer; the `@truthiness` mode is
-- | resolved once and baked in.
compile :: String -> Either ParseError (Value -> Either Error String)
compile = compileWith coreOptions

-- | `compile` with explicit parse options; RawBars always rejects extras.
compileWith :: ParseOptions -> String -> Either ParseError (Value -> Either Error String)
compileWith opts src = do
  { directives, nodes } <- parseWith (opts { extras = false }) src
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
  { directives, nodes } <- parseWith (opts { extras = false }) src
  fs <- resolveForCompile directives
  pure (Driver.compile (metaFor fs) fullbarsEmit [] nodes)
