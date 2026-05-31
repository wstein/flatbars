-- | BareBars — the framework (substrate) host API. See
-- | `docs/modules/ROOT/pages/host-api.adoc`.
-- |
-- | This package is *engine-agnostic*: a structural lexer/parser, the value
-- | data type, the polymorphic inversion-of-control driver, and the
-- | skeleton-AST traversal/validation toolkit. It contains *no* helper names,
-- | truthiness, or escaping policy — those belong to an engine built on top
-- | (e.g. `FlatBars`, the reference engine). See ADR-001.
module BareBars
  ( module BareBars.Syntax
  , module BareBars.Value
  , module BareBars.Error
  , module BareBars.Span
  , module BareBars.Engine
  , module BareBars.Helper
  , module BareBars.Parser
  , module BareBars.Walk
  ) where

import BareBars.Engine (Ctl, Engine, Helper, runString, runTemplate)
import BareBars.Error (Error(..), ParseDiagnostic, ParseError(..), parseErrorAt, parseErrorOffset, renderError, renderParseError, renderParseErrorAt)
import BareBars.Helper (ArgSpec, atLeast, binary, nullary, unary, variadic)
import BareBars.Parser (parse, parseExprTokens)
import BareBars.Span (Span, lineColumn, spanText)
import BareBars.Syntax (Expr(..), Ident, Node(..), Template)
import BareBars.Value (Value(..))
import BareBars.Walk
  ( Algebra
  , Arity(..)
  , Clause
  , ExprAlgebra
  , HelperRef
  , HelperSpec
  , Issue
  , RefKind(..)
  , Schema
  , Severity(..)
  , foldExpr
  , foldRefs
  , foldTemplate
  , helperRefs
  , splitClause
  , splitClauses
  , validate
  )
