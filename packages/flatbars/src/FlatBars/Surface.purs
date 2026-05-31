-- | The FlatBars *surface dialect* — a desugaring of Handlebars-flavoured
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
-- |  * `else if` chains ⇒ nested `if` blocks in the else clause (§5.6).
-- |  * hash arguments `k=v` ⇒ a trailing `dict`: `{{ f a k=v }}` ⇒
-- |    `{{{ esc_html (f (lookup this "a") (dict "k" (lookup this "v"))) }}}` (§5.4).
-- |  * `{{> name [ctx]}}` ⇒ `{{{ partial "name" ctx }}}` (a bare name is a string
-- |    literal, a parenthesized expression is a dynamic name; §5.7).
-- |
-- | Not yet desugared: `@../` parent-data (the scoped helpers are frame-local),
-- | block params `as |x|` (§5.5), and the inline / block / `@partial-block`
-- | partial forms and partial hash context `{{> n k=v}}` (§5.7).
module FlatBars.Surface
  ( desugar
  ) where

import Prelude

import BareBars.Syntax (Expr(..), Ident, Node(..), Template)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Foldable (foldl)
import Data.Int as Int
import Data.Maybe (Maybe(..), maybe)
import Data.Number as Number
import Data.String (Pattern(..), contains, stripPrefix)
import Data.String.CodeUnits (drop, indexOf, singleton, take, toCharArray)

-- | Desugar a Surface template into core syntax. `clauseNames` are the
-- | separator names the engine treats as clause markers (e.g. `["else"]`); a
-- | `{{ … }}` separator with any other name is escaped output.
desugar :: Array Ident -> Template -> Template
desugar clauseNames = map go
  where
  go :: Node -> Node
  go = case _ of
    Content s -> Content s
    -- `{{{ E }}}` — raw output; path-rewrite the expression, no escaping.
    Output sp e -> Output sp (rewrite e)
    Sep sp name args
      -- a clause marker (`{{else}}`, …) passes through untouched for the engine
      -- to split on.
      | Array.elem name clauseNames -> Sep sp name args
      | otherwise -> case stripPrefix (Pattern ">") name of
          -- a partial reference `{{> name [ctx]}}` ⇒ unescaped `partial` call.
          Just rest -> Output sp (partialExpr rest args)
          -- everything else is `{{ E }}` ⇒ escaped output.
          Nothing -> Output sp (App "esc_html" [ rewriteHead name args ])
    -- block head stays a helper; `else if` chains in the body are expanded into
    -- nested `if` blocks (§5.6) before the body and arguments are rewritten.
    Block sp name args body ->
      Block sp name (rewriteArgs args) (desugar clauseNames (expandElseIf body))
    -- raw blocks are verbatim (surface.adoc §5.8).
    RawBlock sp name args raw -> RawBlock sp name args raw

-- | The head of a `{{ head args }}` separator read as output: a bare head (no
-- | arguments) is a path; a head with arguments is a helper call.
rewriteHead :: Ident -> Array Expr -> Expr
rewriteHead name args
  | Array.null args = pathOrLit name
  | otherwise = App name (rewriteArgs args)

-- | A partial reference (surface.adoc §5.7), emitted *unescaped*. `rest` is the
-- | text after the `>` sigil: empty for `{{> name [ctx]}}` (name is the first
-- | argument — a bare name is a string literal, a parenthesized expression is a
-- | dynamic name), or the name itself for the no-space `{{>name [ctx]}}` form.
-- | An optional second argument is the context (default `this`).
partialExpr :: String -> Array Expr -> Expr
partialExpr rest args
  | rest == "" = case Array.uncons args of
      Just { head: nameArg, tail } -> App "partial" [ partialName nameArg, partialCtx tail ]
      Nothing -> App "partial" [ Lit (VString ""), App "this" [] ]
  | otherwise = App "partial" [ Lit (VString rest), partialCtx args ]

-- | A bare partial name is a string literal; a (parenthesized) expression is a
-- | dynamic name, rewritten as usual.
partialName :: Expr -> Expr
partialName = case _ of
  App n [] -> Lit (VString n)
  e -> rewrite e

-- | The partial's context argument, defaulting to `this` when omitted.
partialCtx :: Array Expr -> Expr
partialCtx cs = maybe (App "this" []) rewrite (Array.head cs)

-- | Rewrite an expression: a bare identifier in value position becomes a path
-- | (or a literal); an application keeps its helper head and rewrites its args.
rewrite :: Expr -> Expr
rewrite = case _ of
  Lit v -> Lit v
  App name args
    | Array.null args -> pathOrLit name
    | otherwise -> App name (rewriteArgs args)

-- | Rewrite a helper's argument list, collecting any trailing `key=value` hash
-- | pairs into a single `dict` value appended after the positional arguments
-- | (surface.adoc §5.4) — the equivalent of Handlebars' `options.hash`.
rewriteArgs :: Array Expr -> Array Expr
rewriteArgs args =
  let
    h = collectHash args
  in
    if Array.null h.pairs then map rewrite h.positional
    else Array.snoc (map rewrite h.positional) (dictExpr h.pairs)

dictExpr :: Array { key :: String, val :: Expr } -> Expr
dictExpr pairs = App "dict" (Array.concatMap (\p -> [ Lit (VString p.key), p.val ]) pairs)

-- | Partition arguments into positional ones and `key=value` hash pairs. A hash
-- | argument is a bare ident containing `=`: either glued (`k=v`) or a trailing
-- | `k=` whose value is the *next* argument (so `k="str"` / `k=(expr)` work).
collectHash
  :: Array Expr -> { positional :: Array Expr, pairs :: Array { key :: String, val :: Expr } }
collectHash = go { positional: [], pairs: [] }
  where
  go acc args = case Array.uncons args of
    Nothing -> acc
    Just { head, tail } -> case asHashKey head of
      Just { key, consumesNext: true } -> case Array.uncons tail of
        Just { head: v, tail: rest } ->
          go (acc { pairs = Array.snoc acc.pairs { key, val: rewrite v } }) rest
        Nothing -> go (acc { pairs = Array.snoc acc.pairs { key, val: App "null" [] } }) []
      Just { key, inlineVal } ->
        go (acc { pairs = Array.snoc acc.pairs { key, val: inlineVal } }) tail
      Nothing -> go (acc { positional = Array.snoc acc.positional head }) tail

-- | Recognize a `key=value` hash argument. `consumesNext` means the value is
-- | the following argument (the ident ended with `=`).
asHashKey :: Expr -> Maybe { key :: String, consumesNext :: Boolean, inlineVal :: Expr }
asHashKey = case _ of
  App name []
    | contains (Pattern "=") name ->
        let
          { key, rest } = splitFirstEq name
        in
          Just
            if rest == "" then { key, consumesNext: true, inlineVal: App "null" [] }
            else { key, consumesNext: false, inlineVal: hashValue rest }
  _ -> Nothing

splitFirstEq :: String -> { key :: String, rest :: String }
splitFirstEq s = case indexOf (Pattern "=") s of
  Just i -> { key: take i s, rest: drop (i + 1) s }
  Nothing -> { key: s, rest: "" }

-- | The value of a *glued* hash pair (`k=v`): a literal, a number, or a path.
hashValue :: String -> Expr
hashValue t
  | t == "true" || t == "false" || t == "null" = App t []
  | otherwise = case Number.fromString t of
      Just n -> Lit (VNumber n)
      Nothing -> pathExpr t

-- | A bare identifier: a literal helper (`true`/`false`/`null`) stays as-is;
-- | anything else is a data path.
pathOrLit :: Ident -> Expr
pathOrLit name
  | name == "true" || name == "false" || name == "null" = App name []
  | otherwise = pathExpr name

-- | Expand a path string into a `lookup` chain (or `this`/`parent`/`@data`).
pathExpr :: Ident -> Expr
pathExpr raw
  | raw == "this" || raw == "." = App "this" []
  | otherwise = case stripPrefix (Pattern "@") raw of
      Just dataPath -> dataExpr dataPath
      Nothing ->
        let
          { depth, rest } = stripParents raw 0
          base = parents depth
          segs = segmentsOf rest
        in
          if Array.null segs then base
          else App "lookup" (Array.cons base (map segKey segs))

-- | A `@data` path: the first segment is a scoped helper, any remaining
-- | segments are looked up on its value. `@index` ⇒ `(index)`; `@root.x` ⇒
-- | `(lookup (root) "x")`. A leading `../` is not faithfully supported (the
-- | scoped helpers are frame-local), so it collapses to the current frame.
dataExpr :: String -> Expr
dataExpr s = case Array.uncons (segmentsOf s) of
  Just { head, tail }
    | Array.null tail -> App head []
    | otherwise -> App "lookup" (Array.cons (App head []) (map segKey tail))
  Nothing -> App "this" []

-- | Expand `{{else if C}}` chains into nested `{{#if C}}…{{/if}}` in the else
-- | clause (surface.adoc §5.6) — the FlatBars convention (clause `else`, helper
-- | `if`). The condition must be a single argument; parenthesize a helper call:
-- | `{{else if (eq a b)}}`.
expandElseIf :: Template -> Template
expandElseIf nodes = case Array.findIndex isElseIf nodes of
  Nothing -> nodes
  Just i -> case Array.index nodes i of
    Just (Sep sp _ [ _, cond ]) ->
      Array.take i nodes
        <>
          [ Sep sp "else" []
          , Block sp "if" [ cond ] (expandElseIf (Array.drop (i + 1) nodes))
          ]
    _ -> nodes
  where
  isElseIf = case _ of
    Sep _ "else" [ App "if" [], _ ] -> true
    _ -> false

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
