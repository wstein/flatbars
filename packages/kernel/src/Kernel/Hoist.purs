-- | Inline-partial hoisting — a *shared* FlatBars concept, not a surface feature.
-- |
-- | `{{#inline "name"}}body{{/inline}}` defines a partial; this pre-pass lifts
-- | every such definition out of the template into a partial registry and returns
-- | the template with the `inline` blocks removed. It is a semantic step tied to
-- | the prelude's `inline`/`partial` operations (the registry the `partial` helper
-- | reads), NOT a syntactic desugar — so it belongs to the shared engine machinery
-- | and applies to *every* dialect. RawBars (core syntax), ClassicBars, and MaxBars
-- | all run it, differing only in their surface syntax (ADR-005/008): the bare
-- | `{{#inline}}` in core/MaxBars and the desugared `{{#*inline}}` decorator in
-- | ClassicBars both reduce to the same `inline` block this walks.
-- |
-- | Definitions are *global* to the render (not lexically scoped) — a documented
-- | simplification of Handlebars' block scoping.
module Kernel.Hoist
  ( hoistInline
  ) where

import Data.Array as Array
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import FlatBars.Syntax (Expr(..), Node(..), Template)
import FlatBars.Value (Value(..))

-- | Hoist `{{#inline "name"}}body{{/inline}}` definitions out of a template into a
-- | partial registry, returning that registry and the template with the `inline`
-- | blocks removed. Recurses into block bodies, so a nested inline is hoisted too;
-- | an inline-free template is returned structurally unchanged.
hoistInline :: Template -> { partials :: Map String Template, template :: Template }
hoistInline nodes = Array.foldl step { partials: Map.empty, template: [] } nodes
  where
  step acc = case _ of
    Block _ _ "inline" args body
      | Just name <- inlineName args ->
          let
            inner = hoistInline body
          in
            acc
              { partials = Map.insert name inner.template (Map.union acc.partials inner.partials) }
    Block sp sig name args body ->
      let
        inner = hoistInline body
      in
        acc
          { partials = Map.union acc.partials inner.partials
          , template = Array.snoc acc.template (Block sp sig name args inner.template)
          }
    other -> acc { template = Array.snoc acc.template other }
  inlineName args = case Array.head args of
    Just (Lit (VString n)) -> Just n
    _ -> Nothing
