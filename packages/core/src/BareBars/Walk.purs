-- | Skeleton-AST traversal and validation.
-- |
-- | `Parser.parse` produces a *skeleton* AST: it is purely syntactic and
-- | attaches no meaning to any name. Whether `each` exists, takes one argument,
-- | and is a block helper is not the parser's concern. Validation is a separate
-- | second pass, driven by a `Schema` the *engine* supplies — the BareBars
-- | analogue of validating a document against a JSON schema.
-- |
-- | `foldRefs` folds a monoid over every helper reference in a template
-- | (applications, blocks, raw blocks); `foldTemplate` is the full catamorphism
-- | an engine builds custom passes on (lowering, linting, pretty-printing).
-- | `validate` is the batteries-included schema pass built on `foldRefs`.
module BareBars.Walk
  ( RefKind(..)
  , HelperRef
  , foldRefs
  , Algebra
  , foldTemplate
  , helperRefs
  , clause
  , clauses
  , withoutClause
  , splitClause
  , Arity(..)
  , HelperSpec
  , Schema
  , Severity(..)
  , Issue
  , validate
  , arityOk
  ) where

import Prelude

import BareBars.Syntax (Expr(..), Ident, Node(..), Template)
import Data.Array as Array
import Data.Foldable (foldMap)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))

--------------------------------------------------------------------------------
-- Generic traversal
--------------------------------------------------------------------------------

-- | How a name is referenced in the skeleton.
data RefKind
  = AppRef -- {{{ name … }}} or a nested application
  | BlockRef -- {{# name … }}
  | RawRef -- {{{{# name … }}}}

derive instance eqRefKind :: Eq RefKind

instance showRefKind :: Show RefKind where
  show = case _ of
    AppRef -> "AppRef"
    BlockRef -> "BlockRef"
    RawRef -> "RawRef"

-- | A single occurrence of a name, with how it was used and how many arguments
-- | it was given.
type HelperRef = { name :: Ident, kind :: RefKind, argc :: Int }

-- | Fold a monoid over every helper reference in a template, depth-first.
foldRefs :: forall m. Monoid m => (HelperRef -> m) -> Template -> m
foldRefs f = foldMap (node f)
  where
  node :: (HelperRef -> m) -> Node -> m
  node g = case _ of
    Content _ -> mempty
    Output e -> expr g e
    Block name args body ->
      g { name, kind: BlockRef, argc: Array.length args }
        <> foldMap (expr g) args
        <> foldRefs g body
    RawBlock name args _ ->
      g { name, kind: RawRef, argc: Array.length args } <> foldMap (expr g) args

  expr :: (HelperRef -> m) -> Expr -> m
  expr g = case _ of
    Lit _ -> mempty
    App name args ->
      g { name, kind: AppRef, argc: Array.length args } <> foldMap (expr g) args

-- | Every helper reference in a template, in depth-first order.
helperRefs :: Template -> Array HelperRef
helperRefs = foldRefs Array.singleton

-- | A catamorphism over the skeleton: the engine supplies an algebra, BareBars
-- | owns the recursion (inversion of control). The `block` case is handed the
-- | raw `children` (so it can resolve clauses) *and* a BareBars-provided
-- | `recurse` to fold any sub-range. Use it to lower the skeleton to your own
-- | typed AST, collect diagnostics, or pretty-print — without writing a walk.
type Algebra a =
  { content :: String -> a
  , output :: Expr -> a
  , raw :: Ident -> Array Expr -> String -> a
  , block ::
      { name :: Ident, args :: Array Expr, children :: Template, recurse :: Template -> a } -> a
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
    Output e -> alg.output e
    RawBlock name args raw' -> alg.raw name args raw'
    Block name args children -> alg.block { name, args, children, recurse: go }

--------------------------------------------------------------------------------
-- Clause helpers (for nested-clause control flow)
--------------------------------------------------------------------------------

-- | The body of the first top-level `{{#name}}…{{/name}}` block in a template,
-- | if present. This is how a block helper finds a clause (e.g. `if` looking
-- | for an `else` clause in its body).
clause :: Ident -> Template -> Maybe Template
clause name = Array.findMap case _ of
  Block n _ body | n == name -> Just body
  _ -> Nothing

-- | The bodies of every top-level `{{#name}}` block in a template.
clauses :: Ident -> Template -> Array Template
clauses name = Array.mapMaybe case _ of
  Block n _ body | n == name -> Just body
  _ -> Nothing

-- | A template with every top-level `{{#name}}` block removed — the "main"
-- | content once a clause has been pulled out.
withoutClause :: Ident -> Template -> Template
withoutClause name = Array.filter case _ of
  Block n _ _ -> n /= name
  _ -> true

-- | Split a body at the first top-level `{{#name}}` clause: the nodes *before*
-- | it, and that clause's body (if any). The idiom a control-flow helper uses —
-- | e.g. `if` renders `before` when truthy and `clause` otherwise.
splitClause :: Ident -> Template -> { before :: Template, clause :: Maybe Template }
splitClause name nodes = case Array.findIndex isClause nodes of
  Nothing -> { before: nodes, clause: Nothing }
  Just i -> { before: Array.take i nodes, clause: bodyAt i }
  where
  isClause = case _ of
    Block n _ _ -> n == name
    _ -> false
  bodyAt i = case Array.index nodes i of
    Just (Block _ _ body) -> Just body
    _ -> Nothing

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
type HelperSpec = { block :: Boolean, arity :: Arity }

-- | The engine's contract for a template. `allowUnknown` mirrors a JSON
-- | schema's `additionalProperties`: when false, any name not in `helpers` is
-- | an error.
type Schema =
  { helpers :: Map Ident HelperSpec
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
validate schema = Array.mapMaybe check <<< helperRefs
  where
  check :: HelperRef -> Maybe Issue
  check ref = case Map.lookup ref.name schema.helpers of
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
        { severity: Warn, name: ref.name, message: "'" <> ref.name <> "' is not a block helper" }
      else Nothing
