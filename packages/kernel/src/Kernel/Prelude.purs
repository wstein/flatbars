-- | The reference engine's helpers and schema. See
-- | `docs/modules/ROOT/pages/prelude.adoc`.
-- |
-- | *None of this is built into the core.* Helpers are `Operation m (RefEnv m)`
-- | over any `MonadThrow Error m`, so the very same prelude runs in a pure host
-- | (`Either Error`) or an async one (`ExceptT Error Aff`). Multi-branch control
-- | flow uses `{{else}}` separators; `if`/`each`/`with` split their body at the
-- | `{{else}}` marker via the control handle's `clause`.
-- |
-- | Helpers are declared *once* in `helperDefs` — each entry carries its name,
-- | whether it is a block helper, and its arity alongside the runtime function.
-- | `prelude` (the registry) and `preludeSchema` (the validator) are both
-- | *projections* of that one table, so a helper's runtime arity and its
-- | validated arity can never drift. Value helpers are built from the
-- | `Kernel.Operation` combinators (arity enforced by construction); block and
-- | bespoke helpers are written directly against `Operation`.
module Kernel.Prelude
  ( prelude
  , preludeSchema
  , preludeAliases
  , preludeSynonyms
  , preludeUnaryHelpers
  , coreHelperDefs
  , primitiveHelperDefs
  , coreSchema
  ) where

import Prelude

import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Array as Array
import Data.Either (Either)
import Data.Int as Int
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.Number (abs, ceil, floor, fromString, round, trunc) as Number
import Data.Number.Format (fixed, toStringWith) as Number
import Data.Set as Set
import Data.String (Pattern(..), Replacement(..))
import Data.String as String
import Data.String.CodeUnits as CodeUnits
import Data.String.Common (joinWith, toLower, toUpper)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error(..))
import FlatBars.Syntax (Template)
import FlatBars.Value (Value(..))
import Kernel.Engine (Ctl, Operation)
import Kernel.Env (RefEnv, constOperation, enterPartial, liftEither, lookupOperation, lookupPartial, lookupPartialFalsy, pushFrame, recursionBudget, refContext, refDepth, refFalsy, withFalsy)
import Kernel.Operation (ArgSpec, atLeast, binary, nullary, unary)
import Kernel.Value (FalsySet, FalsyShape(..), escapeHtml, handlebars, jsonStringify, jsonStringifyPretty, stringify, truthy)
import Kernel.Walk (Arity(..), Clause, Schema, splitClauses)

--------------------------------------------------------------------------------
-- The single source of truth
--------------------------------------------------------------------------------

-- | One helper's full declaration: its name, whether it opens a block, its
-- | arity, and the runtime function. `prelude` and `preludeSchema` below are
-- | projections of `helperDefs`, so the two never disagree.
type HelperDef m =
  { name :: String
  , block :: Boolean
  , arity :: Arity
  , run :: Operation m (RefEnv m)
  -- | A helper can be a *second name* for another helper, in one of two ways
  -- | (at most one is set):
  -- |
  -- | * `alias = Just canonical` — a **deprecation alias**: a foreign/legacy
  -- |   spelling (e.g. handlebars-helpers `plus` → `add`) accepted for
  -- |   compatibility but meant to be migrated off. It renders identically (a
  -- |   real, never-removed helper) but is second-class: the catalog marks it,
  -- |   the on-demand alias lint WARNS on its use, and the lift rewrites it to
  -- |   `canonical`. `preludeAliases` projects this.
  , alias :: Maybe String
  -- | * `synonymOf = Just canonical` — a **canonical synonym**: a name we endorse
  -- |   as a permanent, equal alternative (e.g. `isnt` ≡ `ne`, `size` ≡ `count`).
  -- |   It is NOT deprecated: the lint does not warn and the lift does not rewrite
  -- |   it. The catalog only labels it "synonym of `canonical`" so two identical
  -- |   helpers aren't shown as different capabilities. `preludeSynonyms` projects
  -- |   this. Add synonyms sparingly — each must materially improve readability
  -- |   for a common case, not merely respell an existing name.
  , synonymOf :: Maybe String
  -- | (Open decision 2: aliases are permanent + warn-on-demand, never
  -- | auto-rewritten on save.)
  }

-- | A non-block value helper built from a `Kernel.Operation` combinator. The
-- | combinator pins the arity, so the schema entry below is derived from the
-- | very guard the runtime uses.
valDef :: forall m. MonadThrow Error m => String -> (String -> ArgSpec m (RefEnv m)) -> HelperDef m
valDef name mk =
  let
    s = mk name
  in
    { name, block: false, arity: s.arity, run: s.run, alias: Nothing, synonymOf: Nothing }

-- | A block or bespoke helper written directly against `Operation`, with its arity
-- | declared explicitly (and enforced inside the helper body).
gen :: forall m. String -> Boolean -> Arity -> Operation m (RefEnv m) -> HelperDef m
gen name block arity run = { name, block, arity, run, alias: Nothing, synonymOf: Nothing }

-- | Mark a helper definition as a (warned, lifted) deprecation alias of `canonical`.
withAlias :: forall m. String -> HelperDef m -> HelperDef m
withAlias canonical d = d { alias = Just canonical }

-- | Mark a helper as a canonical synonym of `canonical` — an endorsed, equal
-- | alternative, labelled in the catalog but never warned or rewritten.
withSynonym :: forall m. String -> HelperDef m -> HelperDef m
withSynonym canonical d = d { synonymOf = Just canonical }

-- | The complete reference roster: the core helpers (control flow, access,
-- | arithmetic, …) followed by the *separable* value-primitive pack. Splitting
-- | the table — `helperDefs = coreHelperDefs <> primitiveHelperDefs` — keeps the
-- | primitives a genuinely detachable set (a registry/schema built from
-- | `coreHelperDefs` alone does not know `uppercase`), without introducing a
-- | pack-assembly abstraction.
helperDefs :: forall m. MonadThrow Error m => Array (HelperDef m)
helperDefs = coreHelperDefs <> primitiveHelperDefs

-- | The core helpers — everything that is not a value primitive.
coreHelperDefs :: forall m. MonadThrow Error m => Array (HelperDef m)
coreHelperDefs =
  [ gen "this" false (Exactly 0) thisH
  , gen "lookup" false (AtLeast 1) lookupH
  , valDef "true" (nullary (pure (VBool true)))
  , valDef "false" (nullary (pure (VBool false)))
  , valDef "null" (nullary (pure VNull))
  -- escaping (camelCase canonical names; no snake_case aliases).
  , valDef "escapeHtml" (unary escHtml)
  , valDef "safe" (unary safe)
  , gen "json" false (Between 1 2) jsonH
  , gen "escapeJson" false (Between 1 2) escJsonH
  , gen "raw" true AnyArity rawH
  , gen "if" true (Between 1 2) ifH
  , gen "unless" true (Between 1 2) unlessH
  , gen "each" true (AtLeast 1) eachH
  , gen "with" true (AtLeast 1) withH
  , valDef "else" (nullary (pure (VSafe "")))
  -- `elif cond [opts]`: a clause marker (its body/condition are handled by the
  -- enclosing `if` via splitClauses). The optional 2nd arg is an options object
  -- (surface hash `includeZero=true`), exactly like `if`'s — so the schema admits
  -- 1 or 2 args; the marker itself renders nothing.
  , gen "elif" false (Between 1 2) (\_ _ -> pure (VSafe ""))
  , gen "dict" false AnyArity dictH
  , gen "apply" true (AtLeast 1) applyH
  , gen "partial" false (Between 2 3) partialH
  , gen "inline" true (AtLeast 1) inlineH
  , valDef "eq" (binary eq')
  , valDef "ne" (binary ne')
  , valDef "lt" (binary (cmp (_ == LT)))
  , valDef "gt" (binary (cmp (_ == GT)))
  , valDef "lte" (binary (cmp (_ /= GT)))
  , valDef "gte" (binary (cmp (_ /= LT)))
  -- `isnt` reads as "is not" — a canonical synonym of `ne` (endorsed and equal),
  -- NOT a warned alias. See the two-bucket policy on `HelperDef`.
  , withSynonym "ne" (valDef "isnt" (binary ne'))
  , gen "not" false (Exactly 1) notH
  , gen "and" false AnyArity (boolH Array.all)
  , gen "or" false AnyArity (boolH Array.any)
  -- arithmetic: the desugar targets of the MaxBars `+ - * / %` operators, also
  -- callable explicitly in RawBars/FullBars (`(add a b)`). Strictly numeric:
  -- both operands must be `VNumber` (no string coercion — determinism), so the
  -- interpreter (which is itself JS) and the compiled runtime share JS's `+ - * /`
  -- bit-for-bit; `modulo` uses the `trunc` form, which equals JS `%`.
  , valDef "add" (binary (arith (+)))
  , valDef "subtract" (binary (arith (-)))
  , valDef "multiply" (binary (arith (*)))
  , valDef "divide" (binary (arith (/)))
  , valDef "modulo" (binary (arith jsMod))
  -- handlebars-helpers aliases: render identically to the canonical helpers
  -- (`add`/`subtract`/`multiply`); marked as aliases so the catalog flags them,
  -- the alias lint warns, and the lift normalises them to the `+ - *` operators.
  , withAlias "add" (valDef "plus" (binary (arith (+))))
  , withAlias "subtract" (valDef "minus" (binary (arith (-))))
  , withAlias "multiply" (valDef "times" (binary (arith (*))))
  -- null-coalescing: the desugar target of `??`. Returns the first non-`VNull`
  -- argument (else `VNull`). Distinct from truthiness — `0`/`""`/`[]` pass.
  , gen "coalesce" false (AtLeast 1) coalesceH
  , valDef "log" (atLeast 1 (const (pure VNull)))
  ]

-- | The value-primitive pack (helper-packs-spec §4) — the *separable* batch.
-- | These are pure transforms: subject-first (the value being transformed is
-- | argument 0), string-coercing their subject/string args via the engine's
-- | `stringify` (so `pass:[{{ uppercase n }}]` works on a number) and reading
-- | numeric args (`slice`/`truncate`) as numbers, and they return a plain
-- | `VString` (not `VSafe`) — escaping stays the output layer's job. Operations
-- | are on **code units** so the interpreter and the compiled JS runtime agree
-- | on indices and length bit-for-bit (gated by `test:compile`).
primitiveHelperDefs :: forall m. MonadThrow Error m => Array (HelperDef m)
primitiveHelperDefs =
  -- case
  [ valDef "lowercase" (unary (strUnary toLower))
  , valDef "uppercase" (unary (strUnary toUpper))
  , valDef "capitalize" (unary (strUnary capitalizeStr))
  -- whitespace
  , valDef "trim" (unary (strUnary String.trim))
  , valDef "trimStart" (unary (strUnary trimStartStr))
  , valDef "trimEnd" (unary (strUnary trimEndStr))
  -- substring & membership
  , valDef "split" (binary splitH)
  , gen "replace" false (Exactly 3) replaceH
  , gen "slice" false (Between 2 3) sliceH
  , valDef "includes" (binary includesH)
  , valDef "startsWith" (binary startsWithH)
  , valDef "endsWith" (binary endsWithH)
  , gen "truncate" false (Between 2 3) truncateH
  -- concatenation
  , valDef "append" (binary appendH)
  , valDef "prepend" (binary prependH)
  -- case aliases (handlebars-helpers parity): render identically to the
  -- canonical case helpers, reusing the very same `strUnary` transform.
  , withAlias "lowercase" (valDef "downcase" (unary (strUnary toLower)))
  , withAlias "uppercase" (valDef "upcase" (unary (strUnary toUpper)))
  -- number pack
  , valDef "abs" (unary (numUnary Number.abs))
  , valDef "floor" (unary (numUnary Number.floor))
  , valDef "ceil" (unary (numUnary Number.ceil))
  , valDef "round" (unary (numUnary Number.round))
  , valDef "toFixed" (binary toFixedH)
  , valDef "toInt" (unary toIntH)
  , valDef "toFloat" (unary toFloatH)
  -- array pack
  , valDef "join" (binary joinH)
  , valDef "count" (unary countH)
  -- `size` ≡ `count`: a canonical synonym (not a deprecation alias) — labelled
  -- in the catalog, never warned.
  , withSynonym "count" (valDef "size" (unary countH))
  , valDef "at" (binary atH)
  , valDef "take" (binary takeH)
  , valDef "takeRight" (binary takeRightH)
  , valDef "reverse" (unary reverseH)
  , valDef "unique" (unary uniqueH)
  , valDef "sortBy" (binary sortByH)
  , valDef "pluck" (binary pluckH)
  , valDef "groupBy" (binary groupByH)
  ]

-- | The registry: name → runtime helper.
prelude :: forall m. MonadThrow Error m => Array (Tuple String (Operation m (RefEnv m)))
prelude = map (\d -> Tuple d.name d.run) helperDefs

-- | The alias table — each alias name → its canonical name — projected from
-- | `helperDefs.alias` (the single source of truth). The catalog marks these
-- | ("alias of …"), the on-demand alias lint warns on their use, and the
-- | lift/migrate assist rewrites them. E.g. `plus → add`, `downcase → lowercase`.
preludeAliases :: Array (Tuple String String)
preludeAliases =
  Array.mapMaybe (\d -> Tuple d.name <$> d.alias)
    (helperDefs :: Array (HelperDef (Either Error)))

-- | The synonym table — each canonical synonym → its primary name — projected
-- | from `helperDefs.synonymOf`. Unlike aliases these are NOT deprecated: the
-- | catalog labels them ("synonym of …"), but the lint never warns and the lift
-- | never rewrites them. E.g. `isnt → ne`, `size → count`.
preludeSynonyms :: Array (Tuple String String)
preludeSynonyms =
  Array.mapMaybe (\d -> Tuple d.name <$> d.synonymOf)
    (helperDefs :: Array (HelperDef (Either Error)))

-- | The names of *value* (non-block) helpers whose arity admits a **single
-- | argument** — `Exactly 1` or `Between 1 n`. This is the candidate set for the
-- | linter's pipe re-sugaring (`(f a)` → `a | f`): every unary value transform
-- | (`uppercase`, `trim`, `abs`, `count`, `json`, …) qualifies automatically, so
-- | a new primitive becomes pipe-liftable with no change to the linter. The lift
-- | further removes names that own a dedicated surface (the `!`/operator helpers).
preludeUnaryHelpers :: Array String
preludeUnaryHelpers =
  Array.mapMaybe unaryName (helperDefs :: Array (HelperDef (Either Error)))
  where
  unaryName d
    | d.block = Nothing
    | otherwise = case d.arity of
        Exactly 1 -> Just d.name
        Between 1 _ -> Just d.name
        _ -> Nothing

-- | The reference engine's validation schema (`Kernel.Walk.validate`),
-- | projected from `helperDefs` plus the scoped variables below.
-- |
-- | NOTE: validation is *scope-blind* — like a lenient JSON schema, it checks
-- | only that a name is known and its arity fits, not *where* it may appear. The
-- | scoped helpers (`root`, `parent`, `index`, `key`, `first`, `last`) only
-- | exist inside the frames `each`/`with` push (and `root` from `preludeEnv`),
-- | so a template using `{{{index}}}` at top level *validates* but then fails to
-- | render with `UnknownHelper`. Declaring them keeps their in-scope uses from
-- | being flagged; catching out-of-scope uses would require a scope-aware pass,
-- | which the schema deliberately is not.
preludeSchema :: Schema
preludeSchema =
  { allowUnknown: false
  , helpers: Map.fromFoldable
      (scopedSpecs <> map helperSpec (helperDefs :: Array (HelperDef (Either Error))))
  }

-- | The schema for the *core* helpers alone (no value primitives) — used to
-- | demonstrate the primitives' separability: `coreSchema` does not know
-- | `uppercase`, whereas `preludeSchema` does.
coreSchema :: Schema
coreSchema =
  { allowUnknown: false
  , helpers: Map.fromFoldable
      (scopedSpecs <> map helperSpec (coreHelperDefs :: Array (HelperDef (Either Error))))
  }

helperSpec :: forall m. HelperDef m -> Tuple String { block :: Boolean, arity :: Arity }
helperSpec d = Tuple d.name { block: d.block, arity: d.arity }

scopedSpecs :: Array (Tuple String { block :: Boolean, arity :: Arity })
scopedSpecs =
  [ Tuple "root" { block: false, arity: Exactly 0 }
  , Tuple "parent" { block: false, arity: Between 0 1 }
  , Tuple "index" { block: false, arity: Exactly 0 }
  , Tuple "key" { block: false, arity: Exactly 0 }
  , Tuple "first" { block: false, arity: Exactly 0 }
  , Tuple "last" { block: false, arity: Exactly 0 }
  -- `index0` ≡ `index` (both 0-based). It's a canonical synonym, but scoped
  -- vars carry no synonym marker yet, so the catalog still lists it as "scoped"
  -- rather than "synonym of `index`" — tracked follow-up (extend synonymOf to
  -- scopedSpecs). `index1` is 1-based — a distinct helper, not a synonym.
  , Tuple "index0" { block: false, arity: Exactly 0 }
  , Tuple "index1" { block: false, arity: Exactly 0 }
  , Tuple "rindex0" { block: false, arity: Exactly 0 }
  , Tuple "rindex1" { block: false, arity: Exactly 0 }
  , Tuple "length" { block: false, arity: Exactly 0 }
  , Tuple "parent-index" { block: false, arity: Exactly 0 }
  , Tuple "parent-key" { block: false, arity: Exactly 0 }
  , Tuple "parent-first" { block: false, arity: Exactly 0 }
  , Tuple "parent-last" { block: false, arity: Exactly 0 }
  , Tuple "partial-block" { block: false, arity: Exactly 0 }
  ]

-- | Lift `Value.stringify` (pure, `Either Error`) into the engine monad.
stringifyM :: forall m. MonadThrow Error m => Value -> m String
stringifyM = liftEither <<< stringify

--------------------------------------------------------------------------------
-- Value helpers (arity enforced by the combinators above)
--------------------------------------------------------------------------------

-- | `escapeHtml`: HTML-escape a value; idempotent on already-safe input.
escHtml :: forall m. MonadThrow Error m => Value -> m Value
escHtml = case _ of
  VSafe s -> pure (VSafe s)
  v -> (VSafe <<< escapeHtml) <$> stringifyM v

-- | `safe`: mark a stringified value as trusted (no escaping).
safe :: forall m. MonadThrow Error m => Value -> m Value
safe v = VSafe <$> stringifyM v

-- | `json x [opts]`: serialize a value as JSON *text* (a plain `VString`, so
-- | surface `pass:[{{ json x }}]` still HTML-escapes it and `pass:[{{{ json x }}}]`
-- | emits it raw — e.g. for `<script>` data). An optional options object selects
-- | pretty-printing: `pass:[{{ json x pretty=true }}]` indents two spaces.
jsonH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
jsonH _ args = VString <$> jsonText "json" args

-- | `escapeJson x [opts]`: the JSON analogue of `escapeHtml` — serialize to JSON
-- | *and* HTML-escape, returning `VSafe`, for embedding JSON safely in HTML
-- | (e.g. an attribute). `escapeHtml` is idempotent on the result, so surface
-- | escaping does not double up. Accepts the same `pretty=true` option.
escJsonH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
escJsonH _ args = (VSafe <<< escapeHtml) <$> jsonText "escapeJson" args

-- | Serialize the first argument as JSON, compact by default or pretty when an
-- | optional second *options object* carries `pretty: true` (built by the
-- | surface hash, `pass:[pretty=true]`). Shared by `json` and `escapeJson`.
jsonText :: forall m. MonadThrow Error m => String -> Array Value -> m String
jsonText name args = case args of
  [ v ] -> pure (jsonStringify v)
  [ v, opts ] -> pure ((if optFlag "pretty" opts then jsonStringifyPretty else jsonStringify) v)
  _ -> throwError (ArityError (wrong1or2 name args))

eq' :: forall m. Applicative m => Value -> Value -> m Value
eq' a b = pure (VBool (a == b))

ne' :: forall m. Applicative m => Value -> Value -> m Value
ne' a b = pure (VBool (a /= b))

-- | Order two values: numbers numerically, strings lexicographically; anything
-- | else (mixed types, booleans, null, arrays, objects) is *incomparable*.
compareValues :: Value -> Value -> Maybe Ordering
compareValues a b = case a, b of
  VNumber x, VNumber y -> Just (compare x y)
  VString x, VString y -> Just (compare x y)
  _, _ -> Nothing

-- | A comparison helper (`lt`/`gt`/`lte`/`gte`): true when the ordering exists
-- | and satisfies `ok`; an incomparable pair is false.
cmp :: forall m. Applicative m => (Ordering -> Boolean) -> Value -> Value -> m Value
cmp ok a b = pure (VBool (maybe false ok (compareValues a b)))

-- | A binary arithmetic helper. Both operands must be numbers (`VNumber`); a
-- | non-number is a `TypeError` (no string coercion — keeps results deterministic
-- | and identical on both targets). The compiled runtime applies the same JS
-- | operator to the same `num`-guarded operands, so the two paths never drift.
arith :: forall m. MonadThrow Error m => (Number -> Number -> Number) -> Value -> Value -> m Value
arith op a b = do
  x <- asNum a
  y <- asNum b
  pure (VNumber (op x y))

asNum :: forall m. MonadThrow Error m => Value -> m Number
asNum = case _ of
  VNumber n -> pure n
  _ -> throwError (TypeError "arithmetic expects a number")

-- | JS-`%` modulo via the truncated-division identity (`a - b * trunc(a/b)`),
-- | so it matches the runtime's `Math.trunc`-based modulo bit-for-bit.
jsMod :: Number -> Number -> Number
jsMod a b = a - b * Number.trunc (a / b)

-- | `coalesce a b …`: the first non-`VNull` argument, else `VNull`. The desugar
-- | target of the MaxBars `??` operator (null-coalescing, *not* truthiness — so
-- | a falsy-but-present `0`/`""`/`[]` is returned, keeping `??` decoupled from the
-- | active `@truthiness` set).
coalesceH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
coalesceH _ args = pure (fromMaybe VNull (Array.find notNull args))
  where
  notNull VNull = false
  notNull _ = true

-- | `not`: logical negation under the *active* truthiness mode (`ctl.env`).
notH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
notH ctl args = case args of
  [ a ] -> pure (VBool (not (truthy (refFalsy ctl.env) a)))
  _ -> throwError (ArityError "not: expected exactly 1 argument")

-- | `and`/`or`: fold truthiness across the arguments with the given quantifier,
-- | consulting the active mode — so the file's `@truthiness` retunes them too
-- | (and `{{#if x}}`/`{{x && y}}` always agree). See truthiness spec §6.1.
boolH
  :: forall m
   . Applicative m
  => ((Value -> Boolean) -> Array Value -> Boolean)
  -> Operation m (RefEnv m)
boolH quant ctl args = pure (VBool (quant (truthy (refFalsy ctl.env)) args))

--------------------------------------------------------------------------------
-- Value primitives — string pack (helper-packs-spec §4)
--------------------------------------------------------------------------------
--
-- Coercion policy (applied identically in `flatbars-runtime.mjs`):
--   * the subject and any *string-valued* argument (sep/find/rep/sub/x/suffix)
--     are coerced with the engine's `stringify` — so `{{ uppercase n }}` works
--     on a number, exactly as the runtime's `stringify` does;
--   * numeric arguments (`slice`/`truncate`'s indices) read via `asNum` and are
--     truncated to an `Int` with `Int.round`, matching the runtime;
--   * results are plain `VString` (`split` ⇒ `VArray VString`); escaping is the
--     output layer's job, never these transforms'.
-- All indexing/length is over **code units** (`Data.String.CodeUnits`), the
-- same unit JS strings use, so the two targets agree bit-for-bit.

-- | A one-argument string transform: coerce the subject to text, apply `f`,
-- | return a `VString`.
strUnary :: forall m. MonadThrow Error m => (String -> String) -> Value -> m Value
strUnary f v = (VString <<< f) <$> stringifyM v

-- | `capitalize`: uppercase the first code unit; the rest is unchanged.
capitalizeStr :: String -> String
capitalizeStr s = case CodeUnits.uncons s of
  Nothing -> s
  Just { head, tail } -> toUpper (CodeUnits.singleton head) <> tail

-- | `trimStart`/`trimEnd`: defined in terms of `String.trim` (the very same
-- | `String.prototype.trim` FFI the JS runtime uses) so the trimmed whitespace
-- | set is identical on both targets without re-encoding it. `trim s` is the
-- | body with both ends stripped; its first occurrence in `s` begins exactly
-- | where the leading whitespace ends (the body's first char is non-whitespace,
-- | so no earlier match is possible), and likewise for the trailing end.
trimStartStr :: String -> String
trimStartStr s = case bodyStart s of
  Nothing -> ""
  Just i -> CodeUnits.drop i s

trimEndStr :: String -> String
trimEndStr s = case bodyStart s of
  Nothing -> ""
  Just i -> CodeUnits.take (i + CodeUnits.length (String.trim s)) s

-- | The code-unit index in `s` where `trim s` begins, or `Nothing` when `s` is
-- | all whitespace (`trim s == ""`).
bodyStart :: String -> Maybe Int
bodyStart s =
  let
    body = String.trim s
  in
    if body == "" then Nothing
    else CodeUnits.indexOf (Pattern body) s

-- | `split s sep` → `VArray` of `VString` pieces (literal separator).
splitH :: forall m. MonadThrow Error m => Value -> Value -> m Value
splitH sv sepv = do
  s <- stringifyM sv
  sep <- stringifyM sepv
  pure (VArray (map VString (String.split (Pattern sep) s)))

-- | `replace s find rep`: replace **all** literal occurrences of `find`.
replaceH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
replaceH _ args = case args of
  [ sv, findv, repv ] -> do
    s <- stringifyM sv
    find <- stringifyM findv
    rep <- stringifyM repv
    pure (VString (String.replaceAll (Pattern find) (Replacement rep) s))
  _ -> throwError
    (ArityError ("replace: expected exactly 3 argument(s), got " <> show (Array.length args)))

-- | `slice s start [end]`: a code-unit substring, matching JS
-- | `String.prototype.slice` exactly — negative indices count from the end,
-- | out-of-range indices clamp, and `start >= end` yields `""`. `end` defaults
-- | to the string length.
sliceH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
sliceH _ args = case args of
  [ sv, startv ] -> slice1 sv startv Nothing
  [ sv, startv, endv ] -> slice1 sv startv (Just endv)
  _ -> throwError
    (ArityError ("slice: expected 2 or 3 arguments, got " <> show (Array.length args)))
  where
  slice1 sv startv mEndv = do
    s <- stringifyM sv
    start <- asInt startv
    let
      len = CodeUnits.length s
    end <- case mEndv of
      Nothing -> pure len
      Just endv -> asInt endv
    let
      lo = clampIndex len start
      hi = clampIndex len end
    pure (VString (if lo >= hi then "" else CodeUnits.take (hi - lo) (CodeUnits.drop lo s)))

-- | Normalise a (possibly negative) JS slice index against a length: negatives
-- | count from the end (floored at 0), positives clamp to the length.
clampIndex :: Int -> Int -> Int
clampIndex len i
  | i < 0 = max (len + i) 0
  | otherwise = min i len

-- | `includes subject x` → `VBool`, polymorphic in the subject:
-- |   * a `VString` subject ⇒ literal substring membership (`(s sub)`);
-- |   * a `VArray` subject ⇒ element membership by `Value` equality (`(arr v)`);
-- |   * any other subject ⇒ `false`.
-- | The runtime entry type-dispatches identically (`Array.isArray` ⇒ element
-- | membership, string ⇒ `String.includes`, else `false`).
includesH :: forall m. MonadThrow Error m => Value -> Value -> m Value
includesH sv xv = case sv of
  VArray xs -> pure (VBool (Array.elem xv xs))
  VString s -> do
    sub <- stringifyM xv
    pure (VBool (String.contains (Pattern sub) s))
  _ -> pure (VBool false)

-- | `startsWith s x` / `endsWith s x` → `VBool`.
startsWithH :: forall m. MonadThrow Error m => Value -> Value -> m Value
startsWithH sv xv = do
  s <- stringifyM sv
  x <- stringifyM xv
  pure (VBool (isJustPrefix x s))
  where
  isJustPrefix p str = case CodeUnits.stripPrefix (Pattern p) str of
    Just _ -> true
    Nothing -> false

endsWithH :: forall m. MonadThrow Error m => Value -> Value -> m Value
endsWithH sv xv = do
  s <- stringifyM sv
  x <- stringifyM xv
  pure (VBool (isJustSuffix x s))
  where
  isJustSuffix sfx str = case CodeUnits.stripSuffix (Pattern sfx) str of
    Just _ -> true
    Nothing -> false

-- | `truncate s n [suffix]`: if `s` is longer than `n` code units, keep the
-- | first `n` and append `suffix` (default the ellipsis U+2026); otherwise
-- | return `s` unchanged. `n` is read as a number and truncated to an `Int`.
truncateH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
truncateH _ args = case args of
  [ sv, nv ] -> truncate1 sv nv ellipsis
  [ sv, nv, sufv ] -> do
    suf <- stringifyM sufv
    truncate1 sv nv suf
  _ -> throwError
    (ArityError ("truncate: expected 2 or 3 arguments, got " <> show (Array.length args)))
  where
  ellipsis = "\x2026"
  truncate1 sv nv suf = do
    s <- stringifyM sv
    n <- asInt nv
    pure (VString (if CodeUnits.length s > n then CodeUnits.take n s <> suf else s))

-- | `append s x` = `s` then `x`; `prepend s x` = `x` then `s`. Both coerce both
-- | operands to text.
appendH :: forall m. MonadThrow Error m => Value -> Value -> m Value
appendH sv xv = do
  s <- stringifyM sv
  x <- stringifyM xv
  pure (VString (s <> x))

prependH :: forall m. MonadThrow Error m => Value -> Value -> m Value
prependH sv xv = do
  s <- stringifyM sv
  x <- stringifyM xv
  pure (VString (x <> s))

-- | Read a numeric argument as an `Int`, truncating toward zero (`trunc`) to
-- | match the runtime's `Math.trunc`, and reusing `asNum`'s strict number guard.
asInt :: forall m. MonadThrow Error m => Value -> m Int
asInt v = (Int.round <<< Number.trunc) <$> asNum v

--------------------------------------------------------------------------------
-- Value primitives — number pack (helper-packs-spec §4)
--------------------------------------------------------------------------------
--
-- Determinism: `abs`/`floor`/`ceil`/`round` are `Data.Number` FFI to `Math.*`,
-- so they are byte-identical to the runtime's `Math.abs/floor/ceil/round`.
-- `toFixed`'s `toStringWith (fixed d)` FFI *is* JS `n.toFixed(d)`. `toInt`/
-- `toFloat` parse via `Data.Number.fromString` (= JS `parseFloat` gated by
-- `isFinite`); the runtime mirrors that exactly (`parseFloat` + `Number.isFinite`)
-- so the two paths never diverge — `VNull` on parse failure, `trunc` toward zero
-- for `toInt`. Operands read via the strict `asNum`/`asInt` guards.

-- | A one-argument numeric transform: read the (strictly numeric) subject, apply
-- | the `Math.*`-backed `f`, return a `VNumber`.
numUnary :: forall m. MonadThrow Error m => (Number -> Number) -> Value -> m Value
numUnary f v = (VNumber <<< f) <$> asNum v

-- | `toFixed n d`: format `n` with `d` fixed decimal places. The PureScript FFI
-- | (`toStringWith (fixed d) n`) is JS `n.toFixed(d)`, so both targets round
-- | identically. `d` is read via the strict `asInt` guard.
toFixedH :: forall m. MonadThrow Error m => Value -> Value -> m Value
toFixedH nv dv = do
  n <- asNum nv
  d <- asInt dv
  pure (VString (Number.toStringWith (Number.fixed d) n))

-- | `toInt s`: parse the stringified subject as a number then truncate toward
-- | zero; `VNull` when the subject does not parse to a finite number.
toIntH :: forall m. MonadThrow Error m => Value -> m Value
toIntH v = do
  s <- stringifyM v
  pure (maybe VNull (VNumber <<< Number.trunc) (Number.fromString s))

-- | `toFloat s`: parse the stringified subject as a number; `VNull` on failure.
toFloatH :: forall m. MonadThrow Error m => Value -> m Value
toFloatH v = do
  s <- stringifyM v
  pure (maybe VNull VNumber (Number.fromString s))

--------------------------------------------------------------------------------
-- Value primitives — array pack (helper-packs-spec §4, §6)
--------------------------------------------------------------------------------
--
-- The key-based forms (`sortBy`/`pluck`/`groupBy`) take a **dotted key string**
-- (§6, no callbacks): `extractPath` splits on `.` and walks each element with
-- the same `indexValue` access `lookup` uses. `sortBy` is a **stable** sort
-- (`Array.sortBy` is stable; V8's is too) keyed by `compareValues` with an
-- incomparable pair compared `EQ` (so stable order is preserved); the runtime
-- supplies a -1/0/1 comparator mirroring `compareValues`. All of this is gated
-- byte-identical against the runtime by `test:compile`.

-- | Extract a dotted-path value from a value (`"user.age"` walks `user` then
-- | `age`); a missing/blocked segment yields `VNull`, matching `lookup`.
extractPath :: String -> Value -> Value
extractPath path v =
  Array.foldl (\acc seg -> indexValue acc (VString seg)) v (String.split (Pattern ".") path)

-- | `join arr sep` → `VString`: stringify each element and the separator, then
-- | join. A non-array subject stringifies whole (its `stringify` already joins
-- | with `,`), matching the runtime's `Array.isArray` branch.
joinH :: forall m. MonadThrow Error m => Value -> Value -> m Value
joinH av sepv = do
  sep <- stringifyM sepv
  case av of
    VArray xs -> do
      parts <- traverse stringifyM xs
      pure (VString (joinWith sep parts))
    _ -> (VString) <$> stringifyM av

-- | `count` (alias `size`): the number of elements in a `VArray`, or the number
-- | of keys in a `VObject`; any other subject ⇒ `0`.
countH :: forall m. Applicative m => Value -> m Value
countH = case _ of
  VArray xs -> pure (VNumber (Int.toNumber (Array.length xs)))
  VObject m -> pure (VNumber (Int.toNumber (Map.size m)))
  _ -> pure (VNumber 0.0)

-- | `at arr i` → element: JS `Array.prototype.at` — a negative index counts from
-- | the end; out of range ⇒ `VNull`. A non-array subject ⇒ `VNull`.
atH :: forall m. MonadThrow Error m => Value -> Value -> m Value
atH av iv = do
  i <- asInt iv
  case av of
    VArray xs ->
      let
        idx = if i < 0 then Array.length xs + i else i
      in
        pure (fromMaybe VNull (Array.index xs idx))
    _ -> pure VNull

-- | `take arr n` / `takeRight arr n` → `VArray`: the first / last `n` elements
-- | (clamped to `[0, length]`). `n` reads via the strict `asInt` guard. A
-- | non-array subject ⇒ empty array.
takeH :: forall m. MonadThrow Error m => Value -> Value -> m Value
takeH = takeWith Array.take

takeRightH :: forall m. MonadThrow Error m => Value -> Value -> m Value
takeRightH = takeWith Array.takeEnd

takeWith
  :: forall m
   . MonadThrow Error m
  => (Int -> Array Value -> Array Value)
  -> Value
  -> Value
  -> m Value
takeWith f av nv = do
  n <- asInt nv
  case av of
    VArray xs -> pure (VArray (f (max 0 n) xs))
    _ -> pure (VArray [])

-- | `reverse`, polymorphic: a `VArray` reverses its elements; a `VString`
-- | reverses its **code units** (matching a JS code-unit reverse, not code
-- | points); any other subject is stringified then code-unit reversed.
reverseH :: forall m. MonadThrow Error m => Value -> m Value
reverseH = case _ of
  VArray xs -> pure (VArray (Array.reverse xs))
  VString s -> pure (VString (reverseCodeUnits s))
  v -> (VString <<< reverseCodeUnits) <$> stringifyM v

-- | Reverse a string by code units (UTF-16), the same unit JS uses.
reverseCodeUnits :: String -> String
reverseCodeUnits = CodeUnits.fromCharArray <<< Array.reverse <<< CodeUnits.toCharArray

-- | `unique arr` → `VArray`: dedupe by `Value` equality, preserving first
-- | occurrence order. A non-array subject ⇒ empty array.
uniqueH :: forall m. Applicative m => Value -> m Value
uniqueH = case _ of
  VArray xs -> pure (VArray (Array.nubByEq eq xs))
  _ -> pure (VArray [])

-- | `sortBy arr key` → `VArray`: stable sort by the dotted-`key` value of each
-- | element, using `compareValues`; an incomparable pair compares `EQ` (keeping
-- | their input order). A non-array subject ⇒ empty array.
sortByH :: forall m. MonadThrow Error m => Value -> Value -> m Value
sortByH av keyv = do
  key <- stringifyM keyv
  case av of
    VArray xs ->
      pure (VArray (Array.sortBy (\a b -> keyOrdering key a b) xs))
    _ -> pure (VArray [])
  where
  keyOrdering key a b =
    fromMaybe EQ (compareValues (extractPath key a) (extractPath key b))

-- | `pluck arr key` → `VArray`: the dotted-`key` value of every element. A
-- | non-array subject ⇒ empty array.
pluckH :: forall m. MonadThrow Error m => Value -> Value -> m Value
pluckH av keyv = do
  key <- stringifyM keyv
  case av of
    VArray xs -> pure (VArray (map (extractPath key) xs))
    _ -> pure (VArray [])

-- | `groupBy arr key` → `VObject`: group elements by the *stringified* dotted-
-- | `key` value, each bucket a `VArray` in input order. A non-array subject ⇒
-- | empty object.
groupByH :: forall m. MonadThrow Error m => Value -> Value -> m Value
groupByH av keyv = do
  key <- stringifyM keyv
  case av of
    VArray xs -> do
      grouped <- Array.foldM (insertGroup key) Map.empty xs
      pure (VObject (map (VArray <<< Array.reverse) grouped))
    _ -> pure (VObject Map.empty)
  where
  insertGroup key acc el = do
    k <- stringifyM (extractPath key el)
    pure (Map.alter (\mv -> Just (Array.cons el (fromMaybe [] mv))) k acc)

--------------------------------------------------------------------------------
-- Context & access
--------------------------------------------------------------------------------

thisH :: forall m. Applicative m => Operation m (RefEnv m)
thisH ctl _ = pure (refContext ctl.env)

lookupH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
lookupH _ args = case Array.uncons args of
  Nothing -> throwError (ArityError "lookup: expected at least 1 argument(s), got 0")
  Just { head, tail } -> pure (Array.foldl step head tail)
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

-- | A raw-block helper that returns its captured body verbatim.
rawH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
rawH ctl _ = VSafe <$> ctl.render ctl.env ctl.children

--------------------------------------------------------------------------------
-- Clauses (separator-driven control flow)
--------------------------------------------------------------------------------

-- | The body before the first `{{else}}` separator.
mainBody :: forall m. Ctl m (RefEnv m) -> Template
mainBody ctl = (ctl.clause "else").before

-- | The body after the first `{{else}}` separator, or empty if absent.
elseBody :: forall m. Ctl m (RefEnv m) -> Template
elseBody ctl = fromMaybe [] (ctl.clause "else").body

-- | Render a sub-tree in an environment, wrapped as already-escaped output.
renderSafe :: forall m. MonadThrow Error m => Ctl m (RefEnv m) -> RefEnv m -> Template -> m Value
renderSafe ctl env nodes = VSafe <$> ctl.render env nodes

-- | Render the main clause / the else clause in the current environment.
renderMain :: forall m. MonadThrow Error m => Ctl m (RefEnv m) -> m Value
renderMain ctl = renderSafe ctl ctl.env (mainBody ctl)

renderElse :: forall m. MonadThrow Error m => Ctl m (RefEnv m) -> m Value
renderElse ctl = renderSafe ctl ctl.env (elseBody ctl)

--------------------------------------------------------------------------------
-- Conditionals
--------------------------------------------------------------------------------

-- | `if cond [opts]` with optional `{{elif cond}}` / `{{else}}` clauses. An
-- | optional second argument to the *head* `if` is an *options object* (build it
-- | with `dict`); `includeZero: true` makes the number `0` truthy — Handlebars'
-- | `includeZero`. Without it, `0` is falsy (see `Value.truthy`).
-- |
-- | The body is read as a clause chain (`splitClauses`): the section before the
-- | first separator is the `then` branch; each `{{elif e}}` is tested in order
-- | and `{{else}}` is the terminal fallback. Conditions short-circuit — once a
-- | branch is taken, no later `elif` is evaluated (which matters for effects in
-- | `m`, and for a later `elif` that would error).
ifH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
ifH ctl args = do
  cond <- case args of
    [ c ] -> pure (truthy (refFalsy ctl.env) c)
    [ c, opts ] -> pure (truthyWith (refFalsy ctl.env) opts c)
    _ -> throwError (ArityError (wrong1or2 "if" args))
  let
    { before, clauses } = splitClauses ctl.children
  checkIfClauses clauses
  if cond then renderSafe ctl ctl.env before
  else pickClause ctl clauses

-- | Walk the `elif`/`else` clauses after a falsy `if`, evaluating each `elif`
-- | condition only until one holds. No matching clause ⇒ empty output.
pickClause :: forall m. MonadThrow Error m => Ctl m (RefEnv m) -> Array Clause -> m Value
pickClause ctl clauses = case Array.uncons clauses of
  Nothing -> pure (VSafe "")
  Just { head: cl, tail } -> case cl.name of
    "else" -> renderSafe ctl ctl.env cl.body
    -- `{{elif cond}}` / `{{elif cond includeZero=true}}`: the optional 2nd arg is
    -- a surface-hash options object, honoured with `truthyWith` exactly as the
    -- head `if`'s 2nd arg. Conditions short-circuit (only tested until one holds).
    "elif" -> case cl.args of
      [ condE ] -> elifBranch condE Nothing
      [ condE, optsE ] -> elifBranch condE (Just optsE)
      _ -> throwError (ClauseError "elif: expected 1 or 2 arguments")
      where
      elifBranch condE mOpts = do
        cond <- ctl.eval ctl.env condE
        hit <- case mOpts of
          Nothing -> pure (truthy (refFalsy ctl.env) cond)
          Just optsE -> (\opts -> truthyWith (refFalsy ctl.env) opts cond) <$> ctl.eval ctl.env
            optsE
        if hit then renderSafe ctl ctl.env cl.body else pickClause ctl tail
    other -> throwError (ClauseError ("if: unexpected clause '" <> other <> "'"))

-- | Reject a malformed clause chain *before* branching, so the error does not
-- | depend on which branch the data happens to take: every clause must be
-- | `elif` or `else`, an `elif` is unary, and `else` must be the last clause
-- | (anything after it is unreachable).
checkIfClauses :: forall m. MonadThrow Error m => Array Clause -> m Unit
checkIfClauses clauses = case Array.uncons clauses of
  Nothing -> pure unit
  Just { head: cl, tail } -> case cl.name of
    "else"
      | Array.null tail -> pure unit
      | otherwise -> throwError (ClauseError "if: {{else}} must be the final clause")
    "elif" -> case cl.args of
      [ _ ] -> checkIfClauses tail
      [ _, _ ] -> checkIfClauses tail
      _ -> throwError (ClauseError "elif: expected 1 or 2 arguments")
    other -> throwError (ClauseError ("if: unexpected clause '" <> other <> "'"))

unlessH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
unlessH ctl args = case args of
  [ c ] -> branchOn (not (truthy (refFalsy ctl.env) c)) ctl
  [ c, opts ] -> branchOn (not (truthyWith (refFalsy ctl.env) opts c)) ctl
  _ -> throwError (ArityError (wrong1or2 "unless" args))

-- | Render the main clause when the condition holds, else the `{{else}}` clause.
branchOn :: forall m. MonadThrow Error m => Boolean -> Ctl m (RefEnv m) -> m Value
branchOn cond ctl = if cond then renderMain ctl else renderElse ctl

wrong1or2 :: String -> Array Value -> String
wrong1or2 name args = name <> ": expected 1 or 2 arguments, got " <> show (Array.length args)

-- | Truthiness under the active mode, honoring an options object's `includeZero`
-- | flag as a *per-call exception*: when set, `FZero` is removed from the mode
-- | for this one test (so `0` counts as truthy), composing with whatever the
-- | file's `@truthiness` is (a no-op when the mode already omits `0`). See spec
-- | §3.3.
truthyWith :: FalsySet -> Value -> Value -> Boolean
truthyWith fs opts v = truthy (if optFlag "includeZero" opts then Set.delete FZero fs else fs) v

-- | Read a boolean option from an options object (`VObject`); absent ⇒ false.
optFlag :: String -> Value -> Boolean
optFlag key = case _ of
  VObject m -> maybe false (truthy handlebars) (Map.lookup key m)
  _ -> false

--------------------------------------------------------------------------------
-- Iteration & context shift
--------------------------------------------------------------------------------

-- | `each coll [name1 name2]`: the optional trailing string arguments are block
-- | params (surface `as |name1 name2|`) — `name1` binds the element, `name2` the
-- | index (array) or key (object).
eachH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
eachH ctl args = case Array.uncons args of
  Just { head: coll, tail: rest } ->
    let
      names = bindingNames rest
    in
      case coll of
        VArray xs ->
          if Array.null xs then renderElse ctl
          else iterate ctl names
            ( Array.mapWithIndex
                (\i x -> { val: x, key: VNull, idx: VNumber (Int.toNumber i) })
                xs
            )
        VObject m ->
          let
            pairs = Map.toUnfoldable m :: Array (Tuple String Value)
          in
            if Array.null pairs then renderElse ctl
            else iterate ctl names
              (map (\(Tuple k v) -> { val: v, key: VString k, idx: VString k }) pairs)
        _ -> renderElse ctl
  Nothing -> throwError (ArityError "each: expected at least 1 argument(s), got 0")

-- | The string arguments among `vs`, used as block-param binding names.
bindingNames :: Array Value -> Array String
bindingNames = Array.mapMaybe case _ of
  VString s -> Just s
  _ -> Nothing

-- | Expose the *enclosing* frame's loop data under `parent-*` names, so a body
-- | one level in can read it — this is what surface `@../index`, `@../key`,
-- | `@../first`, `@../last` desugar to (one `../` level; just as `parent`
-- | exposes the enclosing *context*). Each name rebinds the enclosing helper
-- | directly (a snapshot `constOperation`), and is omitted when the enclosing frame
-- | has none (e.g. `each` not nested in another `each`).
parentData :: forall m. Ctl m (RefEnv m) -> Array (Tuple String (Operation m (RefEnv m)))
parentData ctl =
  Array.mapMaybe rebind
    [ Tuple "parent-index" "index"
    , Tuple "parent-key" "key"
    , Tuple "parent-first" "first"
    , Tuple "parent-last" "last"
    ]
  where
  rebind (Tuple newName srcName) = Tuple newName <$> lookupOperation srcName ctl.env

iterate
  :: forall m
   . MonadThrow Error m
  => Ctl m (RefEnv m)
  -> Array String
  -> Array { val :: Value, key :: Value, idx :: Value }
  -> m Value
iterate ctl names items =
  let
    main = mainBody ctl
    n = Array.length items
    -- block params bind, in order, the element value and its index/key.
    binds val idx = Array.zipWith (\nm v -> Tuple nm (constOperation v)) names [ val, idx ]
    renderItem i { val, key, idx } =
      let
        frame = Map.fromFoldable
          ( [ Tuple "this" (constOperation val)
            , Tuple "index" (constOperation (VNumber (Int.toNumber i)))
            -- `key` is the object property name when iterating an object, and
            -- `null` for an array (Handlebars parity: `@key` is object-only; use
            -- `index0` for the array position). See loopvars-linter-spec §A.1.
            , Tuple "key" (constOperation key)
            , Tuple "first" (constOperation (VBool (i == 0)))
            , Tuple "last" (constOperation (VBool (i == n - 1)))
            , Tuple "parent" (constOperation (refContext ctl.env))
            -- The richer loop metadata (MaxBars' bare loop variables). These are
            -- exposed for every dialect's `each`, but only MaxBars' surface names
            -- them: FullBars reaches scoped vars solely through the `@` sigil and
            -- never emits these, so its behaviour is unchanged. `index0` mirrors
            -- `index`; arithmetic is normative so interpreter and compiler agree.
            , Tuple "index0" (constOperation (VNumber (Int.toNumber i)))
            , Tuple "index1" (constOperation (VNumber (Int.toNumber (i + 1))))
            , Tuple "rindex0" (constOperation (VNumber (Int.toNumber (n - 1 - i))))
            , Tuple "rindex1" (constOperation (VNumber (Int.toNumber (n - i))))
            , Tuple "length" (constOperation (VNumber (Int.toNumber n)))
            ] <> parentData ctl <> binds val idx
          )
      in
        ctl.render (pushFrame frame val ctl.env) main
  in
    (VSafe <<< joinWith "") <$> traverse identity (Array.mapWithIndex renderItem items)

-- | `with ctx [name]`: an optional trailing string argument is a block param
-- | (surface `as |name|`) bound to the shifted context.
withH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
withH ctl args = case Array.uncons args of
  Just { head: v, tail: rest } ->
    if truthy (refFalsy ctl.env) v then
      let
        binds = Array.zipWith (\nm val -> Tuple nm (constOperation val)) (bindingNames rest) [ v ]
        frame = Map.fromFoldable
          ( [ Tuple "parent" (constOperation (refContext ctl.env)) ]
              <> parentData ctl
              <> binds
          )
      in
        renderSafe ctl (pushFrame frame v ctl.env) (mainBody ctl)
    else renderElse ctl
  Nothing -> throwError (ArityError "with: expected at least 1 argument(s), got 0")

--------------------------------------------------------------------------------
-- Composition / data
--------------------------------------------------------------------------------

dictH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
dictH _ args = build args Map.empty
  where
  build as acc = case Array.uncons as of
    Nothing -> pure (VObject acc)
    Just { head: VString k, tail } -> case Array.uncons tail of
      Just { head: v, tail: rest } -> build rest (Map.insert k v acc)
      Nothing -> throwError (ArityError "dict: odd number of arguments")
    Just _ -> throwError (TypeError "dict: keys must be strings")

applyH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
applyH ctl args = case Array.uncons args of
  Just { head: VString name, tail } -> case lookupOperation name ctl.env of
    Just h -> h ctl tail
    Nothing -> throwError (UnknownHelper name)
  _ -> throwError (TypeError "apply: first argument must be a helper-name string")

-- | `partial name ctx [opts]`: render the named partial template with `ctx` as
-- | the new context, emitting *unescaped* markup. An optional third argument is
-- | a hash `dict` (surface `{{> name k=v}}`) whose keys are merged onto the
-- | context, overriding it (Handlebars' `options.hash`). The name is a (possibly
-- | computed) string; the body comes from the env's partial registry.
-- |
-- | When called as a *block* (`{{#partial name}}body{{/partial}}`) the body is
-- | the fallback rendered if the partial is missing, and is also exposed inside
-- | the partial as the scoped `partial-block` helper (surface `{{> @partial-block}}`).
partialH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
partialH ctl args = case args of
  [ VString name, ctx ] -> renderPartial name ctx
  [ VString name, ctx, opts ] -> renderPartial name (mergeHash ctx opts)
  _ -> throwError (TypeError "partial: expected (name string, context, [options])")
  where
  -- the caller's block body, rendered in the caller's context — exposed inside
  -- the partial as `partial-block`. Only installed when there is a body.
  blockFrame =
    if Array.null ctl.children then Map.empty
    else Map.singleton "partial-block" (\_ _ -> VSafe <$> ctl.render ctl.env ctl.children)
  -- a partial renders under its own truthiness mode if it declared one (external
  -- partial); otherwise it inherits the current file's mode (inline partial).
  -- Scoping is lexical and never inherited across an external boundary (§5).
  renderPartial name ctx = case lookupPartial name ctl.env of
    Just tmpl
      | refDepth ctl.env >= recursionBudget -> throwError (RecursionLimit recursionBudget)
      | otherwise ->
          let
            -- increment the partial depth so a cyclic partial chain hits the
            -- budget instead of overflowing the stack (threaded like pushFrame).
            entered = enterPartial (pushFrame blockFrame ctx ctl.env)
            scoped = case lookupPartialFalsy name ctl.env of
              Just fs -> withFalsy fs entered
              Nothing -> entered
          in
            VSafe <$> ctl.render scoped tmpl
    Nothing
      | Array.null ctl.children -> throwError (HelperError ("unknown partial '" <> name <> "'"))
      | otherwise -> VSafe <$> ctl.render ctl.env ctl.children -- block body is the fallback
  -- hash keys override the context; with a non-object context the hash *is* the
  -- context (so `{{> nav title=…}}` works even at top level with no data).
  mergeHash ctx opts = case opts of
    VObject o -> case ctx of
      VObject c -> VObject (Map.union o c)
      _ -> VObject o
    _ -> ctx

-- | `inline` defines a partial (`{{#inline "name"}}body{{/inline}}`). The
-- | definition is hoisted into the partial registry *before* rendering (see
-- | `FullBars.Surface.hoistInline`), so at render time the block itself emits
-- | nothing.
inlineH :: forall m. Applicative m => Operation m (RefEnv m)
inlineH _ _ = pure (VSafe "")
