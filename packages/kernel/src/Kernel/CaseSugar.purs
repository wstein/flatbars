-- | **`{{#case}}` desugaring** — the multi-arm conditional, shared by the
-- | `nonEmpty`-truthiness family (RawBars + MaxBars; Trussbars is the Rust twin).
-- | It is *not* a new engine or compiler path: a `{{#case SUBJECT}}{{when V …}}…
-- | {{else}}…{{/case}}` block is rewritten, structurally, into the existing
-- | `{{#if (eq SUBJECT V)}}…{{elif …}}…{{else}}…{{/if}}` skeleton (the subject
-- | `eq`-compared to each arm's value(s), OR-chained for a multi-value arm), so the
-- | interpreter (`Kernel.Lower`), the JS compiler, and the Rust emitter all handle
-- | the result unchanged (docs/12).
-- |
-- | Living in `kernel` lets RawBars (whose dependency closure is FullBars-free) reuse
-- | the same rewrite the MaxBars surface runs. The rewrite does **no** path-rewriting:
-- | RawBars writes its subject/values in core syntax already, and MaxBars runs this as
-- | a pre-pass *before* its surface path-rewrite, so a bare `{{#case status}}` subject
-- | is rewritten to `(lookup this "status")` by the surface pass afterwards.
module Kernel.CaseSugar
  ( desugarCase
  , caseLeadingViolation
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.String (trim)
import FlatBars.Span (Span)
import FlatBars.Syntax (Expr(..), Node(..), Sigil(..), Template)

-- | A single `{{when V …}}` arm: the separator span, its value expressions, and the
-- | clause body up to the next `{{when}}`/`{{else}}`/`{{/case}}`.
type CaseClause = { sp :: Span, values :: Array Expr, body :: Template }

-- | Rewrite every `{{#case}}` block in a template into the `{{#if … }}` skeleton,
-- | recursing through ordinary block bodies and `case` clause bodies (so a nested
-- | `case` is rewritten too). A whitespace-only run before the first arm is dropped;
-- | non-whitespace leading content is a located error caught by `caseLeadingViolation`
-- | before this runs, so it is never seen here.
desugarCase :: Template -> Template
desugarCase = map node
  where
  node = case _ of
    Block sp Section "case" args body -> caseBlock sp args body
    Block sp sig name args body -> Block sp sig name args (desugarCase body)
    other -> other

  caseBlock sp args body =
    let
      subject = fromMaybe (App "null" []) (Array.head args)
      { clauses, elseBody } = splitCaseBody body
      elseSeg = maybe [] (\eb -> Array.cons (Sep sp "else" []) (desugarCase eb)) elseBody
    in
      case Array.uncons clauses of
        Just { head: c1, tail: rest } ->
          let
            elifClause c = Array.cons (Sep c.sp "elif" [ whenCond subject c.values ])
              (desugarCase c.body)
            innerBody = desugarCase c1.body <> Array.concatMap elifClause rest <> elseSeg
          in
            Block sp Section "if" [ whenCond subject c1.values ] innerBody
        -- no `{{when}}` arms: a lone `{{else}}` renders unconditionally; an empty case
        -- renders nothing.
        Nothing -> case elseBody of
          Just eb -> Block sp Section "if" [ App "true" [] ] (desugarCase eb)
          Nothing -> Content sp ""

-- | The condition for a `{{when}}` arm: the subject `eq`-compared to the arm's value,
-- | or — for a multi-value arm `{{when a b}}` — the disjunction `(or (eq s a) (eq s b))`.
-- | An empty arm (`{{when}}`) yields `(or)`, which never matches.
whenCond :: Expr -> Array Expr -> Expr
whenCond subject = case _ of
  [ v ] -> App "eq" [ subject, v ]
  values -> App "or" (map (\v -> App "eq" [ subject, v ]) values)

-- | Split a `{{#case}}` body into its `{{when}}` arms and an optional trailing
-- | `{{else}}` body, dropping any (whitespace-only) content before the first arm.
-- | `{{when}}`/`{{else}}` are the name-agnostic separators the core already produces
-- | (`Sep`); anything else is ordinary clause content.
splitCaseBody :: Template -> { clauses :: Array CaseClause, elseBody :: Maybe Template }
splitCaseBody body =
  let
    flushed = flushCur (Array.foldl step { cur: Nothing, clauses: [], inElse: Nothing } body)
  in
    { clauses: flushed.clauses, elseBody: flushed.inElse }
  where
  flushCur st = case st.cur of
    Just c -> st { clauses = Array.snoc st.clauses c, cur = Nothing }
    Nothing -> st
  step st = case _ of
    Sep s "when" vals -> (flushCur st) { cur = Just { sp: s, values: vals, body: [] } }
    Sep _ "else" _ -> (flushCur st) { inElse = Just (fromMaybe [] st.inElse) }
    other -> case st.inElse of
      Just eb -> st { inElse = Just (Array.snoc eb other) }
      Nothing -> case st.cur of
        Just c -> st { cur = Just (c { body = Array.snoc c.body other }) }
        Nothing -> st

-- | The first `{{#case}}` whose body carries non-whitespace content before its first
-- | `{{when}}`/`{{else}}` arm — its offset and a "shape" string for the located
-- | `DisallowedShape` error (docs/12 §2: only whitespace may precede the first arm; no
-- | Liquid-style silent fall-through). Searched depth-first, so a nested `case` is caught.
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
