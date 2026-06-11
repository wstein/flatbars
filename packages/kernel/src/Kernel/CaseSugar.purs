-- | **`{{#case}}` surface rule** — the one thing the recovering parser cannot enforce
-- | structurally: only whitespace may precede the first `{{when}}` arm (docs/12 §2; no
-- | Liquid-style silent fall-through). `case` itself is a *first-class* engine operation
-- | (`Kernel.Prelude.caseH`) lowered to a Rust `match` by the Trussbars AOT compiler — it is
-- | **not** desugared. This check is shared by the `nonEmpty`-family front-ends (RawBars
-- | parses through it; MaxBars runs it from `checkSurfaceStrict`) so the located error is
-- | identical across them.
module Kernel.CaseSugar
  ( caseLeadingViolation
  , braceControlViolation
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.String (trim)
import Data.String.CodeUnits (drop, take)
import FlatBars.Syntax (Ident, Node(..), Sigil(..), Template)

-- | The first `{{#case}}` whose body carries non-whitespace content before its first
-- | `{{when}}`/`{{else}}` arm — its offset and a "shape" string for the located
-- | `DisallowedShape` error. Searched depth-first, so a nested `case` is caught.
caseLeadingViolation :: Template -> Maybe { off :: Int, shape :: String }
caseLeadingViolation nodes = Array.head (Array.mapMaybe node nodes)
  where
  node = case _ of
    Block _ Section "case" _ body -> case leadingOffset body of
      Just off -> Just { off, shape: caseLeadingShape }
      Nothing -> caseLeadingViolation body
    Block _ _ _ _ body -> caseLeadingViolation body
    _ -> Nothing
  leadingOffset nodes' = case Array.uncons nodes' of
    Just { head: Sep _ "when" _ } -> Nothing
    Just { head: Sep _ "else" _ } -> Nothing
    Just { head: Content _ s, tail } | trim s == "" -> leadingOffset tail
    Just { head } -> Just (nodeStart head)
    Nothing -> Nothing
  caseLeadingShape =
    "{{#case}} (only whitespace may precede the first {{when}} — move leading content into a {{when}}/{{else}} arm)"

-- | The first `{{ … }}`-delimited CONTROL tag (a block open/close or a clause
-- | separator) in `nodes` — its offset and a "shape" string for the located
-- | `DisallowedShape` error, searched depth-first through block bodies. In a
-- | `statementTags` dialect (RawBars/MaxBars, docs-19) control flow is written with
-- | Django-style `{% … %}` tags and `{{ … }}` is OUTPUT-ONLY, so a legacy `{{#if}}` /
-- | `{{/if}}` / bare `{{else}}` is rejected with an actionable "use {% … %}" message
-- | rather than silently re-accepted (the no-silent-no-op bar — CLAUDE.md). Every
-- | brace-origin quad-stache `{{{{ … }}}}` is rejected too (ADR-039 item 2 + the
-- | 2026-06-11 amendment): `{{{{#raw}}}}` → `{% raw %}` (a verbatim region), and a
-- | raw-block *helper* (`{{{{#op}}}}`, op ≠ `raw`) is *dropped* — `{% raw %}` is
-- | literal-only, a helper cannot consume a raw body. (ClassicBars keeps its
-- | Handlebars `{{{{ }}}}` raw blocks: this runs only when `statementTags` is on.)
-- |
-- | `clauses` are the engine's clause-separator names (`else`/`elif`/`when`): only a
-- | `Sep` with one of those names is a *control* separator. A bare `{{name}}` is a
-- | `Sep` too in the skeleton (output vs separator is settled at desugar, not parse),
-- | so the name gate is what keeps plain output from being mistaken for control.
braceControlViolation :: Array Ident -> String -> Template -> Maybe { off :: Int, shape :: String }
braceControlViolation clauses src nodes = Array.head (Array.mapMaybe node nodes)
  where
  node = case _ of
    Block sp _ name _ body
      | isBrace sp -> Just { off: sp.start, shape: blockShape name }
      | otherwise -> braceControlViolation clauses src body
    Sep sp name _
      | isBrace sp && Array.elem name clauses -> Just { off: sp.start, shape: sepShape name }
      -- The partial include `{{> name}}` and the block-partial slot `{{yield}}` move to
      -- `{% include "name" %}` / `{% yield %}` (ADR-039 item 5) — a partial expansion and
      -- a structural slot are statements, not output. (The `{% include %}` form lexes to
      -- a `>`-Sep whose span opens `{%`, so `isBrace` spares it.)
      | isBrace sp && take 1 name == ">" -> Just { off: sp.start, shape: includeShape }
      | isBrace sp && name == "yield" -> Just { off: sp.start, shape: yieldShape }
    -- Every brace-origin quad-stache moves to a `{% … %}` form (ADR-039 item 2 + the
    -- 2026-06-11 amendment): `{{{{#raw}}}}` → `{% raw %}`, and a raw-block *helper*
    -- (`op ≠ raw`) is dropped (`{% raw %}` is literal-only — no head, no helper).
    RawBlock sp name _ _
      | isBrace sp -> Just { off: sp.start, shape: rawShape name }
    _ -> Nothing
  isBrace sp = take 2 (drop sp.start src) == "{{"
  blockShape name =
    "{{#" <> name
      <> " …}} (control flow uses Django-style {% … %} tags in this dialect — write {% "
      <> name
      <> " … %} … {% end"
      <> name
      <> " %})"
  sepShape name =
    "{{" <> name
      <> " …}} (a clause separator uses a {% … %} tag in this dialect — write {% "
      <> name
      <> " … %})"
  rawShape name =
    if name == "raw" then
      "{{{{#raw}}}} … {{{{/raw}}}} (a verbatim region uses a {% … %} tag in this dialect — write {% raw %} … {% endraw %})"
    else
      "{{{{#" <> name <> "}}}} … {{{{/" <> name
        <>
          "}}}} (a helper can't consume a raw body in this dialect — {% raw %} is literal-only; use {% raw %} … {% endraw %} for a verbatim region, or pre-format the value in the host and emit it with {{ x | safe }})"
  includeShape =
    "{{> name}} (a partial include uses a {% … %} tag in this dialect — write {% include \"name\" %})"
  yieldShape =
    "{{yield}} (the block-partial slot uses a {% … %} tag in this dialect — write {% yield %})"

-- | The source offset of a node's span (for located errors).
nodeStart :: Node -> Int
nodeStart = case _ of
  Content sp _ -> sp.start
  Output sp _ -> sp.start
  Block sp _ _ _ _ -> sp.start
  RawBlock sp _ _ _ -> sp.start
  Sep sp _ _ -> sp.start
  NodeError sp _ -> sp.start
