-- | Source spans for diagnostics.
-- |
-- | A `Span` is a half-open range of code-unit offsets into the original
-- | template source. It is attached to the tag-level AST nodes (`Output`,
-- | `Block`, `RawBlock`) by the parser and surfaced to helpers on the control
-- | handle (`Kernel.Engine.Ctl`), so an engine can point a diagnostic at the
-- | offending tag. `lineColumn` turns an offset into a 1-based line/column.
module BareBars.Span
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
