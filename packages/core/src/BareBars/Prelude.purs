-- | The reference prelude. See `docs/modules/ROOT/pages/prelude.adoc`.
-- |
-- | *None of this is built into the core.* It is a library of helpers you
-- | register into the environment. Delete `each` and `{{#each}}` stops working;
-- | the language is unaffected.
-- |
-- | This module ships a working subset: context/access (`this`, `lookup`,
-- | `true`/`false`/`null`), output/safety (`esc_html`, `safe`), conditionals
-- | (`if`, `unless`), iteration/context-shift (`each`, `with`), composition
-- | (`dict`, `apply`, `eq`, `not`, `and`, `or`, `log`). Partials and decorators
-- | are left for a later iteration (see prelude.adoc §6.6).
module BareBars.Prelude
  ( prelude
  , preludeSchema
  ) where

import Prelude

import BareBars.Env (Blocks, Env, Helper(..), constHelper, lookupHelper, pushFrame, runHelper)
import BareBars.Error (Error(..))
import BareBars.Value (Value(..), escapeHtml, stringify, truthy)
import BareBars.Walk (Arity(..), HelperSpec, Schema)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Int as Int
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))

prelude :: Array (Tuple String Helper)
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
  , Tuple "dict" dictH
  , Tuple "apply" applyH
  , Tuple "eq" eqH
  , Tuple "eq?" eqH
  , Tuple "not" notH
  , Tuple "and" andH
  , Tuple "or" orH
  , Tuple "log" logH
  ]

-- | The reference engine's schema, for `BareBars.Walk.validate`. It declares
-- | every prelude helper plus the scoped helpers that block helpers install
-- | (`index`, `key`, `first`, `last`, `parent`, `root`), so a template using
-- | them validates cleanly. `allowUnknown` is `false`: a name outside this set
-- | is reported as an unknown helper.
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

--------------------------------------------------------------------------------
-- Context & access
--------------------------------------------------------------------------------

thisH :: Helper
thisH = Helper \env _ _ -> Right env.context

lookupH :: Helper
lookupH = Helper \_ args _ -> case Array.uncons args of
  Nothing -> Left (ArityError "lookup/≥1")
  Just { head, tail } -> Right (Array.foldl step head tail)
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

escHtmlH :: Helper
escHtmlH = Helper \_ args _ -> case args of
  [ VSafe s ] -> Right (VSafe s) -- idempotent on already-safe input
  [ v ] -> (VSafe <<< escapeHtml) <$> stringify v
  _ -> Left (ArityError "esc_html/1")

safeH :: Helper
safeH = Helper \_ args _ -> case args of
  [ v ] -> VSafe <$> stringify v
  _ -> Left (ArityError "safe/1")

-- | A raw-block helper that returns its captured body verbatim. For a raw
-- | block the body thunk ignores its environment and yields the literal text.
rawH :: Helper
rawH = Helper \env _ blocks -> VSafe <$> blocks.body env

--------------------------------------------------------------------------------
-- Conditionals
--------------------------------------------------------------------------------

ifH :: Helper
ifH = Helper \env args blocks -> case args of
  [ c ] ->
    if truthy c then VSafe <$> blocks.body env
    else runInverse env blocks
  _ -> Left (ArityError "if/1")

unlessH :: Helper
unlessH = Helper \env args blocks -> case args of
  [ c ] ->
    if truthy c then runInverse env blocks
    else VSafe <$> blocks.body env
  _ -> Left (ArityError "unless/1")

-- | The "inverse" of a block, in prelude terms, is simply its first branch
-- | (whatever the author named the separator — `else`, `otherwise`, …). The
-- | core never privileges a name; this prelude treats branch 0 as the inverse,
-- | matching Handlebars' single `{{else}}`. Richer, multi-branch helpers can
-- | inspect `blocks.branches` (names + args) themselves.
runInverse :: Env -> Blocks -> Either Error Value
runInverse env blocks = case Array.head blocks.branches of
  Just b -> VSafe <$> b.render env
  Nothing -> Right VNull

--------------------------------------------------------------------------------
-- Iteration & context shift
--------------------------------------------------------------------------------

eachH :: Helper
eachH = Helper \env args blocks -> case args of
  [ coll ] -> case coll of
    VArray xs ->
      if Array.null xs then runInverse env blocks
      else iterate env blocks (Array.mapWithIndex (\i x -> { key: show i, val: x }) xs)
    VObject m ->
      let
        pairs = Map.toUnfoldable m :: Array (Tuple String Value)
      in
        if Array.null pairs then runInverse env blocks
        else iterate env blocks (map (\(Tuple k v) -> { key: k, val: v }) pairs)
    _ -> runInverse env blocks
  _ -> Left (ArityError "each/1")

iterate :: Env -> Blocks -> Array { key :: String, val :: Value } -> Either Error Value
iterate env blocks items =
  let
    n = Array.length items
    renderItem i { key, val } =
      let
        frame = Map.fromFoldable
          [ Tuple "this" (constHelper val)
          , Tuple "index" (constHelper (VNumber (Int.toNumber i)))
          , Tuple "key" (constHelper (VString key))
          , Tuple "first" (constHelper (VBool (i == 0)))
          , Tuple "last" (constHelper (VBool (i == n - 1)))
          , Tuple "parent" (constHelper env.context)
          ]
      in
        blocks.body (pushFrame frame val env)
  in
    (VSafe <<< joinWith "") <$> traverse identity (Array.mapWithIndex renderItem items)

withH :: Helper
withH = Helper \env args blocks -> case args of
  [ v ] ->
    if truthy v then
      let
        frame = Map.singleton "parent" (constHelper env.context)
      in
        VSafe <$> blocks.body (pushFrame frame v env)
    else runInverse env blocks
  _ -> Left (ArityError "with/1")

--------------------------------------------------------------------------------
-- Composition / data
--------------------------------------------------------------------------------

dictH :: Helper
dictH = Helper \_ args _ -> build args Map.empty
  where
  build as acc = case Array.uncons as of
    Nothing -> Right (VObject acc)
    Just { head: VString k, tail } -> case Array.uncons tail of
      Just { head: v, tail: rest } -> build rest (Map.insert k v acc)
      Nothing -> Left (ArityError "dict: odd number of arguments")
    Just _ -> Left (TypeError "dict: keys must be strings")

applyH :: Helper
applyH = Helper \env args blocks -> case Array.uncons args of
  Just { head: VString name, tail } -> case lookupHelper name env of
    Just h -> runHelper h env tail blocks
    Nothing -> Left (UnknownHelper name)
  _ -> Left (TypeError "apply: first argument must be a helper-name string")

eqH :: Helper
eqH = Helper \_ args _ -> case args of
  [ a, b ] -> Right (VBool (a == b))
  _ -> Left (ArityError "eq/2")

notH :: Helper
notH = Helper \_ args _ -> case args of
  [ a ] -> Right (VBool (not (truthy a)))
  _ -> Left (ArityError "not/1")

andH :: Helper
andH = Helper \_ args _ -> Right (VBool (Array.all truthy args))

orH :: Helper
orH = Helper \_ args _ -> Right (VBool (Array.any truthy args))

logH :: Helper
logH = Helper \_ _ _ -> Right VNull -- effect-free in the pure (Either) host
