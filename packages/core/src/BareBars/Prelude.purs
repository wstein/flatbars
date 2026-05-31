-- | The reference prelude. See `docs/modules/ROOT/pages/prelude.adoc`.
-- |
-- | *None of this is built into the core.* It is the meaning layer: a library
-- | of helpers, plus a schema, that together turn the skeleton AST into output.
-- | Delete `each` and `{{#each}}` stops working; the language is unaffected.
-- |
-- | Multi-branch control flow is expressed as *nested clause blocks*. `if`
-- | renders its body when truthy and an `{{#else}}…{{/else}}` clause otherwise;
-- | `each` renders its body per element and the `else` clause when empty. The
-- | clause name `else` is this prelude's choice, not the core's — a different
-- | engine could name it `otherwise`, add `elif`, or build a `switch`/`case`.
module BareBars.Prelude
  ( prelude
  , preludeSchema
  ) where

import Prelude

import BareBars.Env (Helper(..), HelperCtx, constHelper, lookupHelper, pushFrame, runHelper)
import BareBars.Error (Error(..))
import BareBars.Value (Value(..), escapeHtml, stringify, truthy)
import BareBars.Walk (Arity(..), HelperSpec, Schema, clause, withoutClause)
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
  , Tuple "then" clauseH
  , Tuple "else" clauseH
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
-- | them validates cleanly. `allowUnknown` is `false`.
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
      , Tuple "then" (spec true AnyArity)
      , Tuple "else" (spec true AnyArity)
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
thisH = Helper \ctx _ -> Right ctx.env.context

lookupH :: Helper
lookupH = Helper \_ args -> case Array.uncons args of
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
escHtmlH = Helper \_ args -> case args of
  [ VSafe s ] -> Right (VSafe s) -- idempotent on already-safe input
  [ v ] -> (VSafe <<< escapeHtml) <$> stringify v
  _ -> Left (ArityError "esc_html/1")

safeH :: Helper
safeH = Helper \_ args -> case args of
  [ v ] -> VSafe <$> stringify v
  _ -> Left (ArityError "safe/1")

-- | A raw-block helper that returns its captured body verbatim.
rawH :: Helper
rawH = Helper \ctx _ -> VSafe <$> ctx.renderTemplate ctx.body ctx.env

-- | A clause helper (`then`, `else`): transparent — it renders its own body.
-- | Control-flow helpers reach in and render the relevant clause; this default
-- | governs only direct use.
clauseH :: Helper
clauseH = Helper \ctx _ -> VSafe <$> ctx.renderTemplate ctx.body ctx.env

--------------------------------------------------------------------------------
-- Conditionals
--------------------------------------------------------------------------------

ifH :: Helper
ifH = Helper \ctx args -> case args of
  [ c ] ->
    if truthy c then renderMain ctx
    else renderElse ctx
  _ -> Left (ArityError "if/1")

unlessH :: Helper
unlessH = Helper \ctx args -> case args of
  [ c ] ->
    if truthy c then renderElse ctx
    else renderMain ctx
  _ -> Left (ArityError "unless/1")

-- | Render the body with any `else` clause stripped out.
renderMain :: HelperCtx -> Either Error Value
renderMain ctx = VSafe <$> ctx.renderTemplate (withoutClause "else" ctx.body) ctx.env

-- | Render the `{{#else}}…{{/else}}` clause, if present; otherwise empty.
renderElse :: HelperCtx -> Either Error Value
renderElse ctx = case clause "else" ctx.body of
  Just t -> VSafe <$> ctx.renderTemplate t ctx.env
  Nothing -> Right (VSafe "")

--------------------------------------------------------------------------------
-- Iteration & context shift
--------------------------------------------------------------------------------

eachH :: Helper
eachH = Helper \ctx args -> case args of
  [ coll ] -> case coll of
    VArray xs ->
      if Array.null xs then renderElse ctx
      else iterate ctx (Array.mapWithIndex (\i x -> { key: show i, val: x }) xs)
    VObject m ->
      let
        pairs = Map.toUnfoldable m :: Array (Tuple String Value)
      in
        if Array.null pairs then renderElse ctx
        else iterate ctx (map (\(Tuple k v) -> { key: k, val: v }) pairs)
    _ -> renderElse ctx
  _ -> Left (ArityError "each/1")

iterate :: HelperCtx -> Array { key :: String, val :: Value } -> Either Error Value
iterate ctx items =
  let
    main = withoutClause "else" ctx.body
    n = Array.length items
    renderItem i { key, val } =
      let
        frame = Map.fromFoldable
          [ Tuple "this" (constHelper val)
          , Tuple "index" (constHelper (VNumber (Int.toNumber i)))
          , Tuple "key" (constHelper (VString key))
          , Tuple "first" (constHelper (VBool (i == 0)))
          , Tuple "last" (constHelper (VBool (i == n - 1)))
          , Tuple "parent" (constHelper ctx.env.context)
          ]
      in
        ctx.renderTemplate main (pushFrame frame val ctx.env)
  in
    (VSafe <<< joinWith "") <$> traverse identity (Array.mapWithIndex renderItem items)

withH :: Helper
withH = Helper \ctx args -> case args of
  [ v ] ->
    if truthy v then
      let
        frame = Map.singleton "parent" (constHelper ctx.env.context)
      in
        VSafe <$> ctx.renderTemplate (withoutClause "else" ctx.body) (pushFrame frame v ctx.env)
    else renderElse ctx
  _ -> Left (ArityError "with/1")

--------------------------------------------------------------------------------
-- Composition / data
--------------------------------------------------------------------------------

dictH :: Helper
dictH = Helper \_ args -> build args Map.empty
  where
  build as acc = case Array.uncons as of
    Nothing -> Right (VObject acc)
    Just { head: VString k, tail } -> case Array.uncons tail of
      Just { head: v, tail: rest } -> build rest (Map.insert k v acc)
      Nothing -> Left (ArityError "dict: odd number of arguments")
    Just _ -> Left (TypeError "dict: keys must be strings")

applyH :: Helper
applyH = Helper \ctx args -> case Array.uncons args of
  Just { head: VString name, tail } -> case lookupHelper name ctx.env of
    Just h -> runHelper h ctx tail
    Nothing -> Left (UnknownHelper name)
  _ -> Left (TypeError "apply: first argument must be a helper-name string")

eqH :: Helper
eqH = Helper \_ args -> case args of
  [ a, b ] -> Right (VBool (a == b))
  _ -> Left (ArityError "eq/2")

notH :: Helper
notH = Helper \_ args -> case args of
  [ a ] -> Right (VBool (not (truthy a)))
  _ -> Left (ArityError "not/1")

andH :: Helper
andH = Helper \_ args -> Right (VBool (Array.all truthy args))

orH :: Helper
orH = Helper \_ args -> Right (VBool (Array.any truthy args))

logH :: Helper
logH = Helper \_ _ -> Right VNull -- effect-free in the pure (Either) host
