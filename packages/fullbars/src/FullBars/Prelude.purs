-- | The reference engine's helpers and schema. See
-- | `docs/modules/ROOT/pages/prelude.adoc`.
-- |
-- | *None of this is built into the core.* Helpers are `Helper m (RefEnv m)`
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
-- | `BareBars.Helper` combinators (arity enforced by construction); block and
-- | bespoke helpers are written directly against `Helper`.
module FullBars.Prelude
  ( prelude
  , preludeSchema
  ) where

import Prelude

import BareBars.Engine (Ctl, Helper)
import BareBars.Error (Error(..))
import BareBars.Helper (ArgSpec, atLeast, binary, nullary, unary)
import BareBars.Syntax (Template)
import BareBars.Value (Value(..))
import BareBars.Walk (Arity(..), Clause, Schema, splitClauses)
import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Array as Array
import Data.Either (Either)
import Data.Int as Int
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.Set as Set
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FullBars.Env (RefEnv, constHelper, liftEither, lookupHelper, lookupPartial, pushFrame, refContext, refFalsy)
import FullBars.Value (FalsySet, FalsyShape(..), escapeHtml, handlebars, jsonStringify, jsonStringifyPretty, stringify, truthy)

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
  , run :: Helper m (RefEnv m)
  }

-- | A non-block value helper built from a `BareBars.Helper` combinator. The
-- | combinator pins the arity, so the schema entry below is derived from the
-- | very guard the runtime uses.
valDef :: forall m. MonadThrow Error m => String -> (String -> ArgSpec m (RefEnv m)) -> HelperDef m
valDef name mk =
  let
    s = mk name
  in
    { name, block: false, arity: s.arity, run: s.run }

-- | A block or bespoke helper written directly against `Helper`, with its arity
-- | declared explicitly (and enforced inside the helper body).
gen :: forall m. String -> Boolean -> Arity -> Helper m (RefEnv m) -> HelperDef m
gen name block arity run = { name, block, arity, run }

helperDefs :: forall m. MonadThrow Error m => Array (HelperDef m)
helperDefs =
  [ gen "this" false (Exactly 0) thisH
  , gen "lookup" false (AtLeast 1) lookupH
  , valDef "true" (nullary (pure (VBool true)))
  , valDef "false" (nullary (pure (VBool false)))
  , valDef "null" (nullary (pure VNull))
  , valDef "esc_html" (unary escHtml)
  , valDef "safe" (unary safe)
  , gen "json" false (Between 1 2) jsonH
  , gen "esc_json" false (Between 1 2) escJsonH
  , gen "raw" true AnyArity rawH
  , gen "if" true (Between 1 2) ifH
  , gen "unless" true (Between 1 2) unlessH
  , gen "each" true (AtLeast 1) eachH
  , gen "with" true (AtLeast 1) withH
  , valDef "else" (nullary (pure (VSafe "")))
  , valDef "elif" (unary (\_ -> pure (VSafe "")))
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
  , gen "not" false (Exactly 1) notH
  , gen "and" false AnyArity (boolH Array.all)
  , gen "or" false AnyArity (boolH Array.any)
  , valDef "log" (atLeast 1 (const (pure VNull)))
  ]

-- | The registry: name → runtime helper.
prelude :: forall m. MonadThrow Error m => Array (Tuple String (Helper m (RefEnv m)))
prelude = map (\d -> Tuple d.name d.run) helperDefs

-- | The reference engine's validation schema (`BareBars.Walk.validate`),
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
      (scoped <> map toSpec (helperDefs :: Array (HelperDef (Either Error))))
  }
  where
  toSpec d = Tuple d.name { block: d.block, arity: d.arity }
  scoped =
    [ Tuple "root" { block: false, arity: Exactly 0 }
    , Tuple "parent" { block: false, arity: Between 0 1 }
    , Tuple "index" { block: false, arity: Exactly 0 }
    , Tuple "key" { block: false, arity: Exactly 0 }
    , Tuple "first" { block: false, arity: Exactly 0 }
    , Tuple "last" { block: false, arity: Exactly 0 }
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

-- | `esc_html`: HTML-escape a value; idempotent on already-safe input.
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
jsonH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
jsonH _ args = VString <$> jsonText "json" args

-- | `esc_json x [opts]`: the JSON analogue of `esc_html` — serialize to JSON
-- | *and* HTML-escape, returning `VSafe`, for embedding JSON safely in HTML
-- | (e.g. an attribute). `esc_html` is idempotent on the result, so surface
-- | escaping does not double up. Accepts the same `pretty=true` option.
escJsonH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
escJsonH _ args = (VSafe <<< escapeHtml) <$> jsonText "esc_json" args

-- | Serialize the first argument as JSON, compact by default or pretty when an
-- | optional second *options object* carries `pretty: true` (built by the
-- | surface hash, `pass:[pretty=true]`). Shared by `json` and `esc_json`.
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

-- | `not`: logical negation under the *active* truthiness mode (`ctl.env`).
notH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
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
  -> Helper m (RefEnv m)
boolH quant ctl args = pure (VBool (quant (truthy (refFalsy ctl.env)) args))

--------------------------------------------------------------------------------
-- Context & access
--------------------------------------------------------------------------------

thisH :: forall m. Applicative m => Helper m (RefEnv m)
thisH ctl _ = pure (refContext ctl.env)

lookupH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
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
rawH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
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
ifH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
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
    "elif" -> case cl.args of
      [ condE ] -> do
        cond <- ctl.eval ctl.env condE
        if truthy (refFalsy ctl.env) cond then renderSafe ctl ctl.env cl.body
        else pickClause ctl tail
      _ -> throwError (ClauseError "elif: expected exactly 1 argument")
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
      _ -> throwError (ClauseError "elif: expected exactly 1 argument")
    other -> throwError (ClauseError ("if: unexpected clause '" <> other <> "'"))

unlessH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
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
eachH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
eachH ctl args = case Array.uncons args of
  Just { head: coll, tail: rest } ->
    let
      names = bindingNames rest
    in
      case coll of
        VArray xs ->
          if Array.null xs then renderElse ctl
          else iterate ctl names
            (Array.mapWithIndex (\i x -> { val: x, key: show i, idx: VNumber (Int.toNumber i) }) xs)
        VObject m ->
          let
            pairs = Map.toUnfoldable m :: Array (Tuple String Value)
          in
            if Array.null pairs then renderElse ctl
            else iterate ctl names (map (\(Tuple k v) -> { val: v, key: k, idx: VString k }) pairs)
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
-- | directly (a snapshot `constHelper`), and is omitted when the enclosing frame
-- | has none (e.g. `each` not nested in another `each`).
parentData :: forall m. Ctl m (RefEnv m) -> Array (Tuple String (Helper m (RefEnv m)))
parentData ctl =
  Array.mapMaybe rebind
    [ Tuple "parent-index" "index"
    , Tuple "parent-key" "key"
    , Tuple "parent-first" "first"
    , Tuple "parent-last" "last"
    ]
  where
  rebind (Tuple newName srcName) = Tuple newName <$> lookupHelper srcName ctl.env

iterate
  :: forall m
   . MonadThrow Error m
  => Ctl m (RefEnv m)
  -> Array String
  -> Array { val :: Value, key :: String, idx :: Value }
  -> m Value
iterate ctl names items =
  let
    main = mainBody ctl
    n = Array.length items
    -- block params bind, in order, the element value and its index/key.
    binds val idx = Array.zipWith (\nm v -> Tuple nm (constHelper v)) names [ val, idx ]
    renderItem i { val, key, idx } =
      let
        frame = Map.fromFoldable
          ( [ Tuple "this" (constHelper val)
            , Tuple "index" (constHelper (VNumber (Int.toNumber i)))
            , Tuple "key" (constHelper (VString key))
            , Tuple "first" (constHelper (VBool (i == 0)))
            , Tuple "last" (constHelper (VBool (i == n - 1)))
            , Tuple "parent" (constHelper (refContext ctl.env))
            ] <> parentData ctl <> binds val idx
          )
      in
        ctl.render (pushFrame frame val ctl.env) main
  in
    (VSafe <<< joinWith "") <$> traverse identity (Array.mapWithIndex renderItem items)

-- | `with ctx [name]`: an optional trailing string argument is a block param
-- | (surface `as |name|`) bound to the shifted context.
withH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
withH ctl args = case Array.uncons args of
  Just { head: v, tail: rest } ->
    if truthy (refFalsy ctl.env) v then
      let
        binds = Array.zipWith (\nm val -> Tuple nm (constHelper val)) (bindingNames rest) [ v ]
        frame = Map.fromFoldable
          ( [ Tuple "parent" (constHelper (refContext ctl.env)) ]
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

dictH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
dictH _ args = build args Map.empty
  where
  build as acc = case Array.uncons as of
    Nothing -> pure (VObject acc)
    Just { head: VString k, tail } -> case Array.uncons tail of
      Just { head: v, tail: rest } -> build rest (Map.insert k v acc)
      Nothing -> throwError (ArityError "dict: odd number of arguments")
    Just _ -> throwError (TypeError "dict: keys must be strings")

applyH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
applyH ctl args = case Array.uncons args of
  Just { head: VString name, tail } -> case lookupHelper name ctl.env of
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
partialH :: forall m. MonadThrow Error m => Helper m (RefEnv m)
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
  renderPartial name ctx = case lookupPartial name ctl.env of
    Just tmpl -> VSafe <$> ctl.render (pushFrame blockFrame ctx ctl.env) tmpl
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
inlineH :: forall m. Applicative m => Helper m (RefEnv m)
inlineH _ _ = pure (VSafe "")
