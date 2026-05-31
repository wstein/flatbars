-- | BareBars — the *structural* core. See `docs/modules/ROOT/pages/host-api.adoc`.
-- |
-- | This package is purely structural and meaning-free: the lexer/parser, the
-- | skeleton AST (`Syntax`), the literal `Value` data type, source spans, and
-- | parse errors. It assigns *no* meaning — no evaluation driver, no helper
-- | combinators, no clause/`else` handling, no validation. Those are the shared
-- | engine (the `kernel` package); dialects (rawbars/fullbars/maxbars) build on
-- | the kernel. See ADR-001 and the kernel-migration notes.
module BareBars
  ( module BareBars.Syntax
  , module BareBars.Value
  , module BareBars.Error
  , module BareBars.Span
  , module BareBars.Parser
  ) where

import BareBars.Error (Error(..), ParseDiagnostic, ParseError(..), parseErrorAt, parseErrorOffset, renderError, renderParseError, renderParseErrorAt)
import BareBars.Parser (ExprParser, ParseOptions, defaultParseOptions, parse, parseWith)
import BareBars.Span (Span, lineColumn, spanText)
import BareBars.Syntax (Directive, Expr(..), Ident, Node(..), Sigil(..), Template)
import BareBars.Value (Value(..))
