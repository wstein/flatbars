-- | The parsed core abstract syntax. See `docs/modules/ROOT/pages/evaluation.adoc` §3.1.
-- |
-- | There is no node for comments (the lexer drops them) and no `Group`
-- | constructor — parentheses only affect parsing; `(e)` and `e` produce the
-- | same `Expr`.
-- | The *skeleton* AST. It is purely syntactic: a `Block` is just a named
-- | application with a captured body. The core attaches no meaning to any name
-- | and has no notion of an "inverse" or "else"; `{{else}}` is just a `Sep`
-- | marker. All of that — including separator-driven control flow — is the job
-- | of the engine's second pass (see `Kernel.Walk` for the traversal toolkit
-- | and `Kernel.Engine` for the interpreting driver).
module BareBars.Syntax
  ( Ident
  , Template
  , Node(..)
  , Sigil(..)
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
  -- span, opener sigil, head, args, captured body
  | Block Span Sigil Ident (Array Expr) Template
  -- span, head, args, verbatim body
  | RawBlock Span Ident (Array Expr) String
  -- span, head, args (a name-agnostic separator marker)
  | Sep Span Ident (Array Expr)

-- | A block's opener *sigil* — a structural marker the core records but assigns
-- | no meaning. `Section` is `{{#name}}`; `Inverse` is `{{^name}}` (and the
-- | triple variant `{{{^name}}}`). `Parent` is the Mustache-inheritance parent
-- | tag `{{<name}}` and `BlockDef` the override-block tag `{{$name}}` (each with
-- | a dynamic-name spelling whose head begins with `*`, e.g. `{{<*name}}`). The
-- | engine/dialect decides what these mean (FullBars desugars `Inverse` to
-- | `unless`; inheritance is wired in a later phase); the core only knows the
-- | shape, and a dialect must opt in (`ParseOptions.inheritance`) to accept the
-- | `Parent`/`BlockDef` shapes at all.
data Sigil = Section | Inverse | Parent | BlockDef

derive instance eqSigil :: Eq Sigil

instance showSigil :: Show Sigil where
  show Section = "Section"
  show Inverse = "Inverse"
  show Parent = "Parent"
  show BlockDef = "BlockDef"

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
    Block _ sig n args body ->
      "Block " <> show sig <> " " <> show n <> " " <> show args <> " " <> show body
    RawBlock _ n args raw -> "RawBlock " <> show n <> " " <> show args <> " " <> show raw
    Sep _ n args -> "Sep " <> show n <> " " <> show args
