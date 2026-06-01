-- | Value *policy* for the FullBars engine — the meaning the framework
-- | deliberately leaves out (`BareBars.Value` is just the data type). See
-- | `docs/modules/ROOT/pages/evaluation.adoc` §3.2, §3.6.
-- |
-- | A different engine could define truthiness, escaping, and stringification
-- | differently; these are this engine's choices.
module Kernel.Value
  ( FalsyShape(..)
  , FalsySet
  , handlebars
  , minimal
  , presence
  , always
  , mustache
  , aliasSet
  , resolveTruthiness
  , resolveTruthinessWith
  , isFalsy
  , truthy
  , stringify
  , jsonStringify
  , jsonStringifyPretty
  , escapeHtml
  ) where

import Prelude

import BareBars.Error (Error(..))
import BareBars.Syntax (Directive)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Char (toCharCode)
import Data.Either (Either(..), note)
import Data.Foldable (foldMap)
import Data.Int (hexadecimal, toStringAs)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.Monoid (power)
import Data.Set (Set)
import Data.Set as Set
import Data.String (Pattern(..), Replacement(..), length, replaceAll, split, stripSuffix)
import Data.String.CodeUnits (singleton, toCharArray)
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))

-- | The closed vocabulary of *falsy shapes*: which value shapes a truthiness
-- | mode treats as false. These denote shapes, not values — value-specific
-- | logic (e.g. "is it the string `"no"`") is `eq`'s job, never truthiness.
-- | See `docs/.../truthiness` §2.2.
data FalsyShape
  = FFalse -- `VBool false`
  | FNull -- `VNull`
  | FEmptyStr -- the empty string `VString ""`
  | FZero -- numeric zero `VNumber 0.0`
  | FEmptyArr -- the empty array `VArray []`
  | FEmptyObj -- the empty object `VObject` (no keys)

derive instance Eq FalsyShape
derive instance Ord FalsyShape

-- | A truthiness *mode*: the set of shapes that count as false. The set is the
-- | only thing that varies between modes (`handlebars`/`ruby`/`presence`/…); the
-- | `isFalsy`/`truthy` machinery is fixed.
type FalsySet = Set FalsyShape

-- | The default mode — Handlebars: `false`, `null`, `""`, `0`, and the empty
-- | array are falsy; `{}` and every non-empty/non-zero value are truthy. This is
-- | the behaviour of the engine when no `@truthiness` directive is present, so
-- | existing templates are unaffected.
handlebars :: FalsySet
handlebars = Set.fromFoldable [ FFalse, FNull, FEmptyStr, FZero, FEmptyArr ]

-- | Is a value falsy under the given mode? Each shape is false only if its
-- | marker is in the set; everything else is truthy. A `VSafe` is judged by its
-- | *content* (a safe empty string is as falsy as a plain empty string) — the
-- | engine's long-standing content-based rule. `NaN` is truthy under every mode
-- | (`NaN == 0.0` is false, so `FZero` never matches it).
isFalsy :: FalsySet -> Value -> Boolean
isFalsy fs = case _ of
  VBool b -> not b && FFalse `Set.member` fs
  VNull -> FNull `Set.member` fs
  VString "" -> FEmptyStr `Set.member` fs
  VString _ -> false
  VNumber n -> n == 0.0 && FZero `Set.member` fs
  VArray a -> Array.null a && FEmptyArr `Set.member` fs
  VObject o -> Map.isEmpty o && FEmptyObj `Set.member` fs
  VSafe s -> isFalsy fs (VString s)

-- | Truthiness under a mode — the negation of `isFalsy`. (`includeZero` on
-- | `if`/`unless` is a per-call exception layered on the mode; see
-- | `Kernel.Prelude.truthyWith`.)
truthy :: FalsySet -> Value -> Boolean
truthy fs = not <<< isFalsy fs

--------------------------------------------------------------------------------
-- Named modes & the @truthiness resolver (truthiness spec §2.3, §4.2)
--------------------------------------------------------------------------------

-- | `minimal` (≡ `ruby`/`nil`/`lua`): only `false`/`null` are falsy — `0`, `""`,
-- | `[]`, `{}` are all truthy.
minimal :: FalsySet
minimal = Set.fromFoldable [ FFalse, FNull ]

-- | `presence`: present ⇒ truthy. `false`/`null` and the *empty* collections are
-- | falsy, but scalars (`0`, `""`) are truthy. `false` is kept falsy on purpose.
presence :: FalsySet
presence = Set.fromFoldable [ FFalse, FNull, FEmptyArr, FEmptyObj ]

-- | `always`: nothing is falsy — every value is truthy (the empty set). The
-- | named replacement for the illegal empty directive form.
always :: FalsySet
always = Set.empty

-- | `mustache` (`false null []`): the Mustache rule — `false`, `null`, and the
-- | empty *array* are falsy, but `0`, `""`, and `{}` are **truthy**. Distinct
-- | from `presence` (which also makes `{}` falsy) and from `handlebars` (which
-- | also makes `""`/`0` falsy). This is MinBars' engine default; the spec suite
-- | would fail if `0`/`""` were treated as falsy.
mustache :: FalsySet
mustache = Set.fromFoldable [ FFalse, FNull, FEmptyArr ]

-- | The alias table — 8 accepted names → 4 sets. Canonical display names are
-- | `empty` (the default), `minimal`, `presence`, `always`; `handlebars`,
-- | `ruby`/`nil`/`lua` are accepted synonyms (a name says nothing the explicit
-- | set does not — docs always print the expansion).
aliasSet :: String -> Maybe FalsySet
aliasSet = case _ of
  "empty" -> Just handlebars
  "handlebars" -> Just handlebars
  "minimal" -> Just minimal
  "ruby" -> Just minimal
  "nil" -> Just minimal
  "lua" -> Just minimal
  "presence" -> Just presence
  "always" -> Just always
  "mustache" -> Just mustache
  _ -> Nothing

-- | Resolve the active falsy-set from a template's header directives, against a
-- | caller-supplied *engine default* for the absent-directive case. Finds the
-- | (≤1) `@truthiness`; parses an alias *or* an explicit space-separated list of
-- | shape-literals (`false null "" 0 [] {}`). Absent ⇒ `def`. The per-engine
-- | default lives here (one kernel place): FullBars/RawBars/MaxBars pass
-- | `handlebars`; MinBars passes `mustache`.
-- | Errors: a duplicate `@truthiness`, an empty value, or an unknown
-- | alias/literal (which also rejects an alias+list mix and the bare-flag form).
resolveTruthinessWith :: FalsySet -> Array Directive -> Either Error FalsySet
resolveTruthinessWith def directives = case Array.filter (\d -> d.key == "truthiness") directives of
  [] -> Right def
  [ d ] -> parseTruthiness d.span.start d.value
  ds -> Left
    ( DirectiveError "duplicate @truthiness directive (at most one per file)"
        (maybe 0 (\d -> d.span.start) (Array.index ds 1))
    )

-- | `resolveTruthinessWith handlebars` — the absent-directive default for the
-- | Handlebars-family engines (RawBars/FullBars/MaxBars).
resolveTruthiness :: Array Directive -> Either Error FalsySet
resolveTruthiness = resolveTruthinessWith handlebars

-- | Parse a `@truthiness` value: an alias name, or a non-empty list of falsy
-- | shape-literals. The empty value is illegal — use the `always` alias. `off`
-- | is the directive's source offset, threaded into every error for location.
parseTruthiness :: Int -> String -> Either Error FalsySet
parseTruthiness off value = case aliasSet value of
  Just fs -> Right fs
  Nothing -> case tokens value of
    [] -> Left
      (DirectiveError "empty @truthiness value; use the 'always' alias for nothing-falsy" off)
    ts -> Set.fromFoldable <$> traverse (shapeOf off) ts
  where
  -- whitespace-separated, layout-insensitive (newlines/tabs count as spaces).
  tokens v =
    Array.filter (_ /= "")
      ( split (Pattern " ")
          ( replaceAll (Pattern "\t") (Replacement " ")
              ( replaceAll (Pattern "\n") (Replacement " ")
                  (replaceAll (Pattern "\r") (Replacement " ") v)
              )
          )
      )

shapeOf :: Int -> String -> Either Error FalsyShape
shapeOf off = case _ of
  "false" -> Right FFalse
  "null" -> Right FNull
  "\"\"" -> Right FEmptyStr
  "0" -> Right FZero
  "[]" -> Right FEmptyArr
  "{}" -> Right FEmptyObj
  other -> note (DirectiveError ("unknown @truthiness value '" <> other <> "'") off) Nothing

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

-- | HTML-escape the five significant characters. Used by the `escapeHtml` helper.
escapeHtml :: String -> String
escapeHtml =
  replaceAll (Pattern "&") (Replacement "&amp;")
    >>> replaceAll (Pattern "<") (Replacement "&lt;")
    >>> replaceAll (Pattern ">") (Replacement "&gt;")
    >>> replaceAll (Pattern "\"") (Replacement "&quot;")
    >>> replaceAll (Pattern "'") (Replacement "&#x27;")
