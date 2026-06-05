-- | Value *policy* for the FullBars engine — the meaning the framework
-- | deliberately leaves out (`FlatBars.Value` is just the data type). See
-- | `docs/modules/ROOT/pages/evaluation.adoc` §3.2, §3.6.
-- |
-- | A different engine could define truthiness, escaping, and stringification
-- | differently; these are this engine's choices.
module Kernel.Value
  ( Truthy
  , handlebars
  , minimal
  , presence
  , nonEmpty
  , mustache
  , mustacheJs
  , stringify
  , jsonStringify
  , jsonStringifyPretty
  , escapeHtml
  ) where

import Prelude

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
import FlatBars.Error (Error(..))
import FlatBars.Value (Value(..))

-- | A truthiness *rule* (ADR-022): the engine's *only* truthiness representation
-- | — a callback from a value to whether it is truthy. There is no data/config
-- | form; an engine plugs in one of these. The named rules below are the standard
-- | implementations. `VSafe` is judged by its content (a safe `""` tests as `""`);
-- | `NaN` is truthy under every rule (`NaN /= 0.0`).
type Truthy = Value -> Boolean

-- | The Handlebars rule: `false`, `null`, `""`, `0`, and the empty array are
-- | falsy; `{}` and every non-empty/non-zero value are truthy. The fixed
-- | truthiness rule of FullBars/RawBars/MaxBars (ADR-022).
handlebars :: Truthy
handlebars = case _ of
  VBool b -> b
  VNull -> false
  VString s -> s /= ""
  VNumber n -> n /= 0.0
  VArray a -> not (Array.null a)
  VObject _ -> true
  VSafe s -> handlebars (VString s)

-- | `minimal` (≡ Ruby/Lua/Lisp `nil`): only `false`/`null` are falsy — `0`, `""`,
-- | `[]`, `{}` are all truthy.
minimal :: Truthy
minimal = case _ of
  VBool b -> b
  VNull -> false
  _ -> true

-- | `presence`: present ⇒ truthy. `false`/`null` and the *empty* collections are
-- | falsy, but scalars (`0`, `""`) are truthy. `false` is kept falsy on purpose.
presence :: Truthy
presence = case _ of
  VBool b -> b
  VNull -> false
  VArray a -> not (Array.null a)
  VObject o -> not (Map.isEmpty o)
  _ -> true

-- | `nonEmpty` (`false null "" [] {}`): truthy ⟺ a *non-empty, present* value.
-- | `false`/`null` and every empty container — `""`, `[]`, `{}` — are falsy, but
-- | `0` is truthy (it is a present value, not emptiness; test magnitude with an
-- | explicit compare, e.g. `val > 0`). This is RawBars/MaxBars' rule (ADR-022):
-- | `presence` plus empty-string-is-empty. FullBars keeps `handlebars` (Handlebars
-- | fidelity), so the dialects deliberately diverge in value policy here.
nonEmpty :: Truthy
nonEmpty = case _ of
  VBool b -> b
  VNull -> false
  VString s -> s /= ""
  VSafe s -> s /= ""
  VArray a -> not (Array.null a)
  VObject o -> not (Map.isEmpty o)
  VNumber _ -> true

-- | `mustache` (`false null []`): the language-agnostic Mustache rule — `false`,
-- | `null`, and the empty *array* are falsy, but `0`, `""`, and `{}` are
-- | **truthy**. Distinct from `presence` (which also makes `{}` falsy) and from
-- | `handlebars` (which also makes `""`/`0` falsy). This is MinBars' default rule:
-- | it matches the reference Ruby/Python Mustache implementations and the parts of
-- | the spec suite that exercise sections (no fixture pins `0`/`""` truthiness, so
-- | both readings stay 184/184 — this is a deliberate spec-fidelity choice, not a
-- | conformance requirement). Note `mustache.js`, the dominant JS implementation,
-- | does *not* follow this rule — it skips a section on `!value`, making `0`/`""`
-- | falsy. That JS reading is `mustacheJs` below; hosts targeting `mustache.js`
-- | render through MinBars' opt-in compat mode (`renderMinJs`).
mustache :: Truthy
mustache = case _ of
  VBool b -> b
  VNull -> false
  VArray a -> not (Array.null a)
  _ -> true

-- | `mustacheJs`: the truthiness of `mustache.js` (the dominant JavaScript
-- | Mustache). It renders a section unless `!value`, so `false`/`null`/`0`/`""`
-- | (and `NaN`) are falsy and an empty list renders zero times, with `{}` truthy
-- | — which is *identical* to the `handlebars` rule. It is therefore defined as
-- | an alias: the value semantics are the same callback, and the distinct name
-- | documents intent at the call site (MinBars' `mustache.js`-compat render seeds
-- | this instead of `mustache`, ADR-022). The contrast with the language-agnostic
-- | `mustache` rule above (`0`/`""` truthy) is the portability hazard analyse mode
-- | surfaces.
mustacheJs :: Truthy
mustacheJs = handlebars

-- | Convert a value to output text. This engine never escapes here (escaping is
-- | the `escapeHtml` helper); arrays join with `","` and objects are an error.
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
-- | `escapeJson` helpers). Unlike `stringify`, this is total — *objects* and
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

-- | HTML-escape the five significant characters. Used by the `escapeHtml` helper.
escapeHtml :: String -> String
escapeHtml =
  replaceAll (Pattern "&") (Replacement "&amp;")
    >>> replaceAll (Pattern "<") (Replacement "&lt;")
    >>> replaceAll (Pattern ">") (Replacement "&gt;")
    >>> replaceAll (Pattern "\"") (Replacement "&quot;")
    >>> replaceAll (Pattern "'") (Replacement "&#x27;")
