-- | Parse and evaluation errors. See `docs/modules/ROOT/pages/errors.adoc`.
-- |
-- | BareBars distinguishes *parse errors* (the template is not well-formed)
-- | from *evaluation errors* (the template is well-formed but cannot be
-- | rendered against the given environment and data). Only `UnknownHelper` is
-- | raised by the core itself; arity/type/other failures are raised by helpers.
module BareBars.Error
  ( ParseError(..)
  , Error(..)
  , renderParseError
  , renderError
  , parseErrorOffset
  , ParseDiagnostic
  , parseErrorAt
  , renderParseErrorAt
  ) where

import Prelude

import BareBars.Span (lineColumn)

-- | An offset is the index (in code units) into the source where the offending
-- | tag begins. A richer span (line/column) is left for a later iteration.
data ParseError
  = UnterminatedTag Int
  | UnterminatedComment Int
  | UnterminatedRaw Int
  | MismatchedBlock String String Int -- opened with, closed with
  | HeadNotIdent Int
  | EmptyOutput Int
  | BadEscape Int
  | LexError String Int

derive instance eqParseError :: Eq ParseError

instance showParseError :: Show ParseError where
  show = renderParseError

renderParseError :: ParseError -> String
renderParseError = case _ of
  UnterminatedTag o -> "UnterminatedTag: opener with no closer (at " <> show o <> ")"
  UnterminatedComment o -> "UnterminatedComment: {{! with no }} (at " <> show o <> ")"
  UnterminatedRaw o -> "UnterminatedRaw: {{{{#name}}}} with no matching close (at " <> show o <> ")"
  MismatchedBlock open close o ->
    "MismatchedBlock: {{/" <> close <> "}} closing {{#" <> open <> "}} (at " <> show o <> ")"
  HeadNotIdent o -> "HeadNotIdent: an application head must be an identifier (at " <> show o <> ")"
  EmptyOutput o -> "EmptyOutput: {{{}}} with no expression (at " <> show o <> ")"
  BadEscape o -> "BadEscape: invalid string escape (at " <> show o <> ")"
  LexError msg o -> "LexError: " <> msg <> " (at " <> show o <> ")"

-- | The source code-unit offset a parse error points at.
parseErrorOffset :: ParseError -> Int
parseErrorOffset = case _ of
  UnterminatedTag o -> o
  UnterminatedComment o -> o
  UnterminatedRaw o -> o
  MismatchedBlock _ _ o -> o
  HeadNotIdent o -> o
  EmptyOutput o -> o
  BadEscape o -> o
  LexError _ o -> o

-- | A parse error located in its source: 1-based `line`/`column` (via
-- | `Span.lineColumn`), the raw `offset`, and the rendered `message`. Enough for
-- | a host to point an editor diagnostic at the offending tag.
type ParseDiagnostic = { line :: Int, column :: Int, offset :: Int, message :: String }

-- | Locate a parse error in `src`.
parseErrorAt :: String -> ParseError -> ParseDiagnostic
parseErrorAt src pe =
  let
    offset = parseErrorOffset pe
    { line, column } = lineColumn src offset
  in
    { line, column, offset, message: renderParseError pe }

-- | Render a parse error prefixed with `line:column:`, given its source.
renderParseErrorAt :: String -> ParseError -> String
renderParseErrorAt src pe =
  let
    d = parseErrorAt src pe
  in
    show d.line <> ":" <> show d.column <> ": " <> d.message

-- | Evaluation errors. `UnknownHelper` is the only one the core raises during
-- | rendering; the rest are conventions helpers use to report their own
-- | contract violations. `ParseFailure` carries a structured `ParseError` so
-- | callers that run source end-to-end (`runString`) can still tell a malformed
-- | template apart from a render-time failure, rather than seeing a flat string.
data Error
  = UnknownHelper String
  | ArityError String
  | TypeError String
  | ClauseError String
  | HelperError String
  | ParseFailure ParseError

derive instance eqError :: Eq Error

instance showError :: Show Error where
  show = renderError

renderError :: Error -> String
renderError = case _ of
  UnknownHelper n -> "UnknownHelper: no helper named '" <> n <> "' in any frame"
  ArityError n -> "ArityError: " <> n
  TypeError m -> "TypeError: " <> m
  ClauseError m -> "ClauseError: " <> m
  HelperError m -> "HelperError: " <> m
  ParseFailure pe -> "ParseFailure: " <> renderParseError pe
