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
  , reservedBindingViolation
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), contains)
import Data.String.CodeUnits (takeWhile)
import FlatBars.Syntax (Expr(..), Node(..), Sigil(..), Template)
import FlatBars.Value (Value(..))

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

-- | The first `{% set %}` / `{% local %}` binding whose NAME shadows a reserved
-- | name — its offset and a located-error "shape" (docs-17 §2; `Nothing` when clean).
-- | A binding name may not be a scope root (`this`/`root`/`parent`/`outer`/`loop`/
-- | `yield`) nor a built-in block head (`blockHeads` — `if`/`each`/`with`/`local`/
-- | `case`/`inline`/`partial`/…): shadowing one silently breaks path resolution, so
-- | it is a clear error instead (mirroring the `case`/`each … as` reservations). Run
-- | on the raw skeleton (both `Sep "set"` and `Block "local"`, before `liftSet`) by
-- | the statementTags dialects. Handles both binding spellings: the MaxBars hash
-- | `App "k=v"` and the RawBars `(bind "k" v)` call.
reservedBindingViolation :: Array String -> Template -> Maybe { off :: Int, shape :: String }
reservedBindingViolation blockHeads nodes = Array.head (Array.mapMaybe node nodes)
  where
  reserved = scopeRoots <> blockHeads
  scopeRoots = [ "this", "root", "parent", "outer", "loop", "yield" ]
  node = case _ of
    Sep sp "set" args
      | Just k <- firstReserved args -> Just { off: sp.start, shape: shapeFor k }
    Block sp Section "local" args body -> case firstReserved args of
      Just k -> Just { off: sp.start, shape: shapeFor k }
      Nothing -> reservedBindingViolation blockHeads body
    Block _ _ _ _ body -> reservedBindingViolation blockHeads body
    _ -> Nothing
  firstReserved args =
    Array.find (\k -> Array.elem k reserved) (Array.mapMaybe bindingKey args)
  -- the bound name, from either the MaxBars hash (`App "k=v"` / folded `App "k="`)
  -- or the RawBars `(bind "k" v)` call.
  bindingKey = case _ of
    App name [] | contains (Pattern "=") name -> Just (takeWhile (_ /= '=') name)
    App "bind" args -> case Array.head args of
      Just (Lit (VString k)) -> Just k
      _ -> Nothing
    _ -> Nothing
  shapeFor k =
    "{% set/local " <> k <> " = … %} (`" <> k
      <> "` is a reserved name — a binding may not shadow a scope root "
      <> "(this/root/parent/outer/loop/yield) or a block head)"
