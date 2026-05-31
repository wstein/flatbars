-- | The parsed core abstract syntax. See `docs/modules/ROOT/pages/evaluation.adoc` §3.1.
-- |
-- | There is no node for comments (the lexer drops them) and no `Group`
-- | constructor — parentheses only affect parsing; `(e)` and `e` produce the
-- | same `Expr`.
-- | The *skeleton* AST. It is purely syntactic: a `Block` is just a named
-- | application with a captured body. The core attaches no meaning to any name
-- | and has no notion of an "inverse" or "else"; `{{else}}` is just a `Sep`
-- | marker. All of that — including separator-driven control flow — is the job
-- | of the engine's second pass (see `BareBars.Walk` for the traversal toolkit
-- | and `BareBars.Engine` for the interpreting driver).
module BareBars.Syntax
  ( Ident
  , Template
  , Node(..)
  , Expr(..)
  , Directive
  ) where

import Prelude

import BareBars.Span (Span)
import BareBars.Value (Value)

type Ident = String

type Template = Array Node

-- | A *header directive* lifted from a `{{! @key: value }}` comment — a
-- | meaning-free marker the core carries but never interprets (the `Sep`
-- | precedent applied to comments). The engine decides what `@truthiness`,
-- | `@dialect`, … mean; the core only knows the *shape* `@key[: value]`. A flag
-- | directive (`@key` with no colon) is normalised to `value = "true"`, so a
-- | downstream reader sees one shape. `span` covers `@key` … end-of-value.
type Directive = { key :: Ident, value :: String, span :: Span }

-- | Tag-level nodes carry the source `Span` of their opening tag, for
-- | diagnostics. `Content` does not (it is literal text, never a helper call).
-- |
-- | `Sep` is a *separator* — the bare double-stash `{{ name args }}`. The core
-- | attaches it *no meaning*: it is a flat marker node sitting in a template,
-- | exactly as the parser found it. Whether `{{else}}` splits an `if`, or
-- | `{{case 1}}` a `switch`, is decided entirely by the second pass (the engine
-- | walk) — the lexer and parser never interpret the name.
data Node
  = Content String
  | Output Span Expr
  -- span, head, args, captured body
  | Block Span Ident (Array Expr) Template
  -- span, head, args, verbatim body
  | RawBlock Span Ident (Array Expr) String
  -- span, head, args (a name-agnostic separator marker)
  | Sep Span Ident (Array Expr)

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
    Output _ e -> "Output (" <> show e <> ")"
    Block _ n args body -> "Block " <> show n <> " " <> show args <> " " <> show body
    RawBlock _ n args raw -> "RawBlock " <> show n <> " " <> show args <> " " <> show raw
    Sep _ n args -> "Sep " <> show n <> " " <> show args
