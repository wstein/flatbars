-- | The value type. See `docs/modules/ROOT/pages/evaluation.adoc` §3.2.
-- |
-- | `Value` is pure data — there is deliberately *no function case*. Helpers
-- | live in the environment under names and are never values. This is *core*:
-- | the data the framework moves around. Its *policy* — truthiness, HTML
-- | escaping, how a value stringifies to output — is not here; that is an engine
-- | decision (see `BareHandlebars.Value`).
module BareBars.Value
  ( Value(..)
  ) where

import Prelude

import Data.Map (Map)

data Value
  = VString String
  | VNumber Number
  | VBool Boolean
  | VNull
  | VArray (Array Value)
  | VObject (Map String Value)
  | VSafe String -- a string already safe to emit unescaped (§3.6)

derive instance eqValue :: Eq Value

instance showValue :: Show Value where
  show = case _ of
    VString s -> "VString " <> show s
    VNumber n -> "VNumber " <> show n
    VBool b -> "VBool " <> show b
    VNull -> "VNull"
    VArray xs -> "VArray " <> show xs
    VObject m -> "VObject " <> show m
    VSafe s -> "VSafe " <> show s
