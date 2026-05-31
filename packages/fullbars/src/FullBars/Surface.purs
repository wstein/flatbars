-- | The FullBars *surface dialect* — a desugaring of Handlebars-flavoured
-- | author syntax into core syntax. See `docs/modules/ROOT/pages/surface.adoc`.
-- |
-- | This is *not* a separate parser (ADR-001): `desugar` is a pure rewrite of
-- | the structural `Template` the one parser already produces, into another
-- | structural `Template` that uses only core forms. The reference renderer (or
-- | `lower`) then runs the result unchanged.
-- |
-- | What it rewrites (surface.adoc §5):
-- |
-- |  * `{{ E }}` (a separator that is not a clause marker) ⇒ escaped output,
-- |    `{{{ esc_html E' }}}`; `{{{ E }}}` stays raw output.
-- |  * a bare/dotted *path* in value position ⇒ a `lookup` chain:
-- |    `name` ⇒ `lookup this "name"`, `a.b` ⇒ `lookup this "a" "b"`,
-- |    `a.1`/`a.[1]` ⇒ `lookup this "a" 1`, `a.[home town]` (bracket segment),
-- |    `a/b` (legacy slash), `this`/`.` ⇒ `this`, `../a` ⇒ `lookup (parent) "a"`.
-- |  * `@data` variables ⇒ scoped-helper calls: `@index` ⇒ `(index)`,
-- |    `@root.x` ⇒ `(lookup (root) "x")` (§5.5).
-- |  * `true`/`false`/`null` stay literal helper calls.
-- |  * `else if` chains ⇒ flat `{{elif cond}}` clauses the engine's `if` reads
-- |    (§5.6).
-- |  * hash arguments `k=v` ⇒ a trailing `dict`: `{{ f a k=v }}` ⇒
-- |    `{{{ esc_html (f (lookup this "a") (dict "k" (lookup this "v"))) }}}` (§5.4).
-- |  * block params `{{#each xs as |item i|}}` ⇒ `{{#each xs "item" "i"}}`; a bare
-- |    reference to an in-scope param becomes a helper call `(item)` (§5.5).
-- |  * `{{> name [ctx] [k=v]}}` ⇒ `{{{ partial "name" ctx [(dict …)] }}}` (a bare
-- |    name is a string literal, a parenthesized expression is a dynamic name;
-- |    hash pairs merge onto the partial's context; §5.7).
-- |  * block partial `{{#partial name}}body{{/partial}}` (body = fallback and the
-- |    `{{> @partial-block}}` yield) and inline partial `{{#inline name}}body
-- |    {{/inline}}` (a definition, hoisted by `hoistInline`); §5.7. A bare name is
-- |    literalized. `{{> @partial-block}}` ⇒ a `(partial-block)` call.
-- |
-- |    `@../index` (and `key`/`first`/`last`) reads the enclosing loop's datum
-- |    via the `parent-*` helpers (one `../` level).
-- |
-- | Not yet desugared: the Handlebars block sigils `{{#> name}}…{{/name}}` /
-- | `{{#*inline}}…{{/inline}}` — the opener sigil/close-name mismatch needs
-- | parser support, so use the `{{#partial}}` / `{{#inline}}` core spellings
-- | instead.
module FullBars.Surface
  ( desugar
  , hoistInline
  ) where

import Prelude

import BareBars.Syntax (Expr(..), Ident, Node(..), Template)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Foldable (foldl)
import Data.Int as Int
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), maybe)
import Data.Number as Number
import Data.String (Pattern(..), Replacement(..), contains, replaceAll, stripPrefix)
import Data.String.CodeUnits (drop, indexOf, singleton, take, toCharArray)

-- | Desugar a Surface template into core syntax. `clauseNames` are the
-- | separator names the engine treats as clause markers (e.g. `["else"]`); a
-- | `{{ … }}` separator with any other name is escaped output.
-- | `scope` is the set of in-scope block-param names (surface `as |…|`); a bare
-- | reference to one becomes a helper *call* `(name)`, not a `this` path lookup.
type Scope = Array Ident

desugar :: Array Ident -> Template -> Template
desugar clauseNames = go []
  where
  go :: Scope -> Template -> Template
  go scope = map node
    where
    node = case _ of
      Content s -> Content s
      -- `{{{ E }}}` — raw output; path-rewrite the expression, no escaping.
      Output sp e -> Output sp (rewrite scope e)
      Sep sp name args
        -- a clause marker (`{{else}}`, `{{elif cond}}`, …) stays a separator for
        -- the engine; its arguments (an `elif` condition) are still path-rewritten.
        | Array.elem name clauseNames -> Sep sp name (rewriteArgs scope args)
        | otherwise -> case stripPrefix (Pattern ">") name of
            -- a partial reference `{{> name [ctx]}}` ⇒ unescaped `partial` call.
            Just rest -> Output sp (partialExpr scope rest args)
            -- everything else is `{{ E }}` ⇒ escaped output.
            Nothing -> Output sp (App "esc_html" [ rewriteHead scope name args ])
      -- `{{#partial name …}}` / `{{#inline name}}` (§5.7): a bare first argument
      -- is the partial *name* (a string), like `{{> name}}`.
      Block sp "partial" args body ->
        Block sp "partial" (partialArgs scope args) (go scope (expandElseIf body))
      Block sp "inline" args body ->
        Block sp "inline" (inlineArgs scope args) (go scope (expandElseIf body))
      -- block head stays a helper; `else if` chains expand to flat `elif` (§5.6);
      -- a trailing `as |a b|` becomes positional binding-name strings (§5.5) and
      -- extends the scope for the body.
      Block sp name args body ->
        let
          { mainArgs, params } = extractBlockParams args
        in
          Block sp name (rewriteArgs scope mainArgs <> map (Lit <<< VString) params)
            (go (scope <> params) (expandElseIf body))
      -- raw blocks are verbatim (surface.adoc §5.8).
      RawBlock sp name args raw -> RawBlock sp name args raw

-- | Split a block helper's arguments at a trailing `as |a b|` clause (§5.5),
-- | returning the arguments before `as` and the binding names (with the `|`
-- | bars stripped). When there is no such clause, all args are `mainArgs`.
extractBlockParams :: Array Expr -> { mainArgs :: Array Expr, params :: Array String }
extractBlockParams args = case Array.findIndex isAs args of
  Just i | looksLikeParams (Array.drop (i + 1) args) ->
    { mainArgs: Array.take i args, params: paramNames (Array.drop (i + 1) args) }
  _ -> { mainArgs: args, params: [] }
  where
  isAs = case _ of
    App "as" [] -> true
    _ -> false
  looksLikeParams a = case Array.head a of
    Just (App n []) -> stripPrefix (Pattern "|") n /= Nothing
    _ -> false
  paramNames = Array.mapMaybe case _ of
    App n [] -> case replaceAll (Pattern "|") (Replacement "") n of
      "" -> Nothing
      s -> Just s
    _ -> Nothing

-- | The head of a `{{ head args }}` separator read as output: a bare head (no
-- | arguments) is a path; a head with arguments is a helper call.
rewriteHead :: Scope -> Ident -> Array Expr -> Expr
rewriteHead scope name args
  | Array.null args = pathOrLit scope name
  | otherwise = App name (rewriteArgs scope args)

-- | A partial reference (surface.adoc §5.7), emitted *unescaped*. `rest` is the
-- | text after the `>` sigil: empty for `{{> name …}}` (name is the first
-- | argument — a bare name is a string literal, a parenthesized expression is a
-- | dynamic name), or the name itself for the no-space `{{>name …}}` form. After
-- | the name come an optional positional context (default `this`) and `key=value`
-- | hash pairs, which collect into a trailing options `dict`.
partialExpr :: Scope -> String -> Array Expr -> Expr
partialExpr scope rest args =
  let
    { nameExpr, valueArgs } = case rest of
      "" -> case Array.uncons args of
        Just { head, tail } -> { nameExpr: partialName scope head, valueArgs: tail }
        Nothing -> { nameExpr: Lit (VString ""), valueArgs: [] }
      _ -> { nameExpr: Lit (VString rest), valueArgs: args }
  in
    case nameExpr of
      -- `{{> @partial-block}}` yields the enclosing block partial's body.
      Lit (VString "@partial-block") -> App "partial-block" []
      _ -> App "partial" (partialCall scope nameExpr valueArgs)

-- | Build the `partial` helper's arguments from its name and the value arguments
-- | (an optional positional context, default `this`, then `key=value` hash pairs
-- | collected into a trailing options `dict`).
partialCall :: Scope -> Expr -> Array Expr -> Array Expr
partialCall scope nameExpr valueArgs =
  let
    h = collectHash scope valueArgs
    ctx = maybe (App "this" []) (rewrite scope) (Array.head h.positional)
  in
    if Array.null h.pairs then [ nameExpr, ctx ] else [ nameExpr, ctx, dictExpr h.pairs ]

-- | Arguments for a `{{#partial name …}}` block (name + context + hash).
partialArgs :: Scope -> Array Expr -> Array Expr
partialArgs scope args = case Array.uncons args of
  Just { head, tail } -> partialCall scope (partialName scope head) tail
  Nothing -> [ Lit (VString ""), App "this" [] ]

-- | Arguments for a `{{#inline name}}` block — just the (literal) partial name.
inlineArgs :: Scope -> Array Expr -> Array Expr
inlineArgs scope args = case Array.uncons args of
  Just { head } -> [ partialName scope head ]
  Nothing -> [ Lit (VString "") ]

-- | A bare partial name is a string literal; a (parenthesized) expression is a
-- | dynamic name, rewritten as usual.
partialName :: Scope -> Expr -> Expr
partialName scope = case _ of
  App n [] -> Lit (VString n)
  e -> rewrite scope e

-- | Rewrite an expression: a bare identifier in value position becomes a path
-- | (or a literal, or a block-param call); an application keeps its helper head.
rewrite :: Scope -> Expr -> Expr
rewrite scope = case _ of
  Lit v -> Lit v
  App name args
    | Array.null args -> pathOrLit scope name
    | otherwise -> App name (rewriteArgs scope args)

-- | Rewrite a helper's argument list, collecting any trailing `key=value` hash
-- | pairs into a single `dict` value appended after the positional arguments
-- | (surface.adoc §5.4) — the equivalent of Handlebars' `options.hash`.
rewriteArgs :: Scope -> Array Expr -> Array Expr
rewriteArgs scope args =
  let
    h = collectHash scope args
  in
    if Array.null h.pairs then map (rewrite scope) h.positional
    else Array.snoc (map (rewrite scope) h.positional) (dictExpr h.pairs)

dictExpr :: Array { key :: String, val :: Expr } -> Expr
dictExpr pairs = App "dict" (Array.concatMap (\p -> [ Lit (VString p.key), p.val ]) pairs)

-- | Partition arguments into positional ones and `key=value` hash pairs. A hash
-- | argument is a bare ident containing `=`: either glued (`k=v`) or a trailing
-- | `k=` whose value is the *next* argument (so `k="str"` / `k=(expr)` work).
collectHash
  :: Scope
  -> Array Expr
  -> { positional :: Array Expr, pairs :: Array { key :: String, val :: Expr } }
collectHash scope = go { positional: [], pairs: [] }
  where
  go acc args = case Array.uncons args of
    Nothing -> acc
    Just { head, tail } -> case asHashKey scope head of
      Just { key, consumesNext: true } -> case Array.uncons tail of
        Just { head: v, tail: rest } ->
          go (acc { pairs = Array.snoc acc.pairs { key, val: rewrite scope v } }) rest
        Nothing -> go (acc { pairs = Array.snoc acc.pairs { key, val: App "null" [] } }) []
      Just { key, inlineVal } ->
        go (acc { pairs = Array.snoc acc.pairs { key, val: inlineVal } }) tail
      Nothing -> go (acc { positional = Array.snoc acc.positional head }) tail

-- | Recognize a `key=value` hash argument. `consumesNext` means the value is
-- | the following argument (the ident ended with `=`).
asHashKey :: Scope -> Expr -> Maybe { key :: String, consumesNext :: Boolean, inlineVal :: Expr }
asHashKey scope = case _ of
  App name []
    | contains (Pattern "=") name ->
        let
          { key, rest } = splitFirstEq name
        in
          Just
            if rest == "" then { key, consumesNext: true, inlineVal: App "null" [] }
            else { key, consumesNext: false, inlineVal: hashValue scope rest }
  _ -> Nothing

splitFirstEq :: String -> { key :: String, rest :: String }
splitFirstEq s = case indexOf (Pattern "=") s of
  Just i -> { key: take i s, rest: drop (i + 1) s }
  Nothing -> { key: s, rest: "" }

-- | The value of a *glued* hash pair (`k=v`): a literal, a number, or a path.
hashValue :: Scope -> String -> Expr
hashValue scope t
  | t == "true" || t == "false" || t == "null" = App t []
  | otherwise = case Number.fromString t of
      Just n -> Lit (VNumber n)
      Nothing -> pathExpr scope t

-- | A bare identifier: a literal helper (`true`/`false`/`null`) stays as-is;
-- | anything else is a data path (or a block-param call).
pathOrLit :: Scope -> Ident -> Expr
pathOrLit scope name
  | name == "true" || name == "false" || name == "null" = App name []
  | otherwise = pathExpr scope name

-- | Expand a path string into a `lookup` chain (or `this`/`parent`/`@data`/a
-- | block-param call). A path whose first segment is an in-scope block param is
-- | rooted at the param's value `(param)` rather than `this`.
pathExpr :: Scope -> Ident -> Expr
pathExpr scope raw
  | raw == "this" || raw == "." = App "this" []
  | otherwise = case stripPrefix (Pattern "@") raw of
      Just dataPath -> dataExpr dataPath
      Nothing ->
        let
          { depth, rest } = stripParents raw 0
          segs = segmentsOf rest
        in
          case Array.uncons segs of
            Just { head: first, tail }
              | depth == 0 && Array.elem first scope ->
                  if Array.null tail then App first []
                  else App "lookup" (Array.cons (App first []) (map segKey tail))
            _ ->
              let
                base = parents depth
              in
                if Array.null segs then base
                else App "lookup" (Array.cons base (map segKey segs))

-- | A `@data` path: the first segment is a scoped helper, any remaining
-- | segments are looked up on its value. `@index` ⇒ `(index)`; `@root.x` ⇒
-- | `(lookup (root) "x")`. A leading `../` reads the *enclosing* loop's datum:
-- | `@../index` ⇒ `(parent-index)` (and `key`/`first`/`last`), which `each`/
-- | `with` install (see `parentData`). Only one `../` level is supported — a
-- | deeper run still resolves to the immediate parent.
dataExpr :: String -> Expr
dataExpr raw =
  let
    { depth, rest } = stripParents raw 0
    prefix = if depth == 0 then "" else "parent-"
  in
    case Array.uncons (segmentsOf rest) of
      Just { head, tail }
        | Array.null tail -> App (prefix <> head) []
        | otherwise -> App "lookup" (Array.cons (App (prefix <> head) []) (map segKey tail))
      Nothing -> App "this" []

-- | Expand `{{else if C}}` chains into nested `{{#if C}}…{{/if}}` in the else
-- | clause (surface.adoc §5.6) — the FullBars convention (clause `else`, helper
-- | `if`). The condition must be a single argument; parenthesize a helper call:
-- | `{{else if (eq a b)}}`.
expandElseIf :: Template -> Template
expandElseIf = map rewrite
  where
  rewrite = case _ of
    -- `{{else if cond}}` parses as a separator named `else` whose first argument
    -- is the bare helper `if`; rewrite it to the flat `{{elif cond}}` separator
    -- the engine's `if` reads as a clause. (The condition is path-rewritten later
    -- by `go`'s clause-separator case.)
    Sep sp "else" [ App "if" [], cond ] -> Sep sp "elif" [ cond ]
    other -> other

-- | Hoist `{{#inline "name"}}body{{/inline}}` definitions out of a (desugared)
-- | template into a partial registry, returning that registry and the template
-- | with the `inline` blocks removed. Definitions are *global* to the render
-- | (not lexically scoped) — a simplification of Handlebars' block scoping.
hoistInline :: Template -> { partials :: Map String Template, template :: Template }
hoistInline nodes = Array.foldl step { partials: Map.empty, template: [] } nodes
  where
  step acc = case _ of
    Block _ "inline" args body
      | Just name <- inlineName args ->
          let
            inner = hoistInline body
          in
            acc
              { partials = Map.insert name inner.template (Map.union acc.partials inner.partials) }
    Block sp name args body ->
      let
        inner = hoistInline body
      in
        acc
          { partials = Map.union acc.partials inner.partials
          , template = Array.snoc acc.template (Block sp name args inner.template)
          }
    other -> acc { template = Array.snoc acc.template other }
  inlineName args = case Array.head args of
    Just (Lit (VString n)) -> Just n
    _ -> Nothing

-- | Strip leading `../` runs, counting the parent depth.
stripParents :: String -> Int -> { depth :: Int, rest :: String }
stripParents s depth = case stripPrefix (Pattern "../") s of
  Just r -> stripParents r (depth + 1)
  Nothing -> { depth, rest: s }

-- | The context base for a given parent depth: 0 ⇒ `this`, 1 ⇒ `(parent)`,
-- | n ⇒ `(parent (parent …))`.
parents :: Int -> Expr
parents n
  | n <= 0 = App "this" []
  | n == 1 = App "parent" []
  | otherwise = App "parent" [ parents (n - 1) ]

-- | Split a (already `../`-stripped) path into segments. `.` and `/` separate
-- | segments; a `[ … ]` run is one literal segment (dots/spaces inside are
-- | kept). Empty segments and a leading `this` are dropped.
segmentsOf :: String -> Array String
segmentsOf s =
  let
    final = foldl step { segs: [], cur: "", inB: false } (toCharArray s)
    parts = Array.filter (_ /= "") (flush final).segs
  in
    case Array.uncons parts of
      Just { head: "this", tail } -> tail
      _ -> parts
  where
  flush st = if st.cur == "" then st else st { segs = Array.snoc st.segs st.cur, cur = "" }
  step st c
    | st.inB = if c == ']' then st { inB = false } else st { cur = st.cur <> singleton c }
    | c == '[' = (flush st) { inB = true }
    | c == '.' || c == '/' = flush st
    | otherwise = st { cur = st.cur <> singleton c }

-- | A path segment becomes a numeric index when it parses as an integer,
-- | otherwise a string key.
segKey :: String -> Expr
segKey seg = case Int.fromString seg of
  Just n -> Lit (VNumber (Int.toNumber n))
  Nothing -> Lit (VString seg)
