-- | Lift native PureScript data into the core `Value` (host binding).
-- |
-- | A PureScript host should be able to write `render tmpl { name: "Ada", admin:
-- | true }` rather than assembling `VObject`/`Map` by hand. `ToValue` is that
-- | bridge: primitives, `Array`, `Maybe`, and string-keyed `Map` map to the
-- | obvious `Value`, and a `RowToList`-driven instance turns any *record* into a
-- | `VObject` by lifting each field.
-- |
-- | This is the typed, dependency-light dual of `BareBars.Json.fromJson` (which
-- | bridges an external JSON wire value). It introduces *no* engine semantics —
-- | it only constructs the core `Value` the substrate already owns — so it stays
-- | in the core proper, unlike the JSON adapter.
-- |
-- | ```purescript
-- | toValue { name: "Ada", tags: [ "x", "y" ], admin: true }
-- |   == VObject (Map.fromFoldable
-- |        [ "name" /\ VString "Ada"
-- |        , "tags" /\ VArray [ VString "x", VString "y" ]
-- |        , "admin" /\ VBool true ])
-- | ```
module BareBars.ToValue
  ( class ToValue
  , toValue
  , class ToValueFields
  , toValueFields
  ) where

import Prelude

import BareBars.Value (Value(..))
import Data.Int (toNumber)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe, maybe)
import Data.Symbol (class IsSymbol, reflectSymbol)
import Prim.Row as Row
import Prim.RowList (class RowToList, Cons, Nil, RowList)
import Record (get)
import Type.Proxy (Proxy(..))

-- | Native PureScript data that can be lowered into a core `Value`.
class ToValue a where
  toValue :: a -> Value

instance ToValue Value where
  toValue = identity

instance ToValue String where
  toValue = VString

instance ToValue Boolean where
  toValue = VBool

instance ToValue Number where
  toValue = VNumber

instance ToValue Int where
  toValue = VNumber <<< toNumber

instance ToValue a => ToValue (Array a) where
  toValue = VArray <<< map toValue

-- | `Nothing` becomes `VNull` — the natural "absent" value.
instance ToValue a => ToValue (Maybe a) where
  toValue = maybe VNull toValue

-- | A string-keyed map becomes a `VObject` directly.
instance ToValue a => ToValue (Map String a) where
  toValue = VObject <<< map toValue

-- | Any record becomes a `VObject`, one field at a time, via its `RowList`.
instance (RowToList r rl, ToValueFields rl r) => ToValue (Record r) where
  toValue = VObject <<< toValueFields (Proxy :: Proxy rl)

-- | Folds a record's `RowList`, lifting each field with `ToValue` and keying it
-- | by the field label.
class ToValueFields :: RowList Type -> Row Type -> Constraint
class ToValueFields rl r where
  toValueFields :: Proxy rl -> Record r -> Map String Value

instance ToValueFields Nil r where
  toValueFields _ _ = Map.empty

instance
  ( IsSymbol key
  , ToValue value
  , Row.Cons key value tail r
  , ToValueFields rest r
  ) =>
  ToValueFields (Cons key value rest) r where
  toValueFields _ r =
    Map.insert
      (reflectSymbol key)
      (toValue (get key r))
      (toValueFields (Proxy :: Proxy rest) r)
    where
    key = Proxy :: Proxy key
