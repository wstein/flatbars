-- | Value *policy* for the FullBars engine — the meaning the framework
-- | deliberately leaves out (`BareBars.Value` is just the data type). See
-- | `docs/modules/ROOT/pages/evaluation.adoc` §3.2, §3.6.
-- |
-- | A different engine could define truthiness, escaping, and stringification
-- | differently; these are this engine's choices.
module FullBars.Value
  ( truthy
  , stringify
  , jsonStringify
  , jsonStringifyPretty
  , escapeHtml
  ) where

import Prelude

import BareBars.Error (Error(..))
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Char (toCharCode)
import Data.Either (Either(..))
import Data.Foldable (foldMap)
import Data.Int (hexadecimal, toStringAs)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Monoid (power)
import Data.String (Pattern(..), Replacement(..), length, replaceAll, stripSuffix)
import Data.String.CodeUnits (singleton, toCharArray)
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))

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

-- | Serialize a value as compact JSON text (the default for the `json` /
-- | `esc_json` helpers). Unlike `stringify`, this is total — *objects* and
-- | *arrays* are first-class JSON, and a `VSafe` is just a string. Numbers reuse
-- | `numberToString` (so an integral value is `1`, not `1.0`); object keys come
-- | out in `Map` order.
jsonStringify :: Value -> String
jsonStringify = renderJson Nothing 0

-- | Serialize as *pretty* JSON: two-space indentation per level and a space
-- | after each `:` (matching `JSON.stringify(x, null, 2)`). Opt in with the
-- | helpers' `pretty=true` option. Empty objects/arrays stay on one line
-- | (`{}` / `[]`).
jsonStringifyPretty :: Value -> String
jsonStringifyPretty = renderJson (Just "  ") 0

-- | The shared JSON serializer. `mIndent` is the indent unit (`Nothing` ⇒
-- | compact, `Just unit` ⇒ pretty), `depth` the current nesting level.
renderJson :: Maybe String -> Int -> Value -> String
renderJson mIndent depth = case _ of
  VNull -> "null"
  VBool b -> if b then "true" else "false"
  VNumber n -> numberToString n
  VString s -> jsonQuote s
  VSafe s -> jsonQuote s
  VArray xs -> container "[" "]" (map (renderJson mIndent (depth + 1)) xs)
  VObject m ->
    container "{" "}"
      (map member (Map.toUnfoldable m :: Array (Tuple String Value)))
  where
  member (Tuple k v) = jsonQuote k <> colon <> renderJson mIndent (depth + 1) v
  colon = case mIndent of
    Just _ -> ": "
    Nothing -> ":"
  -- lay `items` between `open`/`close`: inline for compact (or when empty),
  -- otherwise one item per line indented to `depth + 1` with the close at `depth`.
  container open close items = case mIndent of
    _ | Array.null items -> open <> close
    Nothing -> open <> joinWith "," items <> close
    Just unit ->
      open <> "\n"
        <> joinWith ",\n" (map (\it -> power unit (depth + 1) <> it) items)
        <> "\n"
        <> power unit depth
        <> close

-- | Quote and escape a string as a JSON string literal: `"`, `\`, the readable
-- | control escapes (`\n`/`\r`/`\t`), and any other control character below
-- | U+0020 as `\u00XX`. Per-character so escape order can never double up.
jsonQuote :: String -> String
jsonQuote s = "\"" <> foldMap esc (toCharArray s) <> "\""
  where
  esc c = case c of
    '"' -> "\\\""
    '\\' -> "\\\\"
    '\n' -> "\\n"
    '\r' -> "\\r"
    '\t' -> "\\t"
    _ ->
      let
        code = toCharCode c
      in
        if code < 0x20 then "\\u00" <> pad2 (toStringAs hexadecimal code)
        else singleton c
  pad2 h = if length h == 1 then "0" <> h else h

-- | HTML-escape the five significant characters. Used by the `esc_html` helper.
escapeHtml :: String -> String
escapeHtml =
  replaceAll (Pattern "&") (Replacement "&amp;")
    >>> replaceAll (Pattern "<") (Replacement "&lt;")
    >>> replaceAll (Pattern ">") (Replacement "&gt;")
    >>> replaceAll (Pattern "\"") (Replacement "&quot;")
    >>> replaceAll (Pattern "'") (Replacement "&#x27;")
