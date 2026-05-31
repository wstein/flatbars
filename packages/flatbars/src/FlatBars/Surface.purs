-- | The FlatBars *surface dialect* — a desugaring of Handlebars-flavoured
-- | author syntax into core syntax. See `docs/modules/ROOT/pages/surface.adoc`.
-- |
-- | This is *not* a separate parser (ADR-001): `desugar` is a pure rewrite of
-- | the structural `Template` the one parser already produces, into another
-- | structural `Template` that uses only core forms. The reference renderer (or
-- | `lower`) then runs the result unchanged.
-- |
-- | What it rewrites (surface.adoc §5.1–5.3):
-- |
-- |  * `{{ E }}` (a separator that is not a clause marker) ⇒ escaped output,
-- |    `{{{ esc_html E' }}}`; `{{{ E }}}` stays raw output.
-- |  * a bare/dotted *path* in value position ⇒ a `lookup` chain:
-- |    `name` ⇒ `lookup this "name"`, `a.b` ⇒ `lookup this "a" "b"`,
-- |    `a.1` ⇒ `lookup this "a" 1`, `a/b` (legacy slash) likewise,
-- |    `this`/`.` ⇒ `this`, `../a` ⇒ `lookup (parent) "a"`,
-- |    `../../a` ⇒ `lookup (parent (parent)) "a"`.
-- |  * `true`/`false`/`null` stay literal helper calls.
-- |
-- | Not yet desugared (need lexer support or a further pass): `@data` variables
-- | (`@` is not an identifier character), `[bracket]` path segments, hash
-- | arguments `k=v`, block params `as |x|`, `else if` chains, and partials.
-- | Those are listed in surface.adoc §5.4–5.7 and remain author-unsupported.
module FlatBars.Surface
  ( desugar
  ) where

import Prelude

import BareBars.Syntax (Expr(..), Ident, Node(..), Template)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Int as Int
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), Replacement(..), replaceAll, split, stripPrefix)

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
      -- to split on; everything else is `{{ E }}` ⇒ escaped output.
      | Array.elem name clauseNames -> Sep sp name args
      | otherwise -> Output sp (App "esc_html" [ rewriteHead name args ])
    -- block head stays a helper; its arguments and body are rewritten.
    Block sp name args body -> Block sp name (map rewrite args) (desugar clauseNames body)
    -- raw blocks are verbatim (surface.adoc §5.8).
    RawBlock sp name args raw -> RawBlock sp name args raw

-- | The head of a `{{ head args }}` separator read as output: a bare head (no
-- | arguments) is a path; a head with arguments is a helper call.
rewriteHead :: Ident -> Array Expr -> Expr
rewriteHead name args
  | Array.null args = pathOrLit name
  | otherwise = App name (map rewrite args)

-- | Rewrite an expression: a bare identifier in value position becomes a path
-- | (or a literal); an application keeps its helper head and rewrites its args.
rewrite :: Expr -> Expr
rewrite = case _ of
  Lit v -> Lit v
  App name args
    | Array.null args -> pathOrLit name
    | otherwise -> App name (map rewrite args)

-- | A bare identifier: a literal helper (`true`/`false`/`null`) stays as-is;
-- | anything else is a data path.
pathOrLit :: Ident -> Expr
pathOrLit name
  | name == "true" || name == "false" || name == "null" = App name []
  | otherwise = pathExpr name

-- | Expand a path string into a `lookup` chain (or `this`/`parent`).
pathExpr :: Ident -> Expr
pathExpr raw
  | raw == "this" || raw == "." = App "this" []
  | otherwise =
      let
        { depth, rest } = stripParents raw 0
        base = parents depth
        segs = segmentsOf rest
      in
        if Array.null segs then base
        else App "lookup" (Array.cons base (map segKey segs))

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

-- | Split a (already `../`-stripped) path into segments, treating `/` as `.`,
-- | dropping empties and a leading `this`.
segmentsOf :: String -> Array String
segmentsOf s =
  let
    parts = Array.filter (_ /= "")
      (split (Pattern ".") (replaceAll (Pattern "/") (Replacement ".") s))
  in
    case Array.uncons parts of
      Just { head: "this", tail } -> tail
      _ -> parts

-- | A path segment becomes a numeric index when it parses as an integer,
-- | otherwise a string key.
segKey :: String -> Expr
segKey seg = case Int.fromString seg of
  Just n -> Lit (VNumber (Int.toNumber n))
  Nothing -> Lit (VString seg)
