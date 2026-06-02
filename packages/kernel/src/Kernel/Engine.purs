-- | The interpreting walk — fully polymorphic and inversion-of-control.
-- |
-- | This is *not* part of the FlatBars core (which is parser → skeleton AST). It
-- | is the generic *second-stage driver*: FlatBars owns lexing, parsing,
-- | recursion into children, argument evaluation, and output assembly; an engine
-- | plugs in three small functions and FlatBars calls them. **Don't call
-- | FlatBars; FlatBars calls you.**
-- |
-- | The driver is polymorphic in:
-- |
-- |  * the result monad `m` (with `MonadThrow Error m`) — `Either Error` for a
-- |    pure host, `ExceptT Error Aff` for an async/effectful one; and
-- |  * the environment type `env` — the engine chooses what an environment is.
-- |
-- | See `docs/modules/ROOT/pages/appendix-handlebars.adoc` §A.13 and
-- | `evaluation.adoc` §3.5–3.6.
module Kernel.Engine
  ( Ctl
  , Operation
  , Engine
  , runTemplate
  , runString
  ) where

import Prelude

import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import FlatBars.Error (Error(..))
import FlatBars.Parser (parse)
import FlatBars.Span (Span)
import FlatBars.Syntax (Expr(..), Ident, Node(..), Template)
import FlatBars.Value (Value)
import Kernel.Walk (splitClause)

-- | The *control handle* FlatBars hands every helper. Every field is a callback
-- | *into* FlatBars — a helper never walks the tree itself.
type Ctl m env =
  { env :: env -- the current environment (the engine's own type)
  , children :: Template -- this block's captured body ([] for inline calls)
  , span :: Span -- source location of the enclosing tag, for diagnostics
  , render :: env -> Template -> m String -- FlatBars renders a sub-tree
  , eval :: env -> Expr -> m Value -- FlatBars evaluates a body expression to a Value
  , clause :: Ident -> { before :: Template, body :: Maybe Template } -- split a nested clause
  -- A block head's surface hash (`k=v`) and declared `as |a b|` names, split out
  -- by the engine's `blockArgs` seam (ADR-020 Phase 3). Built-ins ignore these
  -- (they read the equivalent values positionally); the user-helper marshaller
  -- reads them to populate `options.hash` and bind block params. `Nothing` / `[]`
  -- for dialects/heads with no such surface (e.g. RawBars).
  , hash :: Maybe Value
  , blockParams :: Array String
  }

-- | A helper: given its control handle and evaluated arguments, produce a value.
type Operation m env = Ctl m env -> Array Value -> m Value

-- | What an engine supplies; FlatBars owns everything else.
type Engine m env =
  { initial :: env -- starting environment + root context
  , resolve :: env -> Ident -> m (Operation m env) -- find a helper (throw UnknownHelper if absent)
  , stringify :: Value -> m String -- how a Value becomes output text
  -- Split a block head's argument expressions into the positional args (handed to
  -- the operation, *unchanged* for built-ins), the surface hash (`@hash` marker),
  -- and the `as |a b|` names (`@param` markers). The default identity split
  -- (`{ positional: args, hash: Nothing, params: [] }`) is what RawBars uses;
  -- FullBars supplies a marker-aware split. See ADR-020 Phase 3.
  , blockArgs ::
      Array Expr -> { positional :: Array Expr, hash :: Maybe Expr, params :: Array String }
  }

-- | Run a parsed template against an engine. FlatBars drives the entire walk.
runTemplate :: forall m env. Monad m => Engine m env -> Template -> m String
runTemplate engine = renderTemplate engine.initial
  where
  renderTemplate :: env -> Template -> m String
  renderTemplate env nodes = joinWith "" <$> traverse (renderNode env) nodes

  renderNode :: env -> Node -> m String
  renderNode env = case _ of
    Content s -> pure s
    Output span e -> evalExpr env span e >>= engine.stringify
    -- the engine applies the head as a block helper; the opener sigil (`#`/`^`)
    -- is a dialect concern (FullBars desugars `Inverse` to `unless`), so the
    -- meaning-free driver ignores it.
    Block span _ name args body -> applyBlock env span name args body
    RawBlock span name args raw -> applyBlock env span name args [ Content raw ]
    -- A separator rendered on its own is just an application of its head; a
    -- block helper that cares (e.g. `if` at `{{else}}`) intercepts it by
    -- splitting its children before rendering, so it is never reached there.
    Sep span name args -> evalExpr env span (App name args) >>= engine.stringify

  applyBlock :: env -> Span -> Ident -> Array Expr -> Template -> m String
  applyBlock env span name args body = do
    let split = engine.blockArgs args
    vals <- traverse (evalExpr env span) split.positional
    hashV <- traverse (evalExpr env span) split.hash
    h <- engine.resolve env name
    h (ctl env body span hashV split.params) vals >>= engine.stringify

  evalExpr :: env -> Span -> Expr -> m Value
  evalExpr env span = case _ of
    Lit v -> pure v
    App name args -> do
      vals <- traverse (evalExpr env span) args
      h <- engine.resolve env name
      h (ctl env [] span Nothing []) vals

  ctl :: env -> Template -> Span -> Maybe Value -> Array String -> Ctl m env
  ctl env body span hashV params =
    { env
    , children: body
    , span
    , render: renderTemplate
    -- evaluate an expression a helper reads from its body (e.g. an `elif`
    -- condition) lazily — the dual of `render`. Arguments still arrive
    -- pre-evaluated; this is for expressions the helper finds in `children`.
    , eval: \env' e -> evalExpr env' span e
    , clause: \name ->
        let
          s = splitClause name body
        in
          { before: s.before, body: s.clause }
    , hash: hashV
    , blockParams: params
    }

-- | Parse source and run it. Parse failures are thrown into `m`.
runString :: forall m env. MonadThrow Error m => Engine m env -> String -> m String
runString engine src = case parse src of
  Left pe -> throwError (ParseFailure pe)
  Right { nodes } -> runTemplate engine nodes
