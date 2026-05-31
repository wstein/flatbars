-- | The interpreting walk — fully polymorphic and inversion-of-control.
-- |
-- | This is *not* part of the BareBars core (which is parser → skeleton AST). It
-- | is the generic *second-stage driver*: BareBars owns lexing, parsing,
-- | recursion into children, argument evaluation, and output assembly; an engine
-- | plugs in three small functions and BareBars calls them. **Don't call
-- | BareBars; BareBars calls you.**
-- |
-- | The driver is polymorphic in:
-- |
-- |  * the result monad `m` (with `MonadThrow Error m`) — `Either Error` for a
-- |    pure host, `ExceptT Error Aff` for an async/effectful one; and
-- |  * the environment type `env` — the engine chooses what an environment is.
-- |
-- | See `docs/modules/ROOT/pages/appendix-handlebars.adoc` §A.13 and
-- | `evaluation.adoc` §3.5–3.6.
module BareBars.Engine
  ( Ctl
  , Helper
  , Engine
  , runTemplate
  , runString
  ) where

import Prelude

import BareBars.Error (Error(..))
import BareBars.Parser (parse)
import BareBars.Syntax (Expr(..), Ident, Node(..), Template)
import BareBars.Value (Value)
import BareBars.Walk (splitClause)
import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Either (Either(..))
import Data.Maybe (Maybe)
import Data.String.Common (joinWith)
import Data.Traversable (traverse)

-- | The *control handle* BareBars hands every helper. Every field is a callback
-- | *into* BareBars — a helper never walks the tree itself.
type Ctl m env =
  { env :: env -- the current environment (the engine's own type)
  , children :: Template -- this block's captured body ([] for inline calls)
  , eval :: env -> Expr -> m Value -- BareBars evaluates an expression
  , render :: env -> Template -> m String -- BareBars renders a sub-tree
  , clause :: Ident -> { before :: Template, body :: Maybe Template } -- split a nested clause
  }

-- | A helper: given its control handle and evaluated arguments, produce a value.
type Helper m env = Ctl m env -> Array Value -> m Value

-- | What an engine supplies; BareBars owns everything else.
type Engine m env =
  { initial :: env -- starting environment + root context
  , resolve :: env -> Ident -> m (Helper m env) -- find a helper (throw UnknownHelper if absent)
  , stringify :: Value -> m String -- how a Value becomes output text
  }

-- | Run a parsed template against an engine. BareBars drives the entire walk.
runTemplate :: forall m env. Monad m => Engine m env -> Template -> m String
runTemplate engine = renderTemplate engine.initial
  where
  renderTemplate :: env -> Template -> m String
  renderTemplate env nodes = joinWith "" <$> traverse (renderNode env) nodes

  renderNode :: env -> Node -> m String
  renderNode env = case _ of
    Content s -> pure s
    Output e -> evalExpr env e >>= engine.stringify
    Block name args body -> applyBlock env name args body
    RawBlock name args raw -> applyBlock env name args [ Content raw ]

  applyBlock :: env -> Ident -> Array Expr -> Template -> m String
  applyBlock env name args body = do
    vals <- traverse (evalExpr env) args
    h <- engine.resolve env name
    h (ctl env body) vals >>= engine.stringify

  evalExpr :: env -> Expr -> m Value
  evalExpr env = case _ of
    Lit v -> pure v
    App name args -> do
      vals <- traverse (evalExpr env) args
      h <- engine.resolve env name
      h (ctl env []) vals

  ctl :: env -> Template -> Ctl m env
  ctl env body =
    { env
    , children: body
    , eval: evalExpr
    , render: renderTemplate
    , clause: \name ->
        let
          s = splitClause name body
        in
          { before: s.before, body: s.clause }
    }

-- | Parse source and run it. Parse failures are thrown into `m`.
runString :: forall m env. MonadThrow Error m => Engine m env -> String -> m String
runString engine src = case parse src of
  Left pe -> throwError (HelperError ("parse error: " <> show pe))
  Right tmpl -> runTemplate engine tmpl
