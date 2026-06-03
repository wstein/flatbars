-- | The reference engine's *lowering* — the walker that turns the structural
-- | AST into a *real* (typed, meaningful) AST. See ADR-001 and
-- | `docs/modules/ROOT/pages/surface.adoc`.
-- |
-- | This is the second pass made inspectable: `lower` is a pure `foldTemplate`
-- | over the structural skeleton that (1) resolves *escaping* — `escapeHtml e`
-- | becomes `ROut true e`, everything else `ROut false e` — and (2) resolves
-- | *clauses* — a block's `{{else}}` separator is consumed and the body split
-- | into the typed branches of `RIf`/`RUnless`/`REach`/`RWith`. The structural
-- | parser knows none of this; the walker decides all of it.
-- |
-- | The reference renderer interprets the structural tree directly, so `lower`
-- | is not required on the render path — it is the materializable real AST that
-- | tooling (the playground, a formatter, a linter) inspects, and the basis of
-- | `escapingWarnings`. The real AST is *this* engine's; another engine may
-- | lower to a different shape.
module Kernel.Lower
  ( RNode(..)
  , lower
  , escapingWarnings
  , directiveLints
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Tuple (Tuple(..), uncurry)
import FlatBars.Syntax (Directive, Expr(..), Ident, Template)
import Kernel.Walk (Clause, Issue, Severity(..), foldTemplate, splitClause, splitClauses)

-- | The reference real AST. Control flow is explicit (branches, not a flat
-- | `Sep` marker) and escaping is a boolean, not a wrapper helper.
data RNode
  = RText String
  | ROut Boolean Expr -- escaped?, expression
  | RIf Expr (Array RNode) (Array RNode) -- cond, then, else
  | RUnless Expr (Array RNode) (Array RNode) -- cond, body, else
  | REach Expr (Array RNode) (Array RNode) -- collection, body, empty-clause
  | RWith Expr (Array RNode) (Array RNode) -- context, body, else
  | RCall Ident (Array Expr) (Array RNode) -- any other block helper
  | RSep Ident (Array Expr) -- a separator not consumed by a block
  | RRaw String -- a raw block's verbatim body

derive instance eqRNode :: Eq RNode

instance showRNode :: Show RNode where
  show = case _ of
    RText s -> "RText " <> show s
    ROut e x -> "ROut " <> show e <> " (" <> show x <> ")"
    RIf c a b -> "RIf (" <> show c <> ") " <> show a <> " " <> show b
    RUnless c a b -> "RUnless (" <> show c <> ") " <> show a <> " " <> show b
    REach c a b -> "REach (" <> show c <> ") " <> show a <> " " <> show b
    RWith c a b -> "RWith (" <> show c <> ") " <> show a <> " " <> show b
    RCall n args ch -> "RCall " <> show n <> " " <> show args <> " " <> show ch
    RSep n args -> "RSep " <> show n <> " " <> show args
    RRaw s -> "RRaw " <> show s

-- | Lower a structural template to the reference real AST.
lower :: Template -> Array RNode
lower = foldTemplate
  { content: \s -> [ RText s ]
  , output: \e -> [ uncurry ROut (escaping e) ]
  , raw: \_ _ body -> [ RRaw body ]
  , sep: \name args -> [ RSep name args ]
  , block: \b -> [ lowerBlock b.name b.args b.children b.recurse ]
  -- a recovered parse error (ADR-023) lowers to nothing; lowering only runs on
  -- error-free trees (the fail-fast parse projection rejects the rest).
  , nodeError: \_ _ -> []
  , concat: join
  }
  where
  -- `escapeHtml e` ⇒ escaped output of `e`; anything else is raw output as-is
  -- (so `safe x` stays visible as `ROut false (safe x)` — intentional trust).
  escaping :: Expr -> Tuple Boolean Expr
  escaping = case _ of
    App "escapeHtml" [ inner ] -> Tuple true inner
    e -> Tuple false e

  lowerBlock :: Ident -> Array Expr -> Template -> (Template -> Array RNode) -> RNode
  lowerBlock name args children recurse =
    let
      s = splitClause "else" children
      before = recurse s.before
      elseBranch = recurse (fromMaybe [] s.clause)
    in
      case Array.head args of
        -- `if` reads a full `elif`/`else` chain; fold it so the typed AST shows
        -- nested `RIf` branches (what the playground / lint inspect), matching
        -- the engine's short-circuit walk.
        Just c | name == "if" -> lowerIf c children recurse
        Just c
          | name == "unless" -> RUnless c before elseBranch
          | name == "each" -> REach c before elseBranch
          | name == "with" -> RWith c before elseBranch
        _ -> RCall name args (recurse children)

  -- An `{{#if c}}…{{elif d}}…{{else}}…{{/if}}` chain becomes nested `RIf`: each
  -- `elif` is the else-branch's `RIf`, and `else` is the innermost else-branch.
  lowerIf :: Expr -> Template -> (Template -> Array RNode) -> RNode
  lowerIf cond children recurse =
    let
      { before, clauses } = splitClauses children
    in
      RIf cond (recurse before) (foldClauses clauses)
    where
    foldClauses :: Array Clause -> Array RNode
    foldClauses cs = case Array.uncons cs of
      Nothing -> []
      Just { head: cl, tail } -> case cl.name, cl.args of
        "elif", [ c ] -> [ RIf c (recurse cl.body) (foldClauses tail) ]
        _, _ -> recurse cl.body -- `else` (terminal); malformed clauses best-effort

-- | Safe-by-default lint. Two warnings:
-- |
-- |  1. *Forgot to escape* — a *raw* output (`{{{ … }}}`, not `escapeHtml`) emits
-- |     untrusted *data* (a `lookup`/`this`/scoped accessor not wrapped in
-- |     `safe`). The reference renderer never auto-escapes raw output, so this
-- |     is where "you forgot to escape" is caught.
-- |
-- |  2. *Testing rendered output* — an `if`/`unless` condition headed by
-- |     `escapeHtml`/`safe`/`raw`. Those produce *output text*, not data, so
-- |     testing their truthiness is a category error: `safe`/`escapeHtml`
-- |     stringify first, so `safe 0` is truthy while `0` is falsy. Test the
-- |     underlying data instead.
escapingWarnings :: Template -> Array Issue
escapingWarnings = walk <<< lower
  where
  walk :: Array RNode -> Array Issue
  walk nodes = Array.concatMap node nodes

  node :: RNode -> Array Issue
  node = case _ of
    ROut false (App name _)
      | Array.elem name dataAccessors ->
          [ { severity: Warn
            , name
            , message: "raw output of data '" <> name <> "' — wrap in escapeHtml, or mark safe"
            }
          ]
    RIf c a b -> condWarn c <> walk a <> walk b
    RUnless c a b -> condWarn c <> walk a <> walk b
    REach _ a b -> walk a <> walk b
    RWith _ a b -> walk a <> walk b
    RCall _ _ ch -> walk ch
    _ -> []

  -- An `if`/`unless` condition that tests the result of an output-producing
  -- helper (escaped/safe/raw) rather than the underlying data.
  condWarn :: Expr -> Array Issue
  condWarn = case _ of
    App name _
      | Array.elem name safeProducers ->
          [ { severity: Warn
            , name
            , message: "testing the truthiness of an escaped/safe value ('" <> name
                <> "') — test the underlying data instead"
            }
          ]
    _ -> []

  -- Accessors that yield arbitrary (string) data — the real injection surface.
  -- Numeric scoped scalars (`index`, `first`, `last`) are intentionally excluded.
  dataAccessors :: Array Ident
  dataAccessors = [ "lookup", "this", "root", "parent", "key" ]

  -- Helpers that produce output text (a `VSafe`) rather than data.
  safeProducers :: Array Ident
  safeProducers = [ "escapeHtml", "safe", "raw" ]

--------------------------------------------------------------------------------
-- Directive lints
--------------------------------------------------------------------------------

-- | Lint header-directive keys. `trim` (core whitespace) is the one understood
-- | key, so it is silent. `truthiness` is *deprecated* (ADR-022): truthiness is a
-- | fixed per-engine rule now, so a `@truthiness` directive is inert — it warns
-- | (carried, never an error) so a stale directive does not silently mislead. Any
-- | other key is unknown (carried for forward compatibility) and also warns.
directiveLints :: Array Directive -> Array Issue
directiveLints = Array.mapMaybe lintOne
  where
  lintOne d = case d.key of
    "trim" -> Nothing
    "truthiness" -> Just
      { severity: Warn
      , name: d.key
      , message: "'@truthiness' is no longer honoured (ADR-022) — truthiness is a "
          <> "fixed per-engine rule; the directive is carried but inert"
      }
    _ -> Just
      { severity: Warn
      , name: d.key
      , message: "unknown directive '@" <> d.key
          <> "' — carried but not understood by this engine"
      }
