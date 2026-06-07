-- | The reference engine's helpers and schema. See
-- | `docs/modules/ROOT/pages/prelude.adoc`.
-- |
-- | *None of this is built into the core.* Helpers are `Operation m (RefEnv m)`
-- | over any `MonadThrow Error m`, so the very same prelude runs in a pure host
-- | (`Either Error`) or an async one (`ExceptT Error Aff`). Multi-branch control
-- | flow uses `{{else}}` separators; `if`/`each`/`with` split their body at the
-- | `{{else}}` marker via the control handle's `clause`.
-- |
-- | Helpers are declared *once* in `operationDefs` — each entry carries its name,
-- | whether it is a block helper, and its arity alongside the runtime function.
-- | `prelude` (the registry) and `preludeSchema` (the validator) are both
-- | *projections* of that one table, so a helper's runtime arity and its
-- | validated arity can never drift. Value helpers are built from the
-- | `Kernel.Operation` combinators (arity enforced by construction); block and
-- | bespoke helpers are written directly against `Operation`.
module Kernel.Prelude
  ( OperationDef
  , operationDefs
  , prelude
  , preludeSchema
  , preludeAliases
  , preludeSynonyms
  , scopedDocs
  , scopedCanonical
  , loopFieldCanonical
  , blockHelperNames
  , preludeUnaryHelpers
  , coreOperationDefs
  , primitiveOperationDefs
  , coreSchema
  , sectionableValueNames
  , lenientResolve
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
import Data.String (Pattern(..), Replacement(..))
import Data.String as String
import Data.String.CodeUnits as CodeUnits
import Data.String.Common (joinWith, toLower, toUpper)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error(..))
import FlatBars.Syntax (Ident, Template)
import FlatBars.Value (Value(..))
import Kernel.Engine (Ctl, Operation)
import Kernel.Env (RefEnv, constOperation, enterPartial, liftEither, lookupOperation, lookupPartial, pushFrame, recursionBudget, refContext, refDepth, refTranslator, refTruthy, refYieldName)
import Kernel.Operation (ArgSpec, atLeast, binary, nullary, unary)
import Kernel.Value (escapeHtml, handlebars, jsonStringify, jsonStringifyPretty, stringify)
import Kernel.Walk (Arity(..), Clause, Schema, splitClauses)

--------------------------------------------------------------------------------
-- The single source of truth
--------------------------------------------------------------------------------

-- | One helper's full declaration: its name, whether it opens a block, its
-- | arity, and the runtime function. `prelude` and `preludeSchema` below are
-- | projections of `operationDefs`, so the two never disagree.
type OperationDef m =
  { name :: String
  -- | A one-line, prose description of what the operation does, in the present
  -- | tense — the single source the editor surfaces on hover and the helper
  -- | catalog renders (`FullBars.Catalog`). Required (set via `valDef`/`gen`), so
  -- | an operation cannot ship undocumented. Keep it one sentence; the long-form
  -- | reference prose lives in `prelude.adoc`.
  , doc :: String
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
valDef
  :: forall m
   . MonadThrow Error m
  => String
  -> String
  -> (String -> ArgSpec m (RefEnv m))
  -> OperationDef m
valDef name doc mk =
  let
    s = mk name
  in
    { name, doc, block: false, arity: s.arity, run: s.run, alias: Nothing, synonymOf: Nothing }

-- | A block or bespoke helper written directly against `Operation`, with its arity
-- | declared explicitly (and enforced inside the helper body).
gen :: forall m. String -> String -> Boolean -> Arity -> Operation m (RefEnv m) -> OperationDef m
gen name doc block arity run = { name, doc, block, arity, run, alias: Nothing, synonymOf: Nothing }

-- | Mark a helper definition as a (warned, lifted) deprecation alias of `canonical`.
withAlias :: forall m. String -> OperationDef m -> OperationDef m
withAlias canonical d = d { alias = Just canonical }

-- | Mark a helper as a canonical synonym of `canonical` — an endorsed, equal
-- | alternative, labelled in the catalog but never warned or rewritten.
withSynonym :: forall m. String -> OperationDef m -> OperationDef m
withSynonym canonical d = d { synonymOf = Just canonical }

-- | The complete reference roster: the core helpers (control flow, access,
-- | arithmetic, …) followed by the *separable* value-primitive pack. Splitting
-- | the table — `operationDefs = coreOperationDefs <> primitiveOperationDefs` — keeps the
-- | primitives a genuinely detachable set (a registry/schema built from
-- | `coreOperationDefs` alone does not know `uppercase`), without introducing a
-- | pack-assembly abstraction.
operationDefs :: forall m. MonadThrow Error m => Array (OperationDef m)
operationDefs = coreOperationDefs <> primitiveOperationDefs

-- | The core helpers — everything that is not a value primitive.
coreOperationDefs :: forall m. MonadThrow Error m => Array (OperationDef m)
coreOperationDefs =
  [ gen "this" "The current context." false (Exactly 0) thisH
  , gen "lookup" "Indexes a value by each key or index in turn, returning null at the first miss."
      false
      (AtLeast 1)
      lookupH
  , gen "t"
      "Translates a message key via the host's i18n callback; returns the key unchanged when no translator is registered (ADR-029 fallback-and-flag)."
      false
      (AtLeast 1)
      translateH
  , gen "number"
      "Formats a number for the host's locale (Intl.NumberFormat); returns the number's plain text when no host formatter is registered (ADR-029)."
      false
      (AtLeast 1)
      numberH
  , gen "date"
      "Formats a date value for the host's locale (Intl.DateTimeFormat); returns the value's plain text when no host formatter is registered (ADR-029)."
      false
      (AtLeast 1)
      dateH
  , gen "selectPlural"
      "Returns the CLDR plural category for a number in the host's locale; falls back to the English one/other rule when no host rule is registered (ADR-029)."
      false
      (AtLeast 1)
      selectPluralH
  , gen "relative"
      "Formats a relative time (value, unit) for the host's locale (Intl.RelativeTimeFormat); falls back to a plain English phrasing when no host formatter is registered (ADR-029)."
      false
      (AtLeast 2)
      relativeH
  , valDef "true" "The boolean literal true." (nullary (pure (VBool true)))
  , valDef "false" "The boolean literal false." (nullary (pure (VBool false)))
  , valDef "null" "The null literal." (nullary (pure VNull))
  -- escaping (camelCase canonical names; no snake_case aliases).
  , valDef "escapeHtml"
      "HTML-escapes its argument and marks it safe; idempotent on already-safe values."
      (unary escHtml)
  , valDef "safe" "Marks its argument as safe (trusted) markup, without escaping." (unary safe)
  , gen "json" "Serializes its argument as JSON text (optionally pretty-printed)." false
      (Between 1 2)
      jsonH
  , gen "escapeJson"
      "Serializes its argument as JSON and HTML-escapes it, for safe embedding in HTML."
      false
      (Between 1 2)
      escJsonH
  , gen "raw" "A raw block that returns its body verbatim, untouched by the engine." true AnyArity
      rawH
  , gen "if" "Renders its body when the condition is truthy, else the {{elif}}/{{else}} clauses."
      true
      (Between 1 2)
      ifH
  , gen "unless" "Renders its body when the condition is falsy — the inverse of if." true
      (Between 1 2)
      unlessH
  , gen "each" "Iterates an array or object, installing the loop's scoped variables per item." true
      (AtLeast 1)
      eachH
  , gen "with" "Shifts the context to its argument for the body (else the {{else}} clause)." true
      (AtLeast 1)
      withH
  , valDef "else" "A clause separator the enclosing block splits on; renders nothing on its own."
      (nullary (pure (VSafe "")))
  -- `elif cond [opts]`: a clause marker (its body/condition are handled by the
  -- enclosing `if` via splitClauses). The optional 2nd arg is an options object
  -- (surface hash `includeZero=true`), exactly like `if`'s — so the schema admits
  -- 1 or 2 args; the marker itself renders nothing.
  , gen "elif" "An else-if clause the enclosing if evaluates; renders nothing on its own." false
      (Between 1 2)
      (\_ _ -> pure (VSafe ""))
  , gen "dict" "Builds an object from alternating key/value arguments (the hash target)." false
      AnyArity
      dictH
  , gen "apply" "Calls a helper named by a string argument with the remaining arguments." true
      (AtLeast 1)
      applyH
  , gen "partial"
      "Renders a registered partial; the context defaults to the current one, options are an optional hash, and a block body is the fallback."
      false
      (Between 1 3)
      partialH
  , gen "inline" "Defines a partial from its body, hoisted before rendering; emits nothing." true
      (AtLeast 1)
      inlineH
  , valDef "eq" "True when its two arguments are equal." (binary eq')
  , valDef "ne" "True when its two arguments are not equal." (binary ne')
  , valDef "lt" "True when the first argument is less than the second." (binary (cmp (_ == LT)))
  , valDef "gt" "True when the first argument is greater than the second." (binary (cmp (_ == GT)))
  , valDef "lte" "True when the first argument is less than or equal to the second."
      (binary (cmp (_ /= GT)))
  , valDef "gte" "True when the first argument is greater than or equal to the second."
      (binary (cmp (_ /= LT)))
  -- `isnt` reads as "is not" — a canonical synonym of `ne` (endorsed and equal),
  -- NOT a warned alias. See the two-bucket policy on `OperationDef`.
  , withSynonym "ne" (valDef "isnt" "True when its two arguments are not equal." (binary ne'))
  , gen "not" "Logical negation of its argument's truthiness." false (Exactly 1) notH
  , gen "and" "True when every argument is truthy." false AnyArity (boolH Array.all)
  , gen "or" "True when any argument is truthy." false AnyArity (boolH Array.any)
  -- arithmetic: the desugar targets of the MaxBars `+ - * / %` operators, also
  -- callable explicitly in RawBars/FullBars (`(add a b)`). Strictly numeric:
  -- both operands must be `VNumber` (no string coercion — determinism), so the
  -- interpreter (which is itself JS) and the compiled runtime share JS's `+ - * /`
  -- bit-for-bit; `modulo` uses the `trunc` form, which equals JS `%`.
  , valDef "add" "Adds two numbers — the `+` operator's helper." (binary (arith (+)))
  , valDef "subtract" "Subtracts the second number from the first — the `-` operator's helper."
      (binary (arith (-)))
  , valDef "multiply" "Multiplies two numbers — the `*` operator's helper." (binary (arith (*)))
  , valDef "divide" "Divides the first number by the second — the `/` operator's helper."
      (binary (arith (/)))
  , valDef "modulo"
      "The remainder of dividing the first number by the second — the `%` operator's helper."
      (binary (arith jsMod))
  -- handlebars-helpers aliases: render identically to the canonical helpers
  -- (`add`/`subtract`/`multiply`); marked as aliases so the catalog flags them,
  -- the alias lint warns, and the lift normalises them to the `+ - *` operators.
  , withAlias "add" (valDef "plus" "Adds two numbers." (binary (arith (+))))
  , withAlias "subtract"
      (valDef "minus" "Subtracts the second number from the first." (binary (arith (-))))
  , withAlias "multiply" (valDef "times" "Multiplies two numbers." (binary (arith (*))))
  -- null-coalescing: the desugar target of `??`. Returns the first non-`VNull`
  -- argument (else `VNull`). Distinct from truthiness — `0`/`""`/`[]` pass.
  , gen "coalesce" "Returns the first non-null argument — the `??` operator's helper." false
      (AtLeast 1)
      coalesceH
  -- truthy-coalescing: the desugar target of `?:` (Elvis). Returns the first
  -- argument truthy under the engine's rule (so `""`/`[]`/`0`-by-rule are skipped),
  -- distinct from `coalesce` (null only) and `or` (boolean).
  , gen "firstTruthy" "Returns the first truthy argument — the `?:` (Elvis) operator's helper."
      false
      (AtLeast 1)
      firstTruthyH
  -- the desugar target of the ternary `cond ? a : b`. Returns `a` when `cond` is
  -- truthy under the engine's rule, else `b` — an inline conditional, distinct
  -- from the `{{#if}}` block.
  , gen "ternary"
      "Returns the 2nd argument when the 1st is truthy, else the 3rd — the `? :` ternary operator's helper."
      false
      (Exactly 3)
      ternaryH
  , valDef "log" "Logs its arguments to the host and returns null." (atLeast 1 (const (pure VNull)))
  ]

-- | The value-primitive pack (helper-packs-spec §4) — the *separable* batch.
-- | These are pure transforms: subject-first (the value being transformed is
-- | argument 0), string-coercing their subject/string args via the engine's
-- | `stringify` (so `pass:[{{ uppercase n }}]` works on a number) and reading
-- | numeric args (`slice`/`truncate`) as numbers, and they return a plain
-- | `VString` (not `VSafe`) — escaping stays the output layer's job. Operations
-- | are on **code units** so the interpreter and the compiled JS runtime agree
-- | on indices and length bit-for-bit (gated by `test:compile`).
primitiveOperationDefs :: forall m. MonadThrow Error m => Array (OperationDef m)
primitiveOperationDefs =
  -- case
  [ valDef "lowercase" "Lowercases its argument." (unary (strUnary toLower))
  , valDef "uppercase" "Uppercases its argument." (unary (strUnary toUpper))
  , valDef "capitalize" "Uppercases the first character of its argument."
      (unary (strUnary capitalizeStr))
  -- whitespace
  , valDef "trim" "Removes leading and trailing whitespace." (unary (strUnary String.trim))
  , valDef "trimStart" "Removes leading whitespace." (unary (strUnary trimStartStr))
  , valDef "trimEnd" "Removes trailing whitespace." (unary (strUnary trimEndStr))
  -- substring & membership
  , valDef "split" "Splits a string into an array on a separator." (binary splitH)
  , gen "replace" "Replaces every occurrence of a substring with another." false (Exactly 3)
      replaceH
  , gen "slice" "Returns a substring from a start index to an optional end index." false
      (Between 2 3)
      sliceH
  , valDef "includes" "True when the subject string or array contains the given value."
      (binary includesH)
  , valDef "startsWith" "True when the string starts with the given prefix." (binary startsWithH)
  , valDef "endsWith" "True when the string ends with the given suffix." (binary endsWithH)
  , gen "truncate" "Shortens a string to a maximum length, appending an optional ellipsis." false
      (Between 2 3)
      truncateH
  -- concatenation
  , valDef "append" "Appends the second string to the first." (binary appendH)
  , valDef "prepend" "Prepends the second string to the first." (binary prependH)
  -- case aliases (handlebars-helpers parity): render identically to the
  -- canonical case helpers, reusing the very same `strUnary` transform.
  , withAlias "lowercase" (valDef "downcase" "Lowercases its argument." (unary (strUnary toLower)))
  , withAlias "uppercase" (valDef "upcase" "Uppercases its argument." (unary (strUnary toUpper)))
  -- number pack
  , valDef "abs" "The absolute value of a number." (unary (numUnary Number.abs))
  , valDef "floor" "Rounds a number down to the nearest integer." (unary (numUnary Number.floor))
  , valDef "ceil" "Rounds a number up to the nearest integer." (unary (numUnary Number.ceil))
  , valDef "round" "Rounds a number to the nearest integer." (unary (numUnary Number.round))
  , valDef "toFixed" "Formats a number with a fixed number of decimal places." (binary toFixedH)
  , valDef "toInt" "Parses its argument as an integer." (unary toIntH)
  , valDef "toFloat" "Parses its argument as a floating-point number." (unary toFloatH)
  -- array pack
  , valDef "join" "Joins an array into a string with a separator." (binary joinH)
  , valDef "count" "The number of items in an array (or characters in a string)." (unary countH)
  -- `size` ≡ `count`: a canonical synonym (not a deprecation alias) — labelled
  -- in the catalog, never warned.
  , withSynonym "count"
      (valDef "size" "The number of items in an array (or characters in a string)." (unary countH))
  , valDef "at" "The element at an index (negative counts from the end)." (binary atH)
  , valDef "take" "The first n elements of an array." (binary takeH)
  , valDef "takeRight" "The last n elements of an array." (binary takeRightH)
  , valDef "reverse" "Reverses an array or string." (unary reverseH)
  , valDef "unique" "The array with duplicate elements removed." (unary uniqueH)
  , valDef "sortBy" "Sorts an array of objects by a key." (binary sortByH)
  , valDef "pluck" "Extracts a key's value from each object in an array." (binary pluckH)
  , valDef "groupBy" "Groups an array of objects into an object keyed by a field." (binary groupByH)
  ]

-- | The registry: name → runtime helper.
prelude :: forall m. MonadThrow Error m => Array (Tuple String (Operation m (RefEnv m)))
prelude = map (\d -> Tuple d.name d.run) operationDefs

-- | The alias table — each alias name → its canonical name — projected from
-- | `operationDefs.alias` (the single source of truth). The catalog marks these
-- | ("alias of …"), the on-demand alias lint warns on their use, and the
-- | lift/migrate assist rewrites them. E.g. `plus → add`, `downcase → lowercase`.
preludeAliases :: Array (Tuple String String)
preludeAliases =
  Array.mapMaybe (\d -> Tuple d.name <$> d.alias)
    (operationDefs :: Array (OperationDef (Either Error)))

-- | The synonym table — each canonical synonym → its primary name — projected
-- | from `operationDefs.synonymOf`. Unlike aliases these are NOT deprecated: the
-- | catalog labels them ("synonym of …"), but the lint never warns and the lift
-- | never rewrites them. E.g. `isnt → ne`, `size → count`.
preludeSynonyms :: Array (Tuple String String)
preludeSynonyms =
  Array.mapMaybe (\d -> Tuple d.name <$> d.synonymOf)
    (operationDefs :: Array (OperationDef (Either Error)))

-- | The names of *value* (non-block) helpers whose arity admits a **single
-- | argument** — `Exactly 1` or `Between 1 n`. This is the candidate set for the
-- | linter's pipe re-sugaring (`(f a)` → `a | f`): every unary value transform
-- | (`uppercase`, `trim`, `abs`, `count`, `json`, …) qualifies automatically, so
-- | a new primitive becomes pipe-liftable with no change to the linter. The lift
-- | further removes names that own a dedicated surface (the `!`/operator helpers).
preludeUnaryHelpers :: Array String
preludeUnaryHelpers =
  Array.mapMaybe unaryName (operationDefs :: Array (OperationDef (Either Error)))
  where
  unaryName d
    | d.block = Nothing
    | otherwise = case d.arity of
        Exactly 1 -> Just d.name
        Between 1 _ -> Just d.name
        _ -> Nothing

-- | The reference engine's validation schema (`Kernel.Walk.validate`),
-- | projected from `operationDefs` plus the scoped variables below.
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
      (scopedSchema <> map operationSpec (operationDefs :: Array (OperationDef (Either Error))))
  }

-- | The schema for the *core* helpers alone (no value primitives) — used to
-- | demonstrate the primitives' separability: `coreSchema` does not know
-- | `uppercase`, whereas `preludeSchema` does.
coreSchema :: Schema
coreSchema =
  { allowUnknown: false
  , helpers: Map.fromFoldable
      (scopedSchema <> map operationSpec (coreOperationDefs :: Array (OperationDef (Either Error))))
  }

operationSpec :: forall m. OperationDef m -> Tuple String { block :: Boolean, arity :: Arity }
operationSpec d = Tuple d.name { block: d.block, arity: d.arity }

-- | The scoped variables that block helpers install at runtime — the loop state
-- | (`each`), the shifted context (`with`), the block-partial body (`partial`).
-- | They have no standalone runtime so they are not in `operationDefs`, but they
-- | are real names the editor offers, so each carries a one-line `doc` too,
-- | surfaced on hover via `scopedDocs`. `scopedSchema` below projects name + block
-- | + arity for the validator (which ignores the doc).
scopedSpecs :: Array { name :: String, block :: Boolean, arity :: Arity, doc :: String }
scopedSpecs =
  [ { name: "root", block: false, arity: Exactly 0, doc: "The root (top-level) context." }
  , { name: "parent"
    , block: false
    , arity: Between 0 1
    , doc: "The enclosing block's context (chainable)."
    }
  , { name: "loop"
    , block: false
    , arity: Exactly 0
    , doc:
        "The current loop's metadata object: index0/index1/rindex0/rindex1/first/last/key/length, plus the chain links loop.parent (the enclosing loop) and loop.root."
    }
  , { name: "index", block: false, arity: Exactly 0, doc: "The current loop item's 0-based index." }
  , { name: "key"
    , block: false
    , arity: Exactly 0
    , doc: "The current key when iterating an object."
    }
  , { name: "first", block: false, arity: Exactly 0, doc: "True on the loop's first iteration." }
  , { name: "last", block: false, arity: Exactly 0, doc: "True on the loop's last iteration." }
  -- `index0` ≡ `index` (both 0-based). It's a canonical synonym, but scoped
  -- vars carry no synonym marker yet, so the catalog still lists it as "scoped"
  -- rather than "synonym of `index`" — tracked follow-up (extend synonymOf to
  -- scopedSpecs). `index1` is 1-based — a distinct helper, not a synonym.
  , { name: "index0"
    , block: false
    , arity: Exactly 0
    , doc: "The current loop item's 0-based index."
    }
  , { name: "index1"
    , block: false
    , arity: Exactly 0
    , doc: "The current loop item's 1-based index."
    }
  , { name: "rindex0"
    , block: false
    , arity: Exactly 0
    , doc: "The current loop item's 0-based index, counting from the end."
    }
  , { name: "rindex1"
    , block: false
    , arity: Exactly 0
    , doc: "The current loop item's 1-based index, counting from the end."
    }
  , { name: "length"
    , block: false
    , arity: Exactly 0
    , doc: "The number of items in the current loop."
    }
  -- The enclosing loop's fields are reached through the `loop` chain
  -- (`loop.parent.index0`, `loop.parent.key`, …); the flat `parent-index`/
  -- `parent-key`/`parent-first`/`parent-last` names were removed (the lint
  -- migrates them to `loop.parent.*`, and FullBars' `@../index` lowers there).
  , { name: "partial-block"
    , block: false
    , arity: Exactly 0
    , doc:
        "Inside a block partial, the caller's block body — FullBars' {{> @partial-block}} target (RawBars/MaxBars use yield)."
    }
  -- `yield` — the RawBars/MaxBars spelling of the block-partial body (ADR-005
  -- amendment). Hyphen-free so it is writable bare in MaxBars (where `-` is
  -- subtraction). It is NOT a synonym installed alongside `partial-block`: the
  -- partial frame binds only the dialect's own spelling (`refYieldName`), so
  -- `yield` is the body in RawBars/MaxBars and `partial-block` is the body in FullBars.
  , { name: "yield"
    , block: false
    , arity: Exactly 0
    , doc:
        "Inside a block partial, the caller's block body — the RawBars/MaxBars spelling (FullBars uses partial-block)."
    }
  ]

-- | The scoped variables projected to schema entries (name → block + arity); the
-- | validator does not see the doc. Used by `preludeSchema`/`coreSchema`.
scopedSchema :: Array (Tuple String { block :: Boolean, arity :: Arity })
scopedSchema = map (\s -> Tuple s.name { block: s.block, arity: s.arity }) scopedSpecs

-- | Each scoped variable's one-line doc, keyed by name — the editor surfaces it on
-- | hover/completion alongside the registered operations' `OperationDef.doc`.
scopedDocs :: Array (Tuple String String)
scopedDocs = map (\s -> Tuple s.name s.doc) scopedSpecs

-- | Non-canonical scoped-variable spellings → their native RawBars/MaxBars
-- | canonical form: `index` → `index0` (the bare native index), `partial-block` →
-- | `yield` (the bare native block-body name). `index`/`index0` co-exist (both
-- | render, this is editor *preference*); `partial-block`/`yield`, since the
-- | ADR-005 amendment, are the FullBars vs RawBars/MaxBars spellings of the SAME
-- | body and each only binds in its own dialect (`refYieldName`), so in
-- | RawBars/MaxBars `partial-block` does not render at all — the rewrite to `yield`
-- | is the fix, not just a preference. Shared here so the linter
-- | (`Linter.Aliases.scopedCanonWarnings`), the catalog/editor projection
-- | (`FullBars.Catalog.operations` → `editors/operations.json`), and the CLI all
-- | read one source. Surface-scoped: only the native dialects prefer it (FullBars
-- | keeps Handlebars' `@index`/`@partial-block`).
scopedCanonical :: Array (Tuple String String)
scopedCanonical =
  [ Tuple "index" "index0"
  -- the flat enclosing-loop names were REMOVED; migrate to the `loop.parent.*`
  -- chain (the canonical form is a path). The lint is static, so it flags these
  -- identifiers whether or not the removed name still resolves.
  , Tuple "parent-index" "loop.parent.index0"
  , Tuple "parent-key" "loop.parent.key"
  , Tuple "parent-first" "loop.parent.first"
  , Tuple "parent-last" "loop.parent.last"
  , Tuple "partial-block" "yield"
  ]

-- | Each loop-variable spelling (the canonical names + the ADR-006 aliases
-- | `index`/`rindex`/`size`) → its canonical loop field. The single source the
-- | migrate and lift assists share: `Linter.Migrate` emits the bare field
-- | (`@index` → `index0`), `Linter.Lift` the `loop`-scoped surface form
-- | (`(index0)` → `loop.index0`). Defining it once here means a new loop field
-- | updates both assists with no risk of the two tables drifting apart.
loopFieldCanonical :: Array (Tuple String String)
loopFieldCanonical =
  [ Tuple "index" "index0"
  , Tuple "index0" "index0"
  , Tuple "index1" "index1"
  , Tuple "rindex" "rindex0"
  , Tuple "rindex0" "rindex0"
  , Tuple "rindex1" "rindex1"
  , Tuple "first" "first"
  , Tuple "last" "last"
  , Tuple "key" "key"
  , Tuple "length" "length"
  , Tuple "size" "length"
  ]

-- | The names of the prelude's *block* helpers (`d.block`), projected from
-- | `operationDefs` (the single source). `Linter.Migrate`'s ambiguous-section
-- | detector uses it: a bare `{{#name}}` whose name is not a known block helper is
-- | ambiguous (`{{#if name}}` vs `{{#each name}}`?). Deriving it here means a new
-- | block helper propagates to the migrator with no linter edit.
blockHelperNames :: Array String
blockHelperNames =
  Array.mapMaybe (\d -> if d.block then Just d.name else Nothing)
    (operationDefs :: Array (OperationDef (Either Error)))

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
-- | engine's truthiness rule).
coalesceH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
coalesceH _ args = pure (fromMaybe VNull (Array.find notNull args))
  where
  notNull VNull = false
  notNull _ = true

-- | `firstTruthy a b …`: the first argument the engine's truthiness rule (`ctl.env`)
-- | counts as truthy, else `VNull`. The desugar target of the MaxBars `?:` (Elvis)
-- | operator — so `"" ?: name` yields `name` under MaxBars' `nonEmpty` rule, unlike
-- | `??` (which keeps the non-null `""`) and `||` (which yields a boolean).
firstTruthyH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
firstTruthyH ctl args = pure (fromMaybe VNull (Array.find (refTruthy ctl.env) args))

-- | `ternary cond a b`: `a` when `cond` is truthy under the engine's rule
-- | (`ctl.env`), else `b`. The desugar target of the MaxBars ternary
-- | `cond ? a : b` — an inline conditional (distinct from the `{{#if}}` block).
-- | Like the other operator helpers it receives all three arguments already
-- | evaluated (the engine is applicative), so both branches are computed and one
-- | is selected — observably identical for the pure value expressions MaxBars
-- | composes.
ternaryH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
ternaryH ctl args = case args of
  [ cond, t, f ] -> pure (if refTruthy ctl.env cond then t else f)
  _ -> throwError (ArityError "ternary: expected exactly 3 arguments")

-- | `not`: logical negation under the engine's truthiness rule (`ctl.env`).
notH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
notH ctl args = case args of
  [ a ] -> pure (VBool (not (refTruthy ctl.env a)))
  _ -> throwError (ArityError "not: expected exactly 1 argument")

-- | `and`/`or`: fold truthiness across the arguments with the given quantifier,
-- | consulting the engine's truthiness rule — so `{{#if x}}` and `{{x && y}}`
-- | always agree.
boolH
  :: forall m
   . Applicative m
  => ((Value -> Boolean) -> Array Value -> Boolean)
  -> Operation m (RefEnv m)
boolH quant ctl args = pure (VBool (quant (refTruthy ctl.env) args))

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

-- | The blessed i18n operations (ADR-029). FlatBars ships no i18n: the brain is
-- | the host's, seeded as a first-class `Translator` seam (`RefEnv.translator`),
-- | exactly the way truthiness is seeded (ADR-022) — *not* a `registerHelper`
-- | override. The engine reserves the names (so `t`/`number`/`date`/`selectPlural`
-- | are catalogued, schema-validated, and editor-painted) and consults the seeded
-- | translator; with no host wired (`Nothing`) — or when the translator declines a
-- | key (`Nothing`) — it supplies a *pure fallback*: the argument's plain text
-- | (translate returns the key; number/date return the value unformatted). Because
-- | the seam is part of the env, the engine *knows* whether a host is wired, so
-- | analyse mode can flag the unwired calls and the fallback never poses as a real
-- | translation. The fallback is pure, so it renders identically interpreted and
-- | compiled.
translateH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
translateH = i18nOp "t"

numberH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
numberH = i18nOp "number"

dateH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
dateH = i18nOp "date"

-- | Drive a blessed i18n op through the seeded `Translator` (ADR-029): consult it
-- | with the op name + args; on a hit return the localized text, otherwise run the
-- | op's pure `fallback`. Every i18n op is seam-driven this way — so the seam, not
-- | the op identity, decides translated-vs-fallback (interpreter ≡ compiled), and
-- | richer fallbacks (selectPlural/relative) are preserved.
seamed :: forall m. MonadThrow Error m => String -> Operation m (RefEnv m) -> Operation m (RefEnv m)
seamed name fallback ctl args = case refTranslator ctl.env >>= \tr -> tr name args of
  Just s -> pure (VString s)
  Nothing -> fallback ctl args

-- | A blessed i18n op whose fallback is the first argument's plain text
-- | (`t`/`number`/`date`): translate returns the key, number/date the value.
i18nOp :: forall m. MonadThrow Error m => String -> Operation m (RefEnv m)
i18nOp name = seamed name passthrough
  where
  passthrough _ args = case Array.head args of
    Nothing -> throwError (ArityError (name <> ": expected at least 1 argument(s), got 0"))
    Just v -> VString <$> liftEither (stringify v)

-- | `selectPlural` falls back to the English one/other rule (pure, no CLDR data);
-- | a host translator returns the real `Intl.PluralRules` category.
selectPluralH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
selectPluralH = seamed "selectPlural" \_ args -> case Array.head args of
  Nothing -> throwError (ArityError "selectPlural: expected at least 1 argument(s), got 0")
  Just v -> do
    n <- asNum v
    pure (VString (if n == 1.0 then "one" else "other"))

-- | `relative value unit` falls back to a plain English phrasing (pure, no CLDR
-- | data): "N units ago" / "in N units" / "this unit". A host translator returns
-- | the real `Intl.RelativeTimeFormat` output ("yesterday", "wczoraj").
relativeH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
relativeH = seamed "relative" \_ args -> case Array.index args 0, Array.index args 1 of
  Just vv, Just uu -> do
    v <- asNum vv
    unit <- liftEither (stringify uu)
    magStr <- liftEither (stringify (VNumber (Number.abs v)))
    let punit = if Number.abs v == 1.0 then unit else unit <> "s"
    pure $ VString
      if v < 0.0 then magStr <> " " <> punit <> " ago"
      else if v > 0.0 then "in " <> magStr <> " " <> punit
      else "this " <> unit
  _, _ -> throwError
    (ArityError ("relative: expected at least 2 argument(s), got " <> show (Array.length args)))

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
    [ c ] -> pure (refTruthy ctl.env c)
    [ c, opts ] -> pure (truthyWith (refTruthy ctl.env) opts c)
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
          Nothing -> pure (refTruthy ctl.env cond)
          Just optsE -> (\opts -> truthyWith (refTruthy ctl.env) opts cond) <$> ctl.eval ctl.env
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
  [ c ] -> branchOn (not (refTruthy ctl.env c)) ctl
  [ c, opts ] -> branchOn (not (truthyWith (refTruthy ctl.env) opts c)) ctl
  _ -> throwError (ArityError (wrong1or2 "unless" args))

-- | Render the main clause when the condition holds, else the `{{else}}` clause.
branchOn :: forall m. MonadThrow Error m => Boolean -> Ctl m (RefEnv m) -> m Value
branchOn cond ctl = if cond then renderMain ctl else renderElse ctl

wrong1or2 :: String -> Array Value -> String
wrong1or2 name args = name <> ": expected 1 or 2 arguments, got " <> show (Array.length args)

-- | Truthiness under the engine's rule, honoring an options object's
-- | `includeZero` flag as a *per-call exception* (ADR-022): when set, the number
-- | `0` counts as truthy regardless of the engine's rule (a no-op when the rule
-- | already treats `0` as truthy). Re-homed off the old `FalsySet` machinery — it
-- | is now a plain override on top of the engine's `truthy` lambda.
truthyWith :: (Value -> Boolean) -> Value -> Value -> Boolean
truthyWith tf opts v
  | optFlag "includeZero" opts, isZeroNum v = true
  | otherwise = tf v

-- | The number `0` (the only shape `includeZero` overrides).
isZeroNum :: Value -> Boolean
isZeroNum = case _ of
  VNumber n -> n == 0.0
  _ -> false

-- | Read a boolean option from an options object (`VObject`); absent ⇒ false.
optFlag :: String -> Value -> Boolean
optFlag key = case _ of
  VObject m -> maybe false handlebars (Map.lookup key m)
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

-- | The `@parentchain` object backing the reserved `parent` name (ADR-021): the
-- | enclosing context wrapped as a chain — its own data fields, plus `this` (the
-- | enclosing context), `parent` (the enclosing frame's chain, or `VNull`), and
-- | `root` (the outermost context). Reserved fields win over same-named data
-- | fields. Built by every frame-shifting block (`each`/`with`); a body reads
-- | `parent.x`, `parent.parent.x`, `parent.root.x` as ordinary nested lookups.
buildContextChain :: forall m. MonadThrow Error m => Ctl m (RefEnv m) -> m Value
buildContextChain ctl = do
  enclosingChain <- case lookupOperation "@parentchain" ctl.env of
    Just op -> op ctl []
    Nothing -> pure VNull
  let
    enclosingCtx = refContext ctl.env
    ctxFields = case enclosingCtx of
      VObject m -> m
      _ -> Map.empty
    rootCtx = case enclosingChain of
      VObject m -> fromMaybe enclosingCtx (Map.lookup "root" m)
      _ -> enclosingCtx
  pure
    ( VObject
        ( Map.union
            ( Map.fromFoldable
                [ Tuple "this" enclosingCtx, Tuple "parent" enclosingChain, Tuple "root" rootCtx ]
            )
            ctxFields
        )
    )

iterate
  :: forall m
   . MonadThrow Error m
  => Ctl m (RefEnv m)
  -> Array String
  -> Array { val :: Value, key :: Value, idx :: Value }
  -> m Value
iterate ctl names items = do
  -- the enclosing loop's `loop` object (ADR-021), read once — the inner loop
  -- embeds it as `loop.parent`, chaining `loop.parent.parent`/`loop.root`. `VNull`
  -- when this loop is outermost (`with` inherits its enclosing `loop`, so the
  -- chain skips context shifts).
  enclosingLoop <- case lookupOperation "loop" ctl.env of
    Just op -> op ctl []
    Nothing -> pure VNull
  -- the `@parentchain` object: the enclosing context and its own chain, so
  -- `parent`/`parent.parent` (ADR-021) climb. Same for every iteration (it depends
  -- on the enclosing context, not the element), so built once.
  parentChain <- buildContextChain ctl
  let
    main = mainBody ctl
    n = Array.length items
    -- block params bind, in order, the element value and its index/key.
    binds val idx = Array.zipWith (\nm v -> Tuple nm (constOperation v)) names [ val, idx ]
    -- the bare loop variables as fields: `this`/`index0`/…/`length`/`key`. An
    -- immutable per-iteration snapshot; the compiler builds the same object.
    metaFields i val key =
      [ Tuple "this" val
      , Tuple "index0" (VNumber (Int.toNumber i))
      , Tuple "index1" (VNumber (Int.toNumber (i + 1)))
      , Tuple "rindex0" (VNumber (Int.toNumber (n - 1 - i)))
      , Tuple "rindex1" (VNumber (Int.toNumber (n - i)))
      , Tuple "first" (VBool (i == 0))
      , Tuple "last" (VBool (i == n - 1))
      , Tuple "length" (VNumber (Int.toNumber n))
      , Tuple "key" key
      ]
    -- the outermost loop's object, a *shallow* snapshot (no `parent`/`root`) so the
    -- `loop.root` chain terminates without a cycle.
    rootLoop i val key = case enclosingLoop of
      VObject m -> fromMaybe (VObject (Map.fromFoldable (metaFields i val key)))
        (Map.lookup "root" m)
      _ -> VObject (Map.fromFoldable (metaFields i val key))
    -- the `loop`/`label`/`outer` object: metadata + the chain links.
    loopObject i val key = VObject
      ( Map.fromFoldable
          ( metaFields i val key <>
              [ Tuple "parent" enclosingLoop, Tuple "root" (rootLoop i val key) ]
          )
      )
    -- `loop` is bound on every iteration (ADR-021); a `label NAME` (ADR-013) binds
    -- the same object under the chosen name (`outer`). `@parentchain` backs the
    -- reserved `parent` name; it is the same object for every iteration.
    loopBinds i val key =
      [ Tuple "loop" (constOperation (loopObject i val key))
      , Tuple "@parentchain" (constOperation parentChain)
      ]
        <> case ctl.loopLabel of
          Just lbl -> [ Tuple lbl (constOperation (loopObject i val key)) ]
          Nothing -> []
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
            ] <> binds val idx <> loopBinds i val key
          )
      in
        ctl.render (pushFrame frame val ctl.env) main
  (VSafe <<< joinWith "") <$> traverse identity (Array.mapWithIndex renderItem items)

-- | `with ctx [name]`: an optional trailing string argument is a block param
-- | (surface `as |name|`) bound to the shifted context.
withH :: forall m. MonadThrow Error m => Operation m (RefEnv m)
withH ctl args = case Array.uncons args of
  Just { head: v, tail: rest } ->
    if refTruthy ctl.env v then do
      -- `with` is not a loop, so it binds no `loop`; it installs `@parentchain`
      -- (the reserved `parent` chain, ADR-021) and inherits the enclosing `loop`.
      parentChain <- buildContextChain ctl
      let
        binds = Array.zipWith (\nm val -> Tuple nm (constOperation val)) (bindingNames rest) [ v ]
        frame = Map.fromFoldable
          ( [ Tuple "parent" (constOperation (refContext ctl.env))
            , Tuple "@parentchain" (constOperation parentChain)
            ]
              <> binds
          )
      renderSafe ctl (pushFrame frame v ctl.env) (mainBody ctl)
    else renderElse ctl
  Nothing -> throwError (ArityError "with: expected at least 1 argument(s), got 0")

-- | The FullBars *resolve policy* (`Kernel.Env.refEngineWith`), Handlebars-style.
-- | Two cases turn a `{{#x}}…{{/x}}` block into an implicit *section* over data
-- | rather than a helper application:
-- |
-- |   * `x` names no registered helper — Handlebars' `blockHelperMissing`; and
-- |   * `x` names a prelude *value* helper that needs an argument (`count`,
-- |     `uppercase`, …) but is used as a *bare* block (`{{#count}}…{{/count}}`),
-- |     so there is nothing to apply — reading it as data avoids the arity error
-- |     and matches Mustache/Handlebars, where `{{#field}}` is a section.
-- |
-- | Both delegate to `sectionOp`: an array iterates (`each`), a truthy non-array
-- | shifts context and renders once (`with`), a falsy value (or empty array)
-- | renders the `{{else}}` inverse. A genuine block helper (`if`/`each`/`with`/
-- | `unless`/…), a nullary/var-arity value op (`this`/`and`/…), and any
-- | user-registered helper are applied unchanged; an inline value-helper call
-- | (`{{count xs}}`) still runs the real helper. An *inline* unknown application
-- | with arguments (`{{foo bar}}`, no block body) is still a hard `UnknownHelper`,
-- | matching Handlebars' "Missing helper" throw — only the block form is rescued.
lenientResolve
  :: forall m
   . MonadThrow Error m
  => RefEnv m
  -> Ident
  -> Maybe (Operation m (RefEnv m))
  -> m (Operation m (RefEnv m))
lenientResolve _ name = case _ of
  Just h
    | Array.elem name sectionableValueNames -> pure (valueOrSection name h)
    | otherwise -> pure h
  Nothing -> pure (sectionOp name)

-- | A prelude value op runs as itself, EXCEPT in block position with no arguments
-- | (`{{#count}}…{{/count}}`), where it has nothing to apply and is read as a data
-- | section (`sectionOp`) instead — for *any* body, including the empty block
-- | `{{#count}}{{/count}}` (Handlebars renders that as an empty section, not an
-- | arity error). Inline uses (`{{count xs}}`) and block uses *with* arguments
-- | keep calling the real helper.
-- |
-- | `Array.null args` alone is the right signal: a *bare* inline `{{count}}`
-- | desugars to a `lookup` data path (`FullBars.Surface.rewriteHead`) and never
-- | reaches `resolve`/`valueOrSection`, so the only thing that resolves the helper
-- | with no positional args is the **block** form. Hence empty args ⟹ block
-- | position, body or not. (The compiler's emit gates identically — block-only,
-- | no positional args — so the two paths stay byte-identical; `test:compile`.)
valueOrSection
  :: forall m
   . MonadThrow Error m
  => Ident
  -> Operation m (RefEnv m)
  -> Operation m (RefEnv m)
valueOrSection name h ctl args
  | Array.null args = sectionOp name ctl args
  | otherwise = h ctl args

sectionOp :: forall m. MonadThrow Error m => Ident -> Operation m (RefEnv m)
sectionOp name ctl args
  | Array.null ctl.children && not (Array.null args) = throwError (UnknownHelper name)
  | otherwise = case indexValue (refContext ctl.env) (VString name) of
      v@(VArray _) -> eachH ctl [ v ]
      v -> withH ctl [ v ]

-- | The *value* (non-block) helpers that cannot be applied with zero arguments —
-- | `count`, `uppercase`, `eq`, `json`, … (every value op whose arity excludes 0).
-- | Projected from `operationDefs` (the single source). `lenientResolve` reads it:
-- | such a helper used as a bare block (`{{#count}}`) has no argument to apply, so
-- | it is reinterpreted as a data section rather than raising an arity error.
-- | Nullary / var-arity value ops (`this`, `and`, `or`, `coalesce`, …) are *not*
-- | listed — they CAN run with no args, so they keep their block behaviour. The
-- | compiler's emit (`FlatBars.Compile.Emit`) reads the same set, so the
-- | interpreter and compiled paths stay byte-identical (`test:compile`).
sectionableValueNames :: Array String
sectionableValueNames =
  Array.mapMaybe pick (operationDefs :: Array (OperationDef (Either Error)))
  where
  pick d
    | d.block = Nothing
    | arityAdmitsZero d.arity = Nothing
    | otherwise = Just d.name

arityAdmitsZero :: Arity -> Boolean
arityAdmitsZero = case _ of
  Exactly n -> n == 0
  AtLeast n -> n == 0
  Between lo _ -> lo == 0
  AnyArity -> true

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
  -- the context is optional: omitted, it defaults to the *current* context
  -- (like Handlebars `{{> layout}}`), so `{{#partial "layout"}}` / `(partial
  -- "layout")` work in RawBars/MaxBars without spelling out `this`.
  [ VString name ] -> renderPartial name (refContext ctl.env)
  [ VString name, ctx ] -> renderPartial name ctx
  [ VString name, ctx, opts ] -> renderPartial name (mergeHash ctx opts)
  _ -> throwError (TypeError "partial: expected (name string, [context], [options])")
  where
  -- the caller's block body, rendered in the caller's context — exposed inside
  -- the partial under the dialect's own spelling (`refYieldName`): FullBars binds
  -- `partial-block` (Handlebars `{{> @partial-block}}`); RawBars/MaxBars bind the
  -- hyphen-free `yield` (ADR-005 amendment). Only the native name is bound — the
  -- other resolves by the dialect's normal rule (empty under FullBars' lenient
  -- resolve, UnknownHelper under RawBars/MaxBars). Only installed when there is a body.
  blockFrame =
    if Array.null ctl.children then Map.empty
    else
      let
        body _ _ = VSafe <$> ctl.render ctl.env ctl.children
      in
        Map.singleton (refYieldName ctl.env) body
  -- every partial renders under the engine's single truthiness rule (ADR-022):
  -- there is no per-partial mode to switch into anymore.
  renderPartial name ctx = case lookupPartial name ctl.env of
    Just tmpl
      | refDepth ctl.env >= recursionBudget -> throwError (RecursionLimit recursionBudget)
      | otherwise ->
          let
            -- increment the partial depth so a cyclic partial chain hits the
            -- budget instead of overflowing the stack (threaded like pushFrame).
            entered = enterPartial (pushFrame blockFrame ctx ctl.env)
          in
            VSafe <$> ctl.render entered tmpl
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
-- | `Kernel.Hoist.hoistInline`, run by every dialect), so at render time the block
-- | itself emits nothing.
inlineH :: forall m. Applicative m => Operation m (RefEnv m)
inlineH _ _ = pure (VSafe "")
