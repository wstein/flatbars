-- | The reference engine's helpers and schema. See
-- | `docs/modules/ROOT/pages/prelude.adoc`.
-- |
-- | *None of this is built into the core.* Helpers are `Helper m (RefEnv m)`
-- | over any `MonadThrow Error m`, so the very same prelude runs in a pure host
-- | (`Either Error`) or an async one (`ExceptT Error Aff`). Multi-branch control
-- | flow uses `{{else}}` separators; `if`/`each`/`with` split their body at the
-- | `{{else}}` marker via the control handle's `clause`.
module BareBars.Prelude
  ( prelude
  , preludeSchema
  ) where

import Prelude

import BareBars.Engine (Ctl, Helper)
import BareBars.Env (RefEnv, constHelper, lookupHelper, pushFrame, refContext)
import BareBars.Error (Error(..))
import BareBars.Value (Value(..), escapeHtml, stringify, truthy)
import BareBars.Walk (Arity(..), HelperSpec, Schema)
import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Int as Int
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))

prelude :: forall m. MonadThrow Error m => Array (Tuple String (Helper m (RefEnv m)))
prelude =
  [ Tuple "this" thisH
  , Tuple "lookup" lookupH
  , Tuple "true" (constHelper (VBool true))
  , Tuple "false" (constHelper (VBool false))
  , Tuple "null" (constHelper VNull)
  , Tuple "esc_html" escHtmlH
  , Tuple "safe" safeH
  , Tuple "raw" rawH
  , Tuple "if" ifH
  , Tuple "unless" unlessH
  , Tuple "each" eachH
  , Tuple "with" withH
  , Tuple "else" elseH
  , Tuple "dict" dictH
  , Tuple "apply" applyH
  , Tuple "eq" eqH
  , Tuple "eq?" eqH
  , Tuple "not" notH
  , Tuple "and" andH
  , Tuple "or" orH
  , Tuple "log" logH
  ]

-- | The reference engine's validation schema (`BareBars.Walk.validate`).
preludeSchema :: Schema
preludeSchema =
  { allowUnknown: false
  , helpers: Map.fromFoldable
      [ Tuple "this" (spec false (Exactly 0))
      , Tuple "root" (spec false (Exactly 0))
      , Tuple "parent" (spec false (Between 0 1))
      , Tuple "index" (spec false (Exactly 0))
      , Tuple "key" (spec false (Exactly 0))
      , Tuple "first" (spec false (Exactly 0))
      , Tuple "last" (spec false (Exactly 0))
      , Tuple "lookup" (spec false (AtLeast 1))
      , Tuple "true" (spec false (Exactly 0))
      , Tuple "false" (spec false (Exactly 0))
      , Tuple "null" (spec false (Exactly 0))
      , Tuple "esc_html" (spec false (Exactly 1))
      , Tuple "safe" (spec false (Exactly 1))
      , Tuple "raw" (spec true AnyArity)
      , Tuple "if" (spec true (Exactly 1))
      , Tuple "unless" (spec true (Exactly 1))
      , Tuple "each" (spec true (AtLeast 1))
      , Tuple "with" (spec true (AtLeast 1))
      , Tuple "else" (spec false AnyArity)
      , Tuple "dict" (spec false AnyArity)
      , Tuple "apply" (spec true (AtLeast 1))
      , Tuple "eq" (spec false (Exactly 2))
      , Tuple "eq?" (spec false (Exactly 2))
      , Tuple "not" (spec false (Exactly 1))
      , Tuple "and" (spec false AnyArity)
      , Tuple "or" (spec false AnyArity)
      , Tuple "log" (spec false (AtLeast 1))
      ]
  }
  where
  spec :: Boolean -> Arity -> HelperSpec
  spec block arity = { block, arity }

-- | Lift `Value.stringify` (which yields `Either Error`) into `m`.
stringifyM :: forall m. MonadThrow Error m => Value -> m String
stringifyM v = case stringify v of
  Left e -> throwError e
  Right s -> pure s

--------------------------------------------------------------------------------
-- Context & access
--------------------------------------------------------------------------------

thisH :: forall m. Applicative m => Helper m (RefEnv m)
thisH ctl _ = pure (refContext ctl.env)

lookupH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
lookupH _ args = case Array.uncons args of
  Nothing -> throwError (ArityError "lookup/≥1")
  Just { head, tail } -> pure (Array.foldl step head tail)
  where
  step :: Value -> Value -> Value
  step VNull _ = VNull
  step v key = indexValue v key

indexValue :: Value -> Value -> Value
indexValue (VObject m) (VString k) = fromMaybe VNull (Map.lookup k m)
indexValue (VObject m) (VNumber n) = fromMaybe VNull (Map.lookup (show (Int.round n)) m)
indexValue (VArray xs) (VNumber n) = fromMaybe VNull (Array.index xs (Int.round n))
indexValue (VArray xs) (VString s) = case Int.fromString s of
  Just i -> fromMaybe VNull (Array.index xs i)
  Nothing -> VNull
indexValue _ _ = VNull

--------------------------------------------------------------------------------
-- Output & safety
--------------------------------------------------------------------------------

escHtmlH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
escHtmlH _ args = case args of
  [ VSafe s ] -> pure (VSafe s) -- idempotent on already-safe input
  [ v ] -> (VSafe <<< escapeHtml) <$> stringifyM v
  _ -> throwError (ArityError "esc_html/1")

safeH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
safeH _ args = case args of
  [ v ] -> VSafe <$> stringifyM v
  _ -> throwError (ArityError "safe/1")

-- | A raw-block helper that returns its captured body verbatim.
rawH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
rawH ctl _ = VSafe <$> ctl.render ctl.env ctl.children

-- | `else` is a *separator marker*: on its own it renders to nothing. A block
-- | helper (`if`, `each`, `with`) gives it meaning by splitting its body at the
-- | `{{else}}` separator — see `splitClause`.
elseH :: forall m. Applicative m => Helper m (RefEnv m)
elseH _ _ = pure (VSafe "")

--------------------------------------------------------------------------------
-- Conditionals
--------------------------------------------------------------------------------

ifH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
ifH ctl args = case args of
  [ c ] -> if truthy c then renderMain ctl else renderElse ctl
  _ -> throwError (ArityError "if/1")

unlessH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
unlessH ctl args = case args of
  [ c ] -> if truthy c then renderElse ctl else renderMain ctl
  _ -> throwError (ArityError "unless/1")

-- | Render the body up to the first `{{else}}` separator.
renderMain :: forall m. MonadThrow Error m => Ctl m (RefEnv m) -> m Value
renderMain ctl = VSafe <$> ctl.render ctl.env (ctl.clause "else").before

-- | Render the clause after the `{{else}}` separator, if present; else empty.
renderElse :: forall m. MonadThrow Error m => Ctl m (RefEnv m) -> m Value
renderElse ctl = VSafe <$> ctl.render ctl.env (fromMaybe [] (ctl.clause "else").body)

--------------------------------------------------------------------------------
-- Iteration & context shift
--------------------------------------------------------------------------------

eachH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
eachH ctl args = case args of
  [ coll ] -> case coll of
    VArray xs ->
      if Array.null xs then renderElse ctl
      else iterate ctl (Array.mapWithIndex (\i x -> { key: show i, val: x }) xs)
    VObject m ->
      let
        pairs = Map.toUnfoldable m :: Array (Tuple String Value)
      in
        if Array.null pairs then renderElse ctl
        else iterate ctl (map (\(Tuple k v) -> { key: k, val: v }) pairs)
    _ -> renderElse ctl
  _ -> throwError (ArityError "each/1")

iterate
  :: forall m
   . MonadThrow Error m
  => Ctl m (RefEnv m)
  -> Array { key :: String, val :: Value }
  -> m Value
iterate ctl items =
  let
    main = (ctl.clause "else").before
    n = Array.length items
    renderItem i { key, val } =
      let
        frame = Map.fromFoldable
          [ Tuple "this" (constHelper val)
          , Tuple "index" (constHelper (VNumber (Int.toNumber i)))
          , Tuple "key" (constHelper (VString key))
          , Tuple "first" (constHelper (VBool (i == 0)))
          , Tuple "last" (constHelper (VBool (i == n - 1)))
          , Tuple "parent" (constHelper (refContext ctl.env))
          ]
      in
        ctl.render (pushFrame frame val ctl.env) main
  in
    (VSafe <<< joinWith "") <$> traverse identity (Array.mapWithIndex renderItem items)

withH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
withH ctl args = case args of
  [ v ] ->
    if truthy v then
      let
        frame = Map.singleton "parent" (constHelper (refContext ctl.env))
      in
        VSafe <$> ctl.render (pushFrame frame v ctl.env) (ctl.clause "else").before
    else renderElse ctl
  _ -> throwError (ArityError "with/1")

--------------------------------------------------------------------------------
-- Composition / data
--------------------------------------------------------------------------------

dictH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
dictH _ args = build args Map.empty
  where
  build as acc = case Array.uncons as of
    Nothing -> pure (VObject acc)
    Just { head: VString k, tail } -> case Array.uncons tail of
      Just { head: v, tail: rest } -> build rest (Map.insert k v acc)
      Nothing -> throwError (ArityError "dict: odd number of arguments")
    Just _ -> throwError (TypeError "dict: keys must be strings")

applyH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
applyH ctl args = case Array.uncons args of
  Just { head: VString name, tail } -> case lookupHelper name ctl.env of
    Just h -> h ctl tail
    Nothing -> throwError (UnknownHelper name)
  _ -> throwError (TypeError "apply: first argument must be a helper-name string")

eqH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
eqH _ args = case args of
  [ a, b ] -> pure (VBool (a == b))
  _ -> throwError (ArityError "eq/2")

notH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
notH _ args = case args of
  [ a ] -> pure (VBool (not (truthy a)))
  _ -> throwError (ArityError "not/1")

andH :: forall m. Applicative m => Helper m (RefEnv m)
andH _ args = pure (VBool (Array.all truthy args))

orH :: forall m. Applicative m => Helper m (RefEnv m)
orH _ args = pure (VBool (Array.any truthy args))

logH :: forall m. Applicative m => Helper m (RefEnv m)
logH _ _ = pure VNull -- effect-free in a pure host; an effectful engine can override
