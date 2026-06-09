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
module FlatBars.Syntax
  ( Ident
  , Template
  , Node(..)
  , Sigil(..)
  , Expr(..)
  , Directive
  , splitBlockArgs
  ) where

import Prelude

import Data.Array (findMap, mapMaybe) as Array
import Data.Maybe (Maybe(..))
import FlatBars.Span (Span)
import FlatBars.Value (Value(..))

type Ident = String

type Template = Array Node

-- | A *header directive* lifted from a `{{! @key: value }}` comment — a
-- | meaning-free marker the core carries but never interprets (the `Sep`
-- | precedent applied to comments). A front-end/engine decides what a key means
-- | (e.g. `@trim`); the core only knows the *shape* `@key[: value]`. A flag
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
  -- span, literal text. Carries its source `Span` like every other node, so the
  -- mapped runner can locate a literal output run (jump-to-source) and the lowered
  -- AST gives `RText` a `src` (ADR-035).
  = Content Span String
  | Output Span Expr
  -- span, opener sigil, head, args, captured body
  | Block Span Sigil Ident (Array Expr) Template
  -- span, head, args, verbatim body
  | RawBlock Span Ident (Array Expr) String
  -- span, head, args (a name-agnostic separator marker)
  | Sep Span Ident (Array Expr)
  -- A RECOVERED parse error (ADR-023): the span of the offending tag and a
  -- message. Only the *recovering* parser (`parseRecovering`) ever emits this —
  -- it keeps parsing past an error so an IDE can report every problem at once.
  -- The total `parse` is a fail-fast projection that returns `Left` whenever any
  -- error was recovered, so the render/compile path never sees a `NodeError`.
  | NodeError Span String

-- | A block's opener *sigil* — a structural marker the core records but assigns
-- | no meaning. `Section` is `{{#name}}`; `Inverse` is `{{^name}}` (and the
-- | triple variant `{{{^name}}}`). `Parent` is the Mustache-inheritance parent
-- | tag `{{<name}}` and `BlockDef` the override-block tag `{{$name}}` (each with
-- | a dynamic-name spelling whose head begins with `*`, e.g. `{{<*name}}`). The
-- | engine/dialect decides what these mean (FullBars desugars `Inverse` to
-- | `unless`; inheritance is wired per dialect); the core only knows the shape,
-- | and a dialect must opt in (`ParseOptions.inheritance`) to accept the
-- | inheritance shapes at all.
-- |
-- | The Handlebars block-partial opener `{{#>name}}` and the inline-partial
-- | *decorator* `{{#*name …}}` ARE first-class sigils: `{{#>` lexes as
-- | `PartialBlock` and `{{#*` as `Decorator`, each with a clean head (the partial
-- | name / the decorator name — no composite `>`/`*` prefix). Their `{{/…}}` close
-- | repeats that head. A dialect must opt in (`ParseOptions.partialBlocks` /
-- | `ParseOptions.decorators`) to accept them; the surface maps `PartialBlock` onto
-- | `partial` and a `Decorator` onto the hoisted inline definition.
data Sigil = Section | Inverse | Parent | BlockDef | PartialBlock | Decorator

derive instance eqSigil :: Eq Sigil

instance showSigil :: Show Sigil where
  show Section = "Section"
  show Inverse = "Inverse"
  show Parent = "Parent"
  show BlockDef = "BlockDef"
  show PartialBlock = "PartialBlock"
  show Decorator = "Decorator"

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
    Content _ s -> "Content " <> show s
    Output _ e -> "Output (" <> show e <> ")"
    Block _ sig n args body ->
      "Block " <> show sig <> " " <> show n <> " " <> show args <> " " <> show body
    RawBlock _ n args raw -> "RawBlock " <> show n <> " " <> show args <> " " <> show raw
    Sep _ n args -> "Sep " <> show n <> " " <> show args
    NodeError _ msg -> "NodeError " <> show msg

-- | Split a block head's arguments into the positional args, the surface hash,
-- | the `as |…|` block-param names, and a loop `label NAME` (ADR-013) — recognising
-- | the reserved `@hash` / `@param` / `@label` markers a dialect surface emits for a
-- | *block* head (ADR-020 Phase 3 / ADR-013). Pure and structural: it assigns no
-- | meaning, only reshapes `Expr`s — `@hash` demarkers to a `dict` application (the
-- | value built-ins already expect), `@param` to its bare name literal, and `@label`
-- | is lifted out entirely (it names a frame binding, never a positional argument).
-- | A no-op when no markers are present (e.g. RawBars/MinBars, or inline calls), so
-- | it is safe as the default split.
splitBlockArgs
  :: Array Expr
  -> { positional :: Array Expr, hash :: Maybe Expr, params :: Array String, label :: Maybe String }
splitBlockArgs args =
  { positional: Array.mapMaybe demarker args
  , hash: Array.findMap asHash args
  , params: Array.mapMaybe asParam args
  , label: Array.findMap asLabel args
  }
  where
  demarker = case _ of
    App "@label" _ -> Nothing -- routed via `label`, never a positional argument
    App "@hash" pairs -> Just (App "dict" pairs)
    App "@param" [ Lit (VString n) ] -> Just (Lit (VString n))
    e -> Just e
  asHash = case _ of
    App "@hash" pairs -> Just (App "dict" pairs)
    _ -> Nothing
  asParam = case _ of
    App "@param" [ Lit (VString n) ] -> Just n
    _ -> Nothing
  asLabel = case _ of
    App "@label" [ Lit (VString n) ] -> Just n
    _ -> Nothing
