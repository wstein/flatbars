-- | **`{% set %}` forward binding** — the block-LESS sibling of `{% local %}`
-- | (docs-17). `{% set NAME = EXPR %}` binds `NAME` from its own position to the
-- | close of the *enclosing block* (forward, current scope — Jinja-equivalent, not
-- | Liquid's document-wide leak). There is no `{% endset %}`: the binding's scope is
-- | the remainder of its sibling list.
-- |
-- | `liftSet` is the whole implementation: a `Sep "set" args` (how the lexer tags the
-- | standalone tag) consumes the REST of its sibling list as its body, becoming a
-- | `{% local args %}…tail…{% endlocal %}`. So `set` reuses the bounded binding's one
-- | node and the `letH` emit across every backend — it adds NO new engine/compiler
-- | construct, only this skeleton rewrite. Re-binding the same name shadows (a nested
-- | `local`); the binding cannot leak past the enclosing block's close (the tail it
-- | wraps ends there) — exactly the docs-17 scope.
-- |
-- | Run by the `statementTags` dialects (RawBars/MaxBars) on the skeleton before
-- | desugar/render; ClassicBars never runs it (its bare `{{set}}` output is left
-- | alone). Depth-first, so a `set` inside any block body wraps only that body's tail.
module Kernel.SetSugar
  ( liftSet
  ) where

import Data.Array as Array
import Data.Maybe (Maybe(..))
import FlatBars.Syntax (Node(..), Sigil(..), Template)

liftSet :: Template -> Template
liftSet nodes = case Array.uncons nodes of
  Nothing -> []
  Just { head, tail } -> case head of
    -- `{% set NAME = EXPR %}` → `{% local NAME = EXPR %}` wrapping the sibling tail.
    Sep sp "set" args ->
      [ Block sp Section "local" args (liftSet tail) ]
    -- recurse into a block body (a `set` there scopes to that block), keep walking.
    Block sp sig name args body ->
      Array.cons (Block sp sig name args (liftSet body)) (liftSet tail)
    other ->
      Array.cons other (liftSet tail)
