-- | **`{{#case}}` surface rule** — the one thing the recovering parser cannot enforce
-- | structurally: only whitespace may precede the first `{{when}}` arm (docs/12 §2; no
-- | Liquid-style silent fall-through). `case` itself is a *first-class* engine operation
-- | (`Kernel.Prelude.caseH`) lowered to a Rust `match` by the Trussbars AOT compiler — it is
-- | **not** desugared. This check is shared by the `nonEmpty`-family front-ends (RawBars
-- | parses through it; MaxBars runs it from `checkSurfaceStrict`) so the located error is
-- | identical across them.
module Kernel.CaseSugar
  ( caseLeadingViolation
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.String (trim)
import FlatBars.Syntax (Node(..), Sigil(..), Template)

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

-- | The source offset of a node's span (for located errors).
nodeStart :: Node -> Int
nodeStart = case _ of
  Content sp _ -> sp.start
  Output sp _ -> sp.start
  Block sp _ _ _ _ -> sp.start
  RawBlock sp _ _ _ -> sp.start
  Sep sp _ _ -> sp.start
  NodeError sp _ -> sp.start
