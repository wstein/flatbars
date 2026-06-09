-- | Source spans for diagnostics.
-- |
-- | A `Span` is a half-open range of **code-unit** (UTF-16) offsets into the
-- | original template source — the same units a JS string / CodeMirror position
-- | uses, so a host consumes them with no byte↔char conversion (ADR-035). It is
-- | attached to *every* AST node — the tag nodes (`Output`, `Block`, `RawBlock`,
-- | `Sep`) and the literal `Content` run — by the parser, and surfaced to helpers on
-- | the control handle (`Kernel.Engine.Ctl`), so an engine can point a diagnostic at
-- | (or a host can jump-to-source for) the offending node. `lineColumn` turns an
-- | offset into a 1-based line/column.
module FlatBars.Span
  ( Span
  , spanText
  , lineColumn
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.String.CodeUnits as SCU

type Span = { start :: Int, end :: Int }

-- | The source text the span covers.
spanText :: String -> Span -> String
spanText src { start, end } = SCU.take (end - start) (SCU.drop start src)

-- | The 1-based line and column of a code-unit offset into `src`.
lineColumn :: String -> Int -> { line :: Int, column :: Int }
lineColumn src offset =
  let
    cs = SCU.toCharArray (SCU.take offset src)
    nls = Array.length (Array.filter (_ == '\n') cs)
    col = case Array.findLastIndex (_ == '\n') cs of
      Just i -> Array.length cs - i
      Nothing -> Array.length cs + 1
  in
    { line: nls + 1, column: col }
