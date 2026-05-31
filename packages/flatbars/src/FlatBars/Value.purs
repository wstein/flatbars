-- | Value *policy* for the FlatBars engine — the meaning the framework
-- | deliberately leaves out (`BareBars.Value` is just the data type). See
-- | `docs/modules/ROOT/pages/evaluation.adoc` §3.2, §3.6.
-- |
-- | A different engine could define truthiness, escaping, and stringification
-- | differently; these are this engine's choices.
module FlatBars.Value
  ( truthy
  , stringify
  , escapeHtml
  ) where

import Prelude

import BareBars.Error (Error(..))
import BareBars.Value (Value(..))
import Data.Either (Either(..))
import Data.Int as Int
import Data.String (Pattern(..), Replacement(..), replaceAll)
import Data.String.Common (joinWith)
import Data.Traversable (traverse)

-- | Truthiness, matching Handlebars: `false`, `null`, `""`, and the empty array
-- | are falsy; `0`, `{}`, and any non-empty value are truthy.
truthy :: Value -> Boolean
truthy = case _ of
  VBool b -> b
  VNull -> false
  VString "" -> false
  VSafe "" -> false
  VArray [] -> false
  _ -> true

-- | Convert a value to output text. This engine never escapes here (escaping is
-- | the `esc_html` helper); arrays join with `","` and objects are an error.
stringify :: Value -> Either Error String
stringify = case _ of
  VString s -> Right s
  VSafe s -> Right s
  VBool b -> Right (if b then "true" else "false")
  VNull -> Right ""
  VNumber n -> Right (numberToString n)
  VArray xs -> joinWith "," <$> traverse stringify xs
  VObject _ -> Left (TypeError "cannot stringify an object")

-- | Shortest round-tripping-ish decimal: integral numbers without a trailing ".0".
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
