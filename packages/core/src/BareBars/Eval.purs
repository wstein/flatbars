-- | The reference engine's interpreting walker. See
-- | `docs/modules/ROOT/pages/evaluation.adoc` §3.4–3.5.
-- |
-- | This is *not* part of the BareBars core — it is the second pass that gives
-- | the skeleton AST meaning. Helper resolution, argument evaluation, and
-- | stringification all live here; truthiness, escaping, and clause shape live
-- | in the helpers it calls (`BareBars.Prelude`).
-- |
-- | Arguments are evaluated eagerly, left to right, before a helper runs. A
-- | block helper instead receives its captured `body` as a `Template`, plus
-- | `renderTemplate`, so it can render sub-templates lazily and interpret
-- | nested clause blocks.
module BareBars.Eval
  ( render
  , evalExpr
  ) where

import Prelude

import BareBars.Env (Env, Helper, HelperCtx, lookupHelper, runHelper)
import BareBars.Error (Error(..))
import BareBars.Syntax (Expr(..), Node(..), Template)
import BareBars.Value (Value, stringify)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.String.Common (joinWith)
import Data.Traversable (traverse)

render :: Template -> Env -> Either Error String
render tmpl env = joinWith "" <$> traverse (renderNode env) tmpl

renderNode :: Env -> Node -> Either Error String
renderNode env = case _ of
  Content s -> Right s
  Output e -> evalExpr env e >>= stringify
  Block name args body -> do
    vals <- traverse (evalExpr env) args
    h <- resolve name env
    v <- runHelper h (ctx env body) vals
    stringify v
  RawBlock name args raw -> do
    vals <- traverse (evalExpr env) args
    h <- resolve name env
    -- The verbatim body is exposed as a single Content node.
    v <- runHelper h (ctx env [ Content raw ]) vals
    stringify v

evalExpr :: Env -> Expr -> Either Error Value
evalExpr env = case _ of
  Lit v -> Right v
  App name args -> do
    vals <- traverse (evalExpr env) args
    h <- resolve name env
    runHelper h (ctx env []) vals

-- | Build the context handed to a helper. `renderTemplate` is `render` itself,
-- | so helpers can render captured bodies and clauses against any environment.
ctx :: Env -> Template -> HelperCtx
ctx env body = { env, body, renderTemplate: render }

resolve :: String -> Env -> Either Error Helper
resolve name env = case lookupHelper name env of
  Just h -> Right h
  Nothing -> Left (UnknownHelper name)
