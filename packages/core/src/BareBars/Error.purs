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
  ) where

import Prelude

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

-- | Evaluation errors. `UnknownHelper` is the only one the core raises; the
-- | rest are conventions helpers use to report their own contract violations.
data Error
  = UnknownHelper String
  | ArityError String
  | TypeError String
  | HelperError String

derive instance eqError :: Eq Error

instance showError :: Show Error where
  show = renderError

renderError :: Error -> String
renderError = case _ of
  UnknownHelper n -> "UnknownHelper: no helper named '" <> n <> "' in any frame"
  ArityError n -> "ArityError: " <> n
  TypeError m -> "TypeError: " <> m
  HelperError m -> "HelperError: " <> m
