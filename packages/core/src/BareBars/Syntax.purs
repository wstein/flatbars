-- | The parsed core abstract syntax. See `docs/modules/ROOT/pages/evaluation.adoc` §3.1.
-- |
-- | There is no node for comments (the lexer drops them) and no `Group`
-- | constructor — parentheses only affect parsing; `(e)` and `e` produce the
-- | same `Expr`.
module BareBars.Syntax
  ( Ident
  , Template
  , Branch
  , Node(..)
  , Expr(..)
  ) where

import Prelude

import BareBars.Value (Value)

type Ident = String

type Template = Array Node

-- | A block alternative introduced by an inline separator `{{sep args}}`. The
-- | core attaches no meaning to `sep` — `else`, `elif`, `case`, `otherwise` are
-- | all just names a helper may choose to interpret.
type Branch =
  { sep :: Ident
  , args :: Array Expr
  , body :: Template
  }

data Node
  = Content String
  | Output Expr
  -- head, args, primary body, then zero or more name-agnostic branches
  | Block Ident (Array Expr) Template (Array Branch)
  -- head, args, verbatim body
  | RawBlock Ident (Array Expr) String

data Expr
  = Lit Value
  | App Ident (Array Expr)

derive instance eqExpr :: Eq Expr
derive instance eqNode :: Eq Node

instance showExpr :: Show Expr where
  show = case _ of
    Lit v -> "Lit " <> show v
    App name args -> "App " <> show name <> " " <> show args

instance showNode :: Show Node where
  show = case _ of
    Content s -> "Content " <> show s
    Output e -> "Output (" <> show e <> ")"
    Block n args body branches -> "Block " <> show n <> " " <> show args <> " " <> show body <> " "
      <> show branches
    RawBlock n args raw -> "RawBlock " <> show n <> " " <> show args <> " " <> show raw
