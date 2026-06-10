-- | The *reference* engine's environment and `Engine` instance.
-- |
-- | The driver (`Kernel.Engine`) is environment-agnostic; this module is one
-- | concrete choice: a stack of helper frames plus the current context. A
-- | different engine could pick an entirely different `env` type — that is the
-- | point of the pluggable driver. `RefEnv` is a newtype (not a synonym) so the
-- | otherwise-cyclic reference `RefEnv → Operation → Ctl → RefEnv` is well-founded.
module Kernel.Env
  ( RefEnv(..)
  , refContext
  , refTruthy
  , withTruthy
  , refTranslator
  , withTranslator
  , refYieldName
  , withYieldName
  , constOperation
  , emptyEnv
  , register
  , registerAll
  , lookupOperation
  , isScopedBinding
  , innermostFrame
  , pushFrame
  , pushHelpers
  , registerPartial
  , registerPartials
  , lookupPartial
  , refCurrentFile
  , withPartialFileScope
  , registerPartialFiles
  , refDepth
  , enterPartial
  , recursionBudget
  , refEngine
  , refEngineWith
  , liftEither
  ) where

import Prelude

import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Either (Either, either)
import Data.Foldable (foldl)
import Data.List (List(..), (:))
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error(..))
import FlatBars.Syntax (Ident, Template, splitBlockArgs)
import FlatBars.Value (Value)
import Kernel.Engine (Engine, Operation)
import Kernel.Value (Translator, handlebars, stringify)

-- | Lift a pure `Either Error` into the engine monad — the single place the
-- | `Left e -> throwError e` plumbing lives, shared by `refEngine` and helpers.
liftEither :: forall m a. MonadThrow Error m => Either Error a -> m a
liftEither = either throwError pure

newtype RefEnv m = RefEnv
  { context :: Value
  , helpers :: List (Map String (Operation m (RefEnv m)))
  , partials :: Map String Template -- named templates, for the `partial` helper
  -- The engine's *fixed* truthiness rule (ADR-022): the lambda the engine plugs
  -- in, governing `if`/`unless`/`and`/`or`/`not`. One rule per engine, the same
  -- everywhere (no per-file `@truthiness`, no per-partial switch); the built-in
  -- implementations are the named `Value` rules (`truthy handlebars`, etc.).
  , truthy :: Value -> Boolean
  -- The host's i18n brain (ADR-029), seeded per-engine like `truthy`. `Nothing`
  -- means no host wired: `t`/`number`/`date` fall back to their argument's plain
  -- text, and analyse mode flags the unwired calls. A first-class seam (not a
  -- `registerHelper` override), so the engine always knows whether one is present.
  , translator :: Maybe Translator
  -- The bare scoped name a block partial's body is exposed under (ADR-005
  -- amendment), seeded per-dialect like `truthy`: ClassicBars uses Handlebars'
  -- `partial-block` (the `{{> @partial-block}}` target); RawBars/MaxBars use the
  -- hyphen-free `yield` (writable bare where `-` is subtraction). Only the dialect's
  -- own spelling is bound to the body — the other resolves by the dialect's normal
  -- rule (empty under ClassicBars' lenient resolve; UnknownHelper under RawBars/MaxBars).
  , yieldName :: String
  -- how many partials deep this environment is. `partialH` bumps it on entry and
  -- refuses to recurse past `recursionBudget`, so a cyclic partial raises a
  -- located `RecursionLimit` rather than overflowing the stack.
  , depth :: Int
  -- Source-map provenance (ADR-035): the file whose source the spans of the
  -- currently-rendering template index ("main" for the entry template, a partial's
  -- name for its body). `partialH` shifts it via `withPartialFileScope`, and the
  -- mapped recorder stamps it onto each segment so the host links to the right tab.
  , currentFile :: String
  -- Per-partial source file, populated by the mapped facades (`registerPartialFiles`):
  -- an external partial indexes its own source (file = its name), an inline-hoisted
  -- one indexes where it was defined (file = "main").
  , partialFiles :: Map String String
  }

refContext :: forall m. RefEnv m -> Value
refContext (RefEnv e) = e.context

-- | The engine's truthiness rule for this environment (ADR-022). Fixed per
-- | engine — `if`/`unless`/`and`/`or`/`not` test through it.
refTruthy :: forall m. RefEnv m -> Value -> Boolean
refTruthy (RefEnv e) = e.truthy

-- | Seed the engine's truthiness rule. ClassicBars/RawBars/MaxBars keep the
-- | `handlebars` default `emptyEnv` installs; MinBars seeds `truthy mustache`.
withTruthy :: forall m. (Value -> Boolean) -> RefEnv m -> RefEnv m
withTruthy tf (RefEnv e) = RefEnv (e { truthy = tf })

-- | The scoped name this environment exposes a block partial's body under
-- | (ADR-005 amendment): `partial-block` (ClassicBars) or `yield` (RawBars/MaxBars).
refYieldName :: forall m. RefEnv m -> String
refYieldName (RefEnv e) = e.yieldName

-- | Seed the block-partial body's scoped name — the dialect analogue of
-- | `withTruthy`. ClassicBars keeps the `partial-block` default `emptyEnv` installs;
-- | RawBars/MaxBars seed `"yield"`.
withYieldName :: forall m. String -> RefEnv m -> RefEnv m
withYieldName n (RefEnv e) = RefEnv (e { yieldName = n })

-- | The host's i18n translator for this environment (ADR-029), or `Nothing` when
-- | no host is wired. `t`/`number`/`date` consult it; analyse flags its absence.
refTranslator :: forall m. RefEnv m -> Maybe Translator
refTranslator (RefEnv e) = e.translator

-- | Seed the host's i18n brain (ADR-029) — the i18n analogue of `withTruthy`. A
-- | host (the `flatbars-js` facade, the Lab) plugs in one translator that drives
-- | `t`/`number`/`date`; the default env carries `Nothing` (no host).
withTranslator :: forall m. Translator -> RefEnv m -> RefEnv m
withTranslator tr (RefEnv e) = RefEnv (e { translator = Just tr })

-- | A nullary helper that always returns a fixed value (scoped helpers like
-- | `index`, `first`, `this`).
constOperation :: forall m. Applicative m => Value -> Operation m (RefEnv m)
constOperation v = \_ _ -> pure v

-- | An environment with the given context and a single empty helper frame.
emptyEnv :: forall m. Value -> RefEnv m
emptyEnv ctx = RefEnv
  { context: ctx
  , helpers: Map.empty : Nil
  , partials: Map.empty
  , truthy: handlebars
  , translator: Nothing
  , yieldName: "partial-block"
  , depth: 0
  , currentFile: "main"
  , partialFiles: Map.empty
  }

-- | The maximum number of nested partials the engine renders before raising
-- | `RecursionLimit`. A cyclic partial (e.g. one that includes itself) would
-- | otherwise recurse forever and overflow the stack; this caps it.
recursionBudget :: Int
recursionBudget = 64

-- | The current partial nesting depth.
refDepth :: forall m. RefEnv m -> Int
refDepth (RefEnv e) = e.depth

-- | Enter one partial deeper: increment the depth counter. Threaded into the
-- | env a partial body renders under, so nested partials accumulate.
enterPartial :: forall m. RefEnv m -> RefEnv m
enterPartial (RefEnv e) = RefEnv (e { depth = e.depth + 1 })

-- | Register a helper into the innermost frame.
register :: forall m. String -> Operation m (RefEnv m) -> RefEnv m -> RefEnv m
register name h (RefEnv e) = RefEnv case e.helpers of
  Nil -> e { helpers = Map.singleton name h : Nil }
  top : rest -> e { helpers = Map.insert name h top : rest }

registerAll :: forall m. Array (Tuple String (Operation m (RefEnv m))) -> RefEnv m -> RefEnv m
registerAll pairs env = foldl (\acc (Tuple n h) -> register n h acc) env pairs

-- | Resolve a helper name, searching frames inner-to-outer.
lookupOperation :: forall m. String -> RefEnv m -> Maybe (Operation m (RefEnv m))
lookupOperation name (RefEnv e) = go e.helpers
  where
  go Nil = Nothing
  go (m : rest) = case Map.lookup name m of
    Just h -> Just h
    Nothing -> go rest

-- | True when `name` is bound by a *pushed* scope frame — a block param, loop
-- | variable, or loop label — rather than only the outermost prelude/registered-
-- | helper frame (the base, always the last frame: the seed installs one frame and
-- | block/`with` push on top). `lenientResolve` consults it so a scoped binding
-- | wins over the *data-section* reinterpretation of a same-named prelude value op
-- | (`{{#each xs as t}}{{t}}` must read the block param `t`, not the `t` translate
-- | helper). The compiled `rt.call` checks `frame.binds` first for the same reason,
-- | so the two paths stay byte-identical (`test:compile`).
-- |
-- | Cost: O(frame depth) `Map.member` probes, but it fires only for a *sectionable*
-- | value-op name in *lenient* (ClassicBars/MaxBars) resolve — a narrow slice — and
-- | frame depth is the static block-nesting depth, not a data dimension. If a deep
-- | `let`/loop nest ever makes this hot, short-circuit on the prelude membership
-- | check instead of walking to the base.
isScopedBinding :: forall m. String -> RefEnv m -> Boolean
isScopedBinding name (RefEnv e) = go e.helpers
  where
  go Nil = false
  go (_ : Nil) = false -- the outermost frame is the prelude/helpers base, not scope
  go (m : rest) = Map.member name m || go rest

-- | The innermost helper frame — the loop/with bindings of the current scope (for
-- | the context inspector, ADR-035): a block frame's keys are its scoped vars plus
-- | the block params, distinguishing them from the prelude in the outer frames.
innermostFrame :: forall m. RefEnv m -> Map String (Operation m (RefEnv m))
innermostFrame (RefEnv e) = case e.helpers of
  m : _ -> m
  Nil -> Map.empty

-- | Push a new frame and set a new context (what `this` returns in the body).
pushFrame :: forall m. Map String (Operation m (RefEnv m)) -> Value -> RefEnv m -> RefEnv m
pushFrame frame ctx (RefEnv e) = RefEnv (e { helpers = frame : e.helpers, context = ctx })

-- | Push a new helper frame without changing the context.
pushHelpers :: forall m. Map String (Operation m (RefEnv m)) -> RefEnv m -> RefEnv m
pushHelpers frame (RefEnv e) = RefEnv (e { helpers = frame : e.helpers })

-- | Register a named partial template (the body the `partial` helper renders).
registerPartial :: forall m. String -> Template -> RefEnv m -> RefEnv m
registerPartial name tmpl (RefEnv e) = RefEnv (e { partials = Map.insert name tmpl e.partials })

registerPartials :: forall m. Map String Template -> RefEnv m -> RefEnv m
registerPartials ps (RefEnv e) = RefEnv (e { partials = Map.union ps e.partials })

-- | Look up a registered partial by name.
lookupPartial :: forall m. String -> RefEnv m -> Maybe Template
lookupPartial name (RefEnv e) = Map.lookup name e.partials

-- | The file the current template's spans index (ADR-035): "main" for the entry,
-- | a partial's source file inside its body.
refCurrentFile :: forall m. RefEnv m -> String
refCurrentFile (RefEnv e) = e.currentFile

-- | Enter a partial's file scope (`partialH`): set `currentFile` to the partial's
-- | registered source file, defaulting to its own name when none is registered (an
-- | external partial indexes its own source). The non-mapped render leaves
-- | `partialFiles` empty and never records, so this only matters for the map.
withPartialFileScope :: forall m. String -> RefEnv m -> RefEnv m
withPartialFileScope name (RefEnv e) =
  RefEnv (e { currentFile = fromMaybe name (Map.lookup name e.partialFiles) })

-- | Register the source file of each named partial (the mapped facades): an
-- | external partial → its own name, an inline-hoisted one → "main".
registerPartialFiles :: forall m. Map String String -> RefEnv m -> RefEnv m
registerPartialFiles fs (RefEnv e) = RefEnv (e { partialFiles = Map.union fs e.partialFiles })

-- | The reference `Engine`: resolve from the frame stack (throwing
-- | `UnknownHelper`), stringify via `Value.stringify`.
refEngine :: forall m. MonadThrow Error m => RefEnv m -> Engine m (RefEnv m)
refEngine = refEngineWith (\_ name -> maybe (throwError (UnknownHelper name)) pure)

-- | Like `refEngine`, but with a pluggable *resolve policy*: `policy` is handed
-- | the name and the frame-stack lookup result (`Just h` when some frame defines
-- | it, `Nothing` when none does) and decides the operation to run. The strict
-- | default (`refEngine`) returns the found helper and throws `UnknownHelper`
-- | otherwise; ClassicBars supplies `Kernel.Prelude.lenientResolve` (Handlebars-style
-- | implicit sections) so a bare `{{#x}}` over data — whether `x` is unknown or a
-- | prelude value helper used in block position — iterates / renders rather than
-- | erroring. RawBars keeps the strict default — the divergence stays a
-- | per-dialect choice, not a core change.
refEngineWith
  :: forall m
   . MonadThrow Error m
  => (RefEnv m -> Ident -> Maybe (Operation m (RefEnv m)) -> m (Operation m (RefEnv m)))
  -> RefEnv m
  -> Engine m (RefEnv m)
refEngineWith policy initial =
  { initial
  , resolve: \env name -> policy env name (lookupOperation name env)
  -- raw-block heads resolve strictly regardless of `policy` (so even ClassicBars'
  -- lenient implicit sections don't apply): an undefined head is `UnknownHelper`.
  , resolveStrict: \env name -> maybe (throwError (UnknownHelper name)) pure
      (lookupOperation name env)
  , stringify: \v -> liftEither (stringify v)
  -- The marker-aware split (ADR-020 Phase 3). Recognises ClassicBars' `@hash`/`@param`
  -- block markers; a no-op for RawBars/MaxBars, which emit none — so this is safe
  -- as the shared default. `splitBlockArgs` demarkers the positional list, so
  -- built-in helpers receive exactly the values they did before.
  , blockArgs: splitBlockArgs
  -- No provenance by default: an unmapped render records nothing and `recordEmit`
  -- just runs its production, so output stays byte-identical (the compiler≡interpreter
  -- invariant). The mapped runner (`Kernel.Provenance`) overrides these fields.
  , recordText: \_ _ _ -> pure unit
  , recordEmit: \_ _ produce -> produce
  }
