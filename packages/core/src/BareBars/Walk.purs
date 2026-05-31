-- | Skeleton-AST traversal and validation.
-- |
-- | `Parser.parse` produces a *skeleton* AST: it is purely syntactic and
-- | attaches no meaning to any name. Whether `each` exists, takes one argument,
-- | and is a block helper is not the parser's concern. Validation is a separate
-- | second pass, driven by a `Schema` the *engine* supplies — the BareBars
-- | analogue of validating a document against a JSON schema.
-- |
-- | `foldRefs` is the generic visitor: it folds a monoid over every helper
-- | reference in a template (applications, blocks, raw blocks, and separators),
-- | so engines can build their own passes (free-variable analysis, helper
-- | usage reports, linters). `validate` is the batteries-included pass built on
-- | top of it.
module BareBars.Walk
  ( RefKind(..)
  , HelperRef
  , foldRefs
  , helperRefs
  , clause
  , clauses
  , withoutClause
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
