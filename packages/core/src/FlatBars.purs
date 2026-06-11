-- | FlatBars — the *structural* core. See `docs/modules/ROOT/pages/host-api.adoc`.
-- |
-- | This package is purely structural and meaning-free: the lexer/parser, the
-- | skeleton AST (`Syntax`), the literal `Value` data type, source spans, and
-- | parse errors. It assigns *no* meaning — no evaluation driver, no helper
-- | combinators, no clause/`else` handling, no validation. Those are the shared
-- | engine (the `kernel` package); dialects (rawbars/classicbars/maxbars) build on
-- | the kernel. See ADR-001 and the kernel-migration notes.
module FlatBars
  ( module FlatBars.Syntax
  , module FlatBars.Value
  , module FlatBars.Error
  , module FlatBars.Span
  , module FlatBars.Parser
  ) where

import FlatBars.Error (Error(..), ParseDiagnostic, ParseError(..), parseErrorAt, parseErrorOffset, renderError, renderParseError, renderParseErrorAt, renderParseErrorsAt)
import FlatBars.Parser (ParseOptions, ParseResult, defaultParseOptions, parse, parseRecovering, parseWith)
import FlatBars.Span (Span, lineColumn, spanText)
import FlatBars.Syntax (Directive, Expr(..), Ident, Node(..), Sigil(..), Template)
import FlatBars.Value (Value(..))
