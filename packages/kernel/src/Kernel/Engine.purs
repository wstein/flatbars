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
  -- A loop `label NAME` (ADR-013): the name a frame-shifting block (`each`/`with`)
  -- binds to its frame reified as an object, so an inner body reads
  -- `label.length`/`label.index0`/… `Nothing` when the head has no label clause.
  , loopLabel :: Maybe String
  }

-- | A helper: given its control handle and evaluated arguments, produce a value.
type Operation m env = Ctl m env -> Array Value -> m Value

-- | What an engine supplies; FlatBars owns everything else.
type Engine m env =
  { initial :: env -- starting environment + root context
  , resolve :: env -> Ident -> m (Operation m env) -- find a helper (throw UnknownHelper if absent)
  -- Like `resolve`, but ALWAYS strict: throw `UnknownHelper` when no frame defines
  -- the name, bypassing any lenient resolve policy. The raw-block path uses it: a
  -- raw block exists only to hand its verbatim body to a helper, so an undefined
  -- head is a hard error in every dialect — never an implicit section (the lenient
  -- `{{#x}}`-over-data fallback would silently emit the body unprocessed).
  , resolveStrict :: env -> Ident -> m (Operation m env)
  , stringify :: Value -> m String -- how a Value becomes output text
  -- Split a block head's argument expressions into the positional args (handed to
  -- the operation, *unchanged* for built-ins), the surface hash (`@hash` marker),
  -- and the `as |a b|` names (`@param` markers). The default identity split
  -- (`{ positional: args, hash: Nothing, params: [] }`) is what RawBars uses;
  -- FullBars supplies a marker-aware split. See ADR-020 Phase 3.
  , blockArgs ::
      Array Expr
      -> { positional :: Array Expr
         , hash :: Maybe Expr
         , params :: Array String
         , label :: Maybe String
         }
  -- Provenance hooks for source maps (ADR-035). The normal engines supply no-ops,
  -- so an unmapped render stays byte-identical (the compiler≡interpreter invariant);
  -- the mapped runner (`Kernel.Provenance`) supplies recorders. `recordText` logs a
  -- literal-text run. `recordEmit span produce` runs `produce` (an expression
  -- render) and logs ONE emit run for it — unless `produce` itself logged sub-runs
  -- (a partial expanding its body), in which case those cover it and no outer run is
  -- added, avoiding a double count.
  , recordText :: env -> Span -> String -> m Unit
  , recordEmit :: env -> Span -> m String -> m String
  }

-- | Run a parsed template against an engine. FlatBars drives the entire walk.
runTemplate :: forall m env. Monad m => Engine m env -> Template -> m String
runTemplate engine = renderTemplate engine.initial
  where
  renderTemplate :: env -> Template -> m String
  renderTemplate env nodes = joinWith "" <$> traverse (renderNode env) nodes

  renderNode :: env -> Node -> m String
  renderNode env = case _ of
    Content span s -> engine.recordText env span s *> pure s
    Output span e -> engine.recordEmit env span (evalExpr env span e >>= engine.stringify)
    -- the engine applies the head as a block helper; the opener sigil (`#`/`^`)
    -- is a dialect concern (FullBars desugars `Inverse` to `unless`), so the
    -- meaning-free driver ignores it. A block's output is the leaves its body
    -- renders (recorded by the nested `render`), so the driver records nothing here.
    Block span _ name args body -> applyBlock engine.resolve env span name args body
    -- a raw block resolves its head STRICTLY (undefined ⇒ UnknownHelper): its only
    -- purpose is to feed the verbatim body to a helper, so there is no meaningful
    -- implicit-section fallback. See `Engine`'s `resolveStrict`.
    RawBlock span name args raw -> applyBlock engine.resolveStrict env span name args
      [ Content span raw ]
    -- A separator rendered on its own is just an application of its head; a
    -- block helper that cares (e.g. `if` at `{{else}}`) intercepts it by
    -- splitting its children before rendering, so it is never reached there.
    Sep span name args -> engine.recordEmit env span
      (evalExpr env span (App name args) >>= engine.stringify)
    -- a recovered parse error (ADR-023) renders nothing: the interpreter only runs
    -- on error-free trees (the fail-fast parse projection rejects the rest).
    NodeError _ _ -> pure ""

  applyBlock
    :: (env -> Ident -> m (Operation m env))
    -> env
    -> Span
    -> Ident
    -> Array Expr
    -> Template
    -> m String
  applyBlock resolve env span name args body = do
    let split = engine.blockArgs args
    vals <- traverse (evalExpr env span) split.positional
    hashV <- traverse (evalExpr env span) split.hash
    h <- resolve env name
    h (ctl env body span hashV split.params split.label) vals >>= engine.stringify

  evalExpr :: env -> Span -> Expr -> m Value
  evalExpr env span = case _ of
    Lit v -> pure v
    App name args -> do
      vals <- traverse (evalExpr env span) args
      h <- engine.resolve env name
      h (ctl env [] span Nothing [] Nothing) vals

  ctl :: env -> Template -> Span -> Maybe Value -> Array String -> Maybe String -> Ctl m env
  ctl env body span hashV params label =
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
    , loopLabel: label
    }

-- | Parse source and run it. Parse failures are thrown into `m`.
runString :: forall m env. MonadThrow Error m => Engine m env -> String -> m String
runString engine src = case parse src of
  Left pe -> throwError (ParseFailure pe)
  Right { nodes } -> runTemplate engine nodes
