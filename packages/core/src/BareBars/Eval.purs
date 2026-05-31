-- | The evaluator. See `docs/modules/ROOT/pages/evaluation.adoc` §3.4–3.5.
-- |
-- | Arguments are evaluated eagerly, left to right, before a helper runs. Block
-- | bodies are the exception: they are passed unevaluated as thunks.
module BareBars.Eval
  ( render
  , evalExpr
  ) where

import Prelude

import BareBars.Env (Env, Helper(..), emptyBlocks, lookupHelper, pushHelpers, runHelper)
import BareBars.Error (Error(..))
import BareBars.Syntax (Expr(..), Node(..), Template)
import BareBars.Value (Value(..), stringify)
import Data.Array (zip)
import Data.Either (Either(..))
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))

render :: Template -> Env -> Either Error String
render tmpl env = joinWith "" <$> traverse (renderNode env) tmpl

renderNode :: Env -> Node -> Either Error String
renderNode env = case _ of
  Content s -> Right s
  Output e -> evalExpr env e >>= stringify
  Block name args body branches -> do
    vals <- traverse (evalExpr env) args
    h <- resolve name env
    -- Evaluate each branch's separator arguments eagerly in the block's env.
    branchVals <- traverse (\br -> traverse (evalExpr env) br.args) branches
    let
      -- Each separator name becomes a scoped helper that renders its branch
      -- (VSafe — already safe). This is the whole of "`else` is a scoped
      -- helper": the core hardcodes no name, it just installs whatever
      -- separators the author wrote. (evaluation.adoc §3.5)
      branchFrame = Map.fromFoldable
        (map (\br -> Tuple br.sep (Helper \e _ _ -> VSafe <$> render br.body e)) branches)
      renderIn t e = render t (pushHelpers branchFrame e)
      blocks =
        { body: \e -> renderIn body e
        , branches: map
            (\(Tuple br bargs) -> { sep: br.sep, args: bargs, render: \e -> renderIn br.body e })
            (zip branches branchVals)
        }
    v <- runHelper h env vals blocks
    stringify v
  RawBlock name args raw -> do
    vals <- traverse (evalExpr env) args
    h <- resolve name env
    let blocks = { body: \_ -> Right raw, branches: [] }
    v <- runHelper h env vals blocks
    stringify v

evalExpr :: Env -> Expr -> Either Error Value
evalExpr env = case _ of
  Lit v -> Right v
  App name args -> do
    vals <- traverse (evalExpr env) args
    h <- resolve name env
    runHelper h env vals emptyBlocks

resolve :: String -> Env -> Either Error Helper
resolve name env = case lookupHelper name env of
  Just h -> Right h
  Nothing -> Left (UnknownHelper name)
