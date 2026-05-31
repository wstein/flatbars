-- | The value type and its boundary operations (truthiness, stringification).
-- | See `docs/modules/ROOT/pages/evaluation.adoc` §3.2, §3.6.
-- |
-- | `Value` is pure data — there is deliberately *no function case*. Helpers
-- | live in the environment under names and are never values.
module BareBars.Value
  ( Value(..)
  , truthy
  , stringify
  , escapeHtml
  ) where

import Prelude

import BareBars.Error (Error(..))
import Data.Either (Either(..))
import Data.Int as Int
import Data.Map (Map)
import Data.String (Pattern(..), Replacement(..), replaceAll)
import Data.String.Common (joinWith)
import Data.Traversable (traverse)

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

-- | Truthiness as defined by the reference prelude (matching Handlebars):
-- | `false`, `null`, `""`, and the empty array are falsy; `0`, `{}`, and any
-- | non-empty value are truthy.
truthy :: Value -> Boolean
truthy = case _ of
  VBool b -> b
  VNull -> false
  VString "" -> false
  VSafe "" -> false
  VArray [] -> false
  _ -> true

-- | Convert a value to output text. The core never escapes.
stringify :: Value -> Either Error String
stringify = case _ of
  VString s -> Right s
  VSafe s -> Right s
  VBool b -> Right (if b then "true" else "false")
  VNull -> Right ""
  VNumber n -> Right (numberToString n)
  VArray xs -> joinWith "," <$> traverse stringify xs
  VObject _ -> Left (TypeError "cannot stringify an object")

-- | Shortest round-tripping-ish decimal: render integral numbers without a
-- | trailing ".0".
numberToString :: Number -> String
numberToString n =
  let
    i = Int.round n
  in
    if Int.toNumber i == n then show i else show n

-- | HTML-escape the five significant characters. Used by the `esc_html` helper.
escapeHtml :: String -> String
escapeHtml =
  replaceAll (Pattern "&") (Replacement "&amp;")
    >>> replaceAll (Pattern "<") (Replacement "&lt;")
    >>> replaceAll (Pattern ">") (Replacement "&gt;")
    >>> replaceAll (Pattern "\"") (Replacement "&quot;")
    >>> replaceAll (Pattern "'") (Replacement "&#x27;")
