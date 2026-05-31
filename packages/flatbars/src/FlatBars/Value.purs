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
import Data.Maybe (fromMaybe)
import Data.String (Pattern(..), Replacement(..), replaceAll, stripSuffix)
import Data.String.Common (joinWith)
import Data.Traversable (traverse)

-- | Truthiness, matching Handlebars: `false`, `null`, `0`, `""`, and the empty
-- | array are falsy; `{}`, non-empty strings/arrays, and non-zero numbers are
-- | truthy. (Handlebars' `includeZero` option — counting `0` as truthy — lives
-- | in the `if`/`unless` helpers, not here.) A trusted empty string (`VSafe ""`)
-- | is falsy too, since it is still an empty string.
truthy :: Value -> Boolean
truthy = case _ of
  VBool b -> b
  VNull -> false
  VString "" -> false
  VSafe "" -> false
  VArray [] -> false
  VNumber n -> n /= 0.0
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

-- | Render a number as plain decimal: integral values without a trailing ".0",
-- | everything else via `show`. `show :: Number -> String` appends ".0" only to
-- | finite integral values, so stripping that suffix yields the integer — and it
-- | works for integers beyond `Int`'s 32-bit range (a round-trip through `Int`
-- | would overflow and mis-render e.g. `1000000000000`).
numberToString :: Number -> String
numberToString n =
  let
    s = show n
  in
    fromMaybe s (stripSuffix (Pattern ".0") s)

-- | HTML-escape the five significant characters. Used by the `esc_html` helper.
escapeHtml :: String -> String
escapeHtml =
  replaceAll (Pattern "&") (Replacement "&amp;")
    >>> replaceAll (Pattern "<") (Replacement "&lt;")
    >>> replaceAll (Pattern ">") (Replacement "&gt;")
    >>> replaceAll (Pattern "\"") (Replacement "&quot;")
    >>> replaceAll (Pattern "'") (Replacement "&#x27;")
