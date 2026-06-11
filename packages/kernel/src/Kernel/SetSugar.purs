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
-- | `liftSet` also lowers **`{% capture NAME %}body{% endcapture %}`** (docs-18) the
-- | same way: it emits an inline partial holding the body and a forward `{% local
-- | NAME = (partial <that>) %}` over the tail. `(partial …)` in value position yields
-- | the rendered output as a `VSafe` (pre-escaped) value, so capture's render-once,
-- | safe-string, forward-scope semantics reuse existing ops with no new construct.
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
import Data.Maybe (Maybe(..), fromMaybe)
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
    -- `{% capture NAME %}body{% endcapture %}` (docs-18): the body, rendered once
    -- into a pre-escaped *safe* string, bound forward like `set`. Desugars — with
    -- NO new engine op — to an inline partial holding the body plus a forward
    -- `local NAME = (partial <that>)` over the sibling tail. `(partial …)` in value
    -- position yields the rendered output as a `VSafe` (already-escaped) value, so
    -- `{{NAME}}` emits it verbatim, never double-escaping (docs-18 §2).
    Block sp Section "capture" args body
      | Just name <- captureName args ->
          let
            -- unique per source position, so re-captures never collide.
            capName = "@cap$" <> show sp.start
          in
            [ Block sp Section "inline" [ Lit (VString capName) ] (liftSet body)
            , Block sp Section "local"
                [ App (name <> "=") [], App "partial" [ Lit (VString capName) ] ]
                (liftSet tail)
            ]
    -- `{% apply PIPELINE %}body{% endapply %}` (ADR-25): render the body, pipe it
    -- through PIPELINE (the body is its leading subject), output the result. The
    -- parser left the pipeline in `args[0]` with an `__applybody__` placeholder subject; we
    -- emit an inline holding the body and an `Output` of the pipeline with `__applybody__`
    -- substituted by `(partial <that>)` (the rendered, `VSafe` body). Unlike capture
    -- it does NOT wrap the tail — apply outputs and binds nothing.
    Block sp Section "apply" args body ->
      let
        appName = "@app$" <> show sp.start
        subj = App "partial" [ Lit (VString appName) ]
      in
        [ Block sp Section "inline" [ Lit (VString appName) ] (liftSet body)
        , Output sp (substApplyBody subj (fromMaybe subj (Array.head args)))
        ] <> liftSet tail
    -- recurse into a block body (a `set` there scopes to that block), keep walking.
    Block sp sig name args body ->
      Array.cons (Block sp sig name args (liftSet body)) (liftSet tail)
    other ->
      Array.cons other (liftSet tail)

-- | The bound name of a `{% capture NAME %}` block (a bare identifier `App n []`
-- | or a quoted `Lit (VString n)`).
captureName :: Array Expr -> Maybe String
captureName args = case Array.head args of
  Just (App n []) -> Just n
  Just (Lit (VString n)) -> Just n
  _ -> Nothing

-- | Substitute the `__applybody__` placeholder (the `{% apply %}` pipeline's subject, which
-- | the parser injected) with `repl` — the rendered-partial call. Walks the whole
-- | expression so the subject is replaced wherever the pipe chain placed it.
substApplyBody :: Expr -> Expr -> Expr
substApplyBody repl = case _ of
  App "__applybody__" [] -> repl
  App n as -> App n (map (substApplyBody repl) as)
  other -> other

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
    -- a `{% capture NAME %}` binds NAME forward (docs-18), so the same reservation
    -- applies; its name is a bare identifier, not a `k=v`/`bind` form.
    Block sp Section "capture" args body -> case captureReserved args of
      Just k -> Just { off: sp.start, shape: shapeFor k }
      Nothing -> reservedBindingViolation blockHeads body
    Block _ _ _ _ body -> reservedBindingViolation blockHeads body
    _ -> Nothing
  captureReserved args = case captureName args of
    Just k | Array.elem k reserved -> Just k
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
