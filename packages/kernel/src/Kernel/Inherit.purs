-- | **ADR-040 template inheritance** — the static `{% extends %}` / `{% block %}` /
-- | `{% super %}` flatten.
-- |
-- | A lower-phase pre-pass (the `desugar` IoC instance) that resolves named-block
-- | inheritance *entirely at compile time* into a plain template the interpret /
-- | compile / validate drivers consume unchanged: **no new runtime, no new engine
-- | primitive**. It runs on the RAW skeleton (before `desugarSurface`), so a `{% block
-- | name %}` head is still the bare `App name []` the parser produced.
-- |
-- | `{% extends "base" %}` bases are resolved from the template's own
-- | `{% inline "name" %}…{% endinline %}` definitions (the same registry `hoistInline`
-- | reads). The flatten walks the `extends` chain leaf→root, merging each level's block
-- | overrides (leaf wins), then fills the root template's `{% block %}` slots: an
-- | overridden slot renders the override (with `{% super %}` splicing the parent body);
-- | an un-overridden slot renders its default. The result has no inheritance markers.
-- |
-- | A template with no `{% extends %}` and no `{% block %}` is returned structurally
-- | unchanged, so this is a no-op for every non-inheriting template. See ADR-040.
module Kernel.Inherit
  ( resolveInheritance
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..), note)
import Data.Foldable (traverse_)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.String (trim)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (ParseError(..))
import FlatBars.Syntax (Expr(..), Ident, Node(..), Sigil(..), Template)
import FlatBars.Value (Value(..))

-- | Resolve `{% extends %}` / `{% block %}` / `{% super %}` into a plain template.
resolveInheritance :: Template -> Either ParseError Template
resolveInheritance nodes =
  let
    bases = collectBases nodes
  in
    case findExtends nodes of
      -- A base or plain template: fill its own `{% block %}` slots with their default
      -- bodies (no descendant overrides). A template with neither marker is unchanged.
      Nothing -> fillBlocks Map.empty nodes
      -- A child: thread its block overrides up the chain onto the root, then keep the
      -- child's own inline definitions (so any `{% partial %}` / `{% include %}` of a
      -- base still resolves after `hoistInline`).
      Just _ -> do
        flat <- flattenWith bases Map.empty nodes
        pure (Array.filter isInlineDef nodes <> flat)

-- | Every `{% inline "name" %}body{% endinline %}` at any depth → `name ↦ body` (raw),
-- | the base registry the `extends` chain resolves against.
collectBases :: Template -> Map Ident Template
collectBases = Array.foldl step Map.empty
  where
  step acc = case _ of
    Block _ Section "inline" args body
      | Just n <- litName args ->
          Map.insert n body (Map.union acc (collectBases body))
    Block _ _ _ _ body -> Map.union acc (collectBases body)
    _ -> acc

-- | The leading `{% extends "base" %}` directive (the base name + its offset), or
-- | `Nothing`. Any non-`{% block %}` content around it is rejected later by
-- | `collectOverrides`, which enforces the "a child is blocks-only" rule.
findExtends :: Template -> Maybe { name :: Ident, off :: Int }
findExtends = Array.findMap case _ of
  Sep sp "extends" args | Just n <- litName args -> Just { name: n, off: sp.start }
  _ -> Nothing

-- | Walk the `extends` chain leaf→root, accumulating block overrides (a descendant wins
-- | over an ancestor on the same name), then fill the root template's slots.
flattenWith :: Map Ident Template -> Map Ident Template -> Template -> Either ParseError Template
flattenWith bases descendant nodes =
  case findExtends nodes of
    Nothing -> fillBlocks descendant nodes
    Just { name, off } -> do
      mine <- collectOverrides nodes
      base <- note (unknownBaseError name off) (Map.lookup name bases)
      -- `descendant` (closer to the leaf) wins on a name collision.
      flattenWith bases (Map.union descendant mine) base

-- | A child template's top-level `{% block name %}body{% endblock %}` overrides. Every
-- | other top-level node must be a block definition, an inline definition, the `extends`
-- | directive, or whitespace — anything else is a located `DisallowedShape` (the
-- | no-silent-no-op bar: stray child content is rejected, not dropped like Django does).
collectOverrides :: Template -> Either ParseError (Map Ident Template)
collectOverrides nodes = do
  traverse_ validate nodes
  pure (Map.fromFoldable (Array.mapMaybe asBlock nodes))
  where
  validate = case _ of
    Block _ Section "block" args _ | Just _ <- appName args -> Right unit
    Block _ Section "inline" _ _ -> Right unit
    Sep _ "extends" _ -> Right unit
    Content _ s | trim s == "" -> Right unit
    other -> Left (DisallowedShape strayChildShape (nodeStart other))
  asBlock = case _ of
    Block _ Section "block" args body | Just n <- appName args -> Just (Tuple n body)
    _ -> Nothing

-- | Fill the slots of a root template: expand each `{% block name %}default{% endblock %}`
-- | to the override body (with `{% super %}` → default) when `overrides` names it, else to
-- | its default. Recurses through nested block bodies and ordinary block bodies; inline
-- | definitions pass through untouched for `hoistInline`.
fillBlocks :: Map Ident Template -> Template -> Either ParseError Template
fillBlocks overrides nodes = Array.concat <$> traverse fillNode nodes
  where
  fillNode = case _ of
    Block _ Section "block" args body
      | Just n <- appName args -> do
          def <- fillBlocks overrides body
          case Map.lookup n overrides of
            Nothing -> Right def
            Just ov -> fillBlocks overrides (substSuper def ov)
    Block sp Section "inline" args body -> Right [ Block sp Section "inline" args body ]
    Block sp sig hd args inner -> do
      inner' <- fillBlocks overrides inner
      Right [ Block sp sig hd args inner' ]
    other -> Right [ other ]

-- | Splice the parent body `def` in for every `{% super %}` in an override body. Recurses
-- | through ordinary block bodies (an `{% if %}`/`{% for %}` may wrap a `{% super %}`) but
-- | not into a nested `{% block %}` (whose `{% super %}` belongs to *its* parent).
substSuper :: Template -> Template -> Template
substSuper def = Array.concatMap case _ of
  Sep _ "super" _ -> def
  Block sp Section "block" args body -> [ Block sp Section "block" args body ]
  Block sp sig hd args body -> [ Block sp sig hd args (substSuper def body) ]
  other -> [ other ]

-- | Is a node a top-level `{% inline "name" %}` definition (kept for `hoistInline`)?
isInlineDef :: Node -> Boolean
isInlineDef = case _ of
  Block _ Section "inline" args _ -> case litName args of
    Just _ -> true
    Nothing -> false
  _ -> false

-- | The string-literal name argument of `{% extends "x" %}` / `{% inline "x" %}`.
litName :: Array Expr -> Maybe Ident
litName args = case Array.head args of
  Just (Lit (VString n)) -> Just n
  _ -> Nothing

-- | The bare-identifier name argument of `{% block name %}` (a `App name []` head).
appName :: Array Expr -> Maybe Ident
appName args = case Array.head args of
  Just (App n []) -> Just n
  _ -> Nothing

unknownBaseError :: Ident -> Int -> ParseError
unknownBaseError name off = DisallowedShape
  ( "{% extends \"" <> name
      <> "\" %} (no base template named \""
      <> name
      <> "\" — define it with {% inline \""
      <> name
      <> "\" %} … {% endinline %} or register it as a partial)"
  )
  off

strayChildShape :: String
strayChildShape =
  "a template with {% extends %} may contain only {% block %} definitions at top level (move stray content into a {% block … %} … {% endblock %})"

nodeStart :: Node -> Int
nodeStart = case _ of
  Content sp _ -> sp.start
  Output sp _ -> sp.start
  Block sp _ _ _ _ -> sp.start
  RawBlock sp _ _ _ -> sp.start
  Sep sp _ _ -> sp.start
  NodeError sp _ -> sp.start
