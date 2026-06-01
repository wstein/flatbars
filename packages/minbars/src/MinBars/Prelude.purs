-- | The MinBars prelude — the five Mustache-core helpers and the MinBars
-- | `Engine`.
-- |
-- | The desugar (`MinBars.Surface`) rewrites every surface shape into core
-- | applications over exactly these names: `mlookup`, `escape`, `section`,
-- | `inverted`, `partial`. The engine's `resolve` is therefore **closed** — it
-- | maps those fixed names and throws `HelperError` for anything else.
-- |
-- | These are *not* the FullBars prelude: MinBars' `section` is polymorphic
-- | (list-coercion + push), name resolution walks the context stack with parent
-- | fallback, and a missing `partial` renders `""` rather than throwing.
module MinBars.Prelude
  ( minEngine
  , mlookupH
  , escapeH
  , sectionH
  , invertedH
  , partialH
  ) where

import Prelude

import BareBars.Error (Error(..))
import BareBars.Value (Value(..))
import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Kernel.Engine (Engine, Helper)
import Kernel.Env (liftEither, recursionBudget)
import Kernel.Value (escapeHtml, isFalsy, stringify)
import MinBars.Context (MinEnv, enterPartial, minDepth, minFalsy, minPartials, mresolve, push)

-- | The MinBars engine over any `MonadThrow Error m`. `resolve` is closed: the
-- | five fixed helper names map to their helpers; an unknown name (which the
-- | desugar never emits) throws `HelperError`. `stringify` reuses the kernel's
-- | `Value.stringify`.
minEngine :: forall m. MonadThrow Error m => MinEnv -> Engine m MinEnv
minEngine initial =
  { initial
  , resolve: \_ name -> case name of
      "mlookup" -> pure mlookupH
      "escape" -> pure escapeH
      "section" -> pure sectionH
      "inverted" -> pure invertedH
      "partial" -> pure partialH
      other -> throwError (HelperError ("unknown MinBars helper '" <> other <> "'"))
  , stringify: \v -> liftEither (stringify v)
  }

-- | `mlookup name` — resolve a (possibly dotted) name against the context stack
-- | (parent fallback), per `MinBars.Context.mresolve`. The name is baked in by
-- | the desugar as a single `VString` argument; the value comes from `ctl.env`.
mlookupH :: forall m. MonadThrow Error m => Helper m MinEnv
mlookupH ctl args = case args of
  [ VString name ] -> pure (mresolve name ctl.env)
  _ -> throwError (HelperError "mlookup: expected exactly one string name")

-- | `escape v` — stringify then HTML-escape, marking the result safe (`VSafe`).
-- | `VNull` stringifies to `""`. Re-escaping a `VSafe` is idempotent (the kernel
-- | `escapeHtml` is only applied to freshly-stringified text here).
escapeH :: forall m. MonadThrow Error m => Helper m MinEnv
escapeH _ args = case args of
  [ v ] -> (VSafe <<< escapeHtml) <$> stringifyOrEmpty v
  _ -> throwError (HelperError "escape: expected exactly one argument")

-- | Stringify a value to output text, treating an object as an error (as the
-- | kernel does); `VNull` ⇒ `""`.
stringifyOrEmpty :: forall m. MonadThrow Error m => Value -> m String
stringifyOrEmpty = liftEither <<< stringify

-- | `section v` — the polymorphic Mustache section. The body is `ctl.children`;
-- | the value is coerced to a list of frames to push:
-- |
-- |  * `VArray xs` — render the body once per element, each pushed;
-- |  * a truthy non-list (under the env's falsy set) — render once with `v`
-- |    pushed (a hash becomes the new top frame; a scalar pushes too, so `{{.}}`
-- |    yields it and named lookups fall through to a parent);
-- |  * a falsy value (`false`/`null`/`[]`) — render zero times.
sectionH :: forall m. MonadThrow Error m => Helper m MinEnv
sectionH ctl args = case args of
  [ v ] ->
    let
      items = case v of
        VArray xs -> xs
        _ -> if isFalsy (minFalsy ctl.env) v then [] else [ v ]
    in
      (VSafe <<< joinWith "")
        <$> traverse (\it -> ctl.render (push it ctl.env) ctl.children) items
  _ -> throwError (HelperError "section: expected exactly one argument")

-- | `inverted v` — render the body once (context unchanged) iff `v` is falsy
-- | under the env's mode (`false`/`null`/`[]`), else `""`.
invertedH :: forall m. MonadThrow Error m => Helper m MinEnv
invertedH ctl args = case args of
  [ v ] ->
    if isFalsy (minFalsy ctl.env) v then VSafe <$> ctl.render ctl.env ctl.children
    else pure (VSafe "")
  _ -> throwError (HelperError "inverted: expected exactly one argument")

-- | `partial name` — render the registered partial `name` under the **current**
-- | context stack (it inherits the caller's stack). The name arrives as a
-- | `VString` literal from the desugar. A missing / non-string / unregistered
-- | name renders `""` (Mustache behaviour — never an error). Partial entry is
-- | guarded against `recursionBudget`, raising `RecursionLimit`.
partialH :: forall m. MonadThrow Error m => Helper m MinEnv
partialH ctl args = case args of
  [ VString name ] -> case Map.lookup name (minPartials ctl.env) of
    Just tmpl
      | minDepth ctl.env >= recursionBudget -> throwError (RecursionLimit recursionBudget)
      | otherwise -> VSafe <$> ctl.render (enterPartial ctl.env) tmpl
    Nothing -> pure (VSafe "")
  _ -> pure (VSafe "")
