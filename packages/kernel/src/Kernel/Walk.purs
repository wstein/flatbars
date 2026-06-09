-- | Skeleton-AST traversal and validation.
-- |
-- | `Parser.parse` produces a *skeleton* AST: it is purely syntactic and
-- | attaches no meaning to any name. Whether `each` exists, takes one argument,
-- | and is a block helper is not the parser's concern. Validation is a separate
-- | second pass, driven by a `Schema` the *engine* supplies — the FlatBars
-- | analogue of validating a document against a JSON schema.
-- |
-- | `foldRefs` folds a monoid over every name reference in a template
-- | (applications, blocks, raw blocks, separators); `foldTemplate` is the full
-- | catamorphism an engine builds custom passes on (lowering, linting,
-- | pretty-printing). `splitClause` splits a block body at a `{{name}}`
-- | separator. `validate` is the batteries-included schema pass.
module Kernel.Walk
  ( RefKind(..)
  , OperationRef
  , foldRefs
  , ExprAlgebra
  , foldExpr
  , Algebra
  , foldTemplate
  , operationRefs
  , Clause
  , splitClauses
  , splitClause
  , Arity(..)
  , OperationSpec
  , Schema
  , Severity(..)
  , Issue
  , validate
  , arityOk
  , arityText
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (fold, foldMap)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import FlatBars.Span (Span)
import FlatBars.Syntax (Expr(..), Ident, Node(..), Template)
import FlatBars.Value (Value)

--------------------------------------------------------------------------------
-- Generic traversal
--------------------------------------------------------------------------------

-- | How a name is referenced in the skeleton.
data RefKind
  = AppRef -- {{{ name … }}} or a nested application
  | BlockRef -- {{# name … }}
  | RawRef -- {{{{# name … }}}}
  | SepRef -- {{ name … }} separator (not a helper invocation)

derive instance eqRefKind :: Eq RefKind

instance showRefKind :: Show RefKind where
  show = case _ of
    AppRef -> "AppRef"
    BlockRef -> "BlockRef"
    RawRef -> "RawRef"
    SepRef -> "SepRef"

-- | A single occurrence of a name, with how it was used, how many arguments it
-- | was given, and the span of the enclosing tag (so a host can locate it — e.g.
-- | the linter's click-to-jump). Expression refs carry their enclosing node's
-- | span (the skeleton `Expr` has no spans of its own; spans live on nodes).
type OperationRef = { name :: Ident, kind :: RefKind, argc :: Int, span :: Span }

-- | A catamorphism over an `Expr`: `app` receives the *already-folded* results
-- | of its arguments (bottom-up). It is the single expression-recursion
-- | primitive — passes that walk into expressions (ref collection, the surface
-- | desugarer rewriting `lookup`/`@data` chains) build on it instead of
-- | re-implementing the `App`/`Lit` descent.
type ExprAlgebra a =
  { lit :: Value -> a
  , app :: Ident -> Array a -> a
  }

foldExpr :: forall a. ExprAlgebra a -> Expr -> a
foldExpr alg = go
  where
  go = case _ of
    Lit v -> alg.lit v
    App name args -> alg.app name (map go args)

-- | Fold a monoid over every helper reference in a template, depth-first.
foldRefs :: forall m. Monoid m => (OperationRef -> m) -> Template -> m
foldRefs f = foldMap (node f)
  where
  node :: (OperationRef -> m) -> Node -> m
  node g = case _ of
    Content _ -> mempty
    Output sp e -> expr g sp e
    Block sp _ name args body ->
      g { name, kind: BlockRef, argc: Array.length args, span: sp }
        <> foldMap (expr g sp) args
        <> foldRefs g body
    RawBlock sp name args _ ->
      g { name, kind: RawRef, argc: Array.length args, span: sp } <> foldMap (expr g sp) args
    Sep sp name args ->
      g { name, kind: SepRef, argc: Array.length args, span: sp } <> foldMap (expr g sp) args
    NodeError _ _ -> mempty -- a recovered error references no operations

  -- Expression refs via the shared `foldExpr`: each application emits its own
  -- ref and combines the refs collected from its arguments. The skeleton `Expr`
  -- carries no span, so every ref inherits the enclosing node's span `sp`.
  expr :: (OperationRef -> m) -> Span -> Expr -> m
  expr g sp = foldExpr
    { lit: \_ -> mempty
    , app: \name children -> g { name, kind: AppRef, argc: Array.length children, span: sp } <> fold
        children
    }

-- | Every helper reference in a template, in depth-first order.
operationRefs :: Template -> Array OperationRef
operationRefs = foldRefs Array.singleton

-- | A catamorphism over the skeleton: the engine supplies an algebra, FlatBars
-- | owns the recursion (inversion of control). The `block` case is handed the
-- | raw `children` (so it can resolve clauses) *and* a FlatBars-provided
-- | `recurse` to fold any sub-range. Use it to lower the skeleton to your own
-- | typed AST, collect diagnostics, or pretty-print — without writing a walk.
-- |
-- | Every tag-level case (`output`/`raw`/`sep`/`block`) receives the source
-- | `Span` of its opening tag, so a pass can carry locations through to its own
-- | AST — the basis of the lowered AST's `src` (the data-access jump-to-source).
-- | `content` has no span: it is literal text, never a tag.
type Algebra a =
  { content :: String -> a
  , output :: Span -> Expr -> a
  , raw :: Span -> Ident -> Array Expr -> String -> a
  , sep :: Span -> Ident -> Array Expr -> a
  , block ::
      { span :: Span
      , name :: Ident
      , args :: Array Expr
      , children :: Template
      , recurse :: Template -> a
      }
      -> a
  -- A recovered parse error (ADR-023). Only a tree from `parseRecovering` ever
  -- contains one; the total `parse` projects errors to `Left`, so render/compile
  -- never reach it. Tooling folds (diagnostics, pretty-print) handle it.
  , nodeError :: Span -> String -> a
  , concat :: Array a -> a
  }

foldTemplate :: forall a. Algebra a -> Template -> a
foldTemplate alg = go
  where
  go :: Template -> a
  go nodes = alg.concat (map node nodes)

  node :: Node -> a
  node = case _ of
    Content s -> alg.content s
    Output sp e -> alg.output sp e
    RawBlock sp name args raw' -> alg.raw sp name args raw'
    Sep sp name args -> alg.sep sp name args
    Block span _ name args children -> alg.block { span, name, args, children, recurse: go }
    NodeError span msg -> alg.nodeError span msg

--------------------------------------------------------------------------------
-- Clause splitting (for separator-driven control flow)
--------------------------------------------------------------------------------

-- | A separator-delimited clause: the section a `{{name args}}` separator opens,
-- | running up to the next top-level separator (or the end of the block body).
-- | `span` is the opening separator's source span — what a lowered branch
-- | (an `elif`'s nested `RIf`) carries so it can be located independently of the
-- | enclosing block.
type Clause = { name :: Ident, args :: Array Expr, body :: Template, span :: Span }

-- | Split a block body at *every* top-level separator. `before` is the section
-- | up to the first separator; `clauses` are the sections that follow, each
-- | tagged with the separator that opened it. The split is shallow — nested
-- | blocks keep their own separators. This is the general primitive a
-- | control-flow helper uses to read `{{else}}`, `{{case}}`, … (a helper has the
-- | block body as `Ctl.children`); the framework never interprets the names.
splitClauses :: Template -> { before :: Template, clauses :: Array Clause }
splitClauses nodes = case Array.findIndex isSep nodes of
  Nothing -> { before: nodes, clauses: [] }
  Just i -> { before: Array.take i nodes, clauses: clausesFrom (Array.drop i nodes) }
  where
  isSep = case _ of
    Sep _ _ _ -> true
    _ -> false

  -- `rest` begins with a separator: emit its clause (bounded by the next
  -- separator) and recurse on what follows.
  clausesFrom :: Template -> Array Clause
  clausesFrom rest = case Array.uncons rest of
    Just { head: Sep span name args, tail } ->
      let
        bodyEnd = fromMaybe (Array.length tail) (Array.findIndex isSep tail)
      in
        Array.cons { name, args, body: Array.take bodyEnd tail, span }
          (clausesFrom (Array.drop bodyEnd tail))
    _ -> []

-- | Split a block body around the *first* clause named `name`: the nodes before
-- | the first separator, and that clause's body (bounded by the next separator),
-- | if present. The idiom a control-flow helper uses — `if` renders `before`
-- | when truthy and the `else` `clause` otherwise. Defined via `splitClauses`,
-- | so a second `{{else}}` opens its own clause rather than leaking into this
-- | one.
splitClause :: Ident -> Template -> { before :: Template, clause :: Maybe Template }
splitClause name nodes =
  let
    s = splitClauses nodes
  in
    { before: s.before, clause: map _.body (Array.find (\c -> c.name == name) s.clauses) }

--------------------------------------------------------------------------------
-- Schema-driven validation
--------------------------------------------------------------------------------

data Arity
  = Exactly Int
  | AtLeast Int
  | Between Int Int
  | AnyArity

derive instance eqArity :: Eq Arity

-- | What an engine declares about a helper name.
type OperationSpec = { block :: Boolean, arity :: Arity }

-- | The engine's contract for a template. `allowUnknown` mirrors a JSON
-- | schema's `additionalProperties`: when false, any name not in `helpers` is
-- | an error.
type Schema =
  { helpers :: Map Ident OperationSpec
  , allowUnknown :: Boolean
  }

data Severity = Err | Warn

derive instance eqSeverity :: Eq Severity

instance showSeverity :: Show Severity where
  show = case _ of
    Err -> "error"
    Warn -> "warning"

type Issue = { severity :: Severity, name :: Ident, message :: String }

arityOk :: Arity -> Int -> Boolean
arityOk a n = case a of
  Exactly k -> n == k
  AtLeast k -> n >= k
  Between lo hi -> n >= lo && n <= hi
  AnyArity -> true

arityText :: Arity -> String
arityText = case _ of
  Exactly k -> "exactly " <> show k
  AtLeast k -> "at least " <> show k
  Between lo hi -> show lo <> "–" <> show hi
  AnyArity -> "any number of"

-- | Validate a skeleton template against an engine schema: unknown helpers
-- | (when `allowUnknown` is false), arity violations, and block/inline misuse.
validate :: Schema -> Template -> Array Issue
validate schema = Array.mapMaybe check <<< operationRefs
  where
  check :: OperationRef -> Maybe Issue
  check ref
    | ref.kind == SepRef = Nothing -- separators are markers, not helper invocations
    | otherwise = case Map.lookup ref.name schema.helpers of
        Nothing ->
          if schema.allowUnknown then Nothing
          else Just
            { severity: Err, name: ref.name, message: "unknown helper '" <> ref.name <> "'" }
        Just spec ->
          if not (arityOk spec.arity ref.argc) then Just
            { severity: Err
            , name: ref.name
            , message: "'" <> ref.name <> "' expects " <> arityText spec.arity
                <> " arguments, got "
                <> show ref.argc
            }
          else if (ref.kind == BlockRef || ref.kind == RawRef) && not spec.block then Just
            { severity: Warn
            , name: ref.name
            , message: "'" <> ref.name <> "' is not a block helper"
            }
          else Nothing
