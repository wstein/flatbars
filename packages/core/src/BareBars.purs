-- | BareBars — the host API. See `docs/modules/ROOT/pages/host-api.adoc`.
-- |
-- | This is the entry point a host imports. It re-exports the core types and
-- | wires `parse` + the reference `prelude` into convenience functions.
-- |
-- | ```purescript
-- | import BareBars as BB
-- |
-- | BB.renderWith "{{{ esc_html (lookup this \"name\") }}}" (BB.VObject ...)
-- | ```
module BareBars
  ( module BareBars.Syntax
  , module BareBars.Value
  , module BareBars.Error
  , module BareBars.Env
  , module BareBars.Parser
  , module BareBars.Eval
  , module BareBars.Prelude
  , module BareBars.Walk
  , preludeEnv
  , compile
  , renderWith
  ) where

import Prelude

import BareBars.Env (Env, Helper(..), emptyEnv, register, registerAll)
import BareBars.Error (Error, ParseError)
import BareBars.Eval (render, runTemplate)
import BareBars.Parser (parse)
import BareBars.Prelude (prelude, preludeSchema)
import BareBars.Syntax (Expr(..), Node(..), Template)
import BareBars.Value (Value(..), stringify, truthy)
import BareBars.Walk (Algebra, foldTemplate, helperRefs, splitClause, validate)
import Data.Either (Either(..))

-- | Build an environment with the reference prelude, the given data as context,
-- | and a `root` helper that returns the top-level data.
preludeEnv :: Value -> Env
preludeEnv dat =
  registerAll prelude
    (register "root" (Helper \_ _ -> Right dat) (emptyEnv dat))

-- | Parse a *core* template and return a renderer closed over the reference
-- | prelude. (The surface front-end is a separate, not-yet-complete step; see
-- | `BareBars.Surface`.)
compile :: String -> Either ParseError (Value -> Either Error String)
compile src = do
  tmpl <- parse src
  pure \dat -> render tmpl (preludeEnv dat)

-- | One-shot: parse core source and render against prelude + data.
renderWith :: String -> Value -> Either String String
renderWith src dat = case parse src of
  Left pe -> Left (show pe)
  Right tmpl -> case render tmpl (preludeEnv dat) of
    Left e -> Left (show e)
    Right out -> Right out
