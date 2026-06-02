-- | The MinBars *context-stack* environment and its name resolver.
-- |
-- | Mustache resolves names by walking a **stack of context frames** (parent
-- | fallback), not a single `this` — a divergence from the Handlebars-family
-- | engines, quarantined to MinBars. `MinEnv` is a `newtype` (not a record
-- | synonym) for the same reason `Kernel.Env.RefEnv` is: the reference
-- | `env -> Operation -> Ctl -> env` is cyclic and a synonym would not be
-- | well-founded.
module MinBars.Context
  ( MinEnv(..)
  , minStack
  , minPartials
  , minFalsy
  , minDepth
  , minBlocks
  , push
  , enterPartial
  , layerBlocks
  , blookup
  , seedEnv
  , mresolve
  ) where

import Prelude

import Data.Array as Array
import Data.List (List(..), (:))
import Data.List as List
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String (Pattern(..), split)
import FlatBars.Syntax (Template)
import FlatBars.Value (Value(..))
import Kernel.Value (FalsySet)

-- | The MinBars environment: a Mustache *context stack* plus the partial
-- | registry, the active truthiness mode, and the partial-recursion depth.
-- | A `newtype` so `MinEnv -> Operation m MinEnv -> Ctl m MinEnv -> MinEnv`
-- | is well-founded (see `Kernel.Env.RefEnv`).
newtype MinEnv = MinEnv
  { stack :: List Value -- the context stack, top = head
  , partials :: Map String Template -- named partial templates
  , falsy :: FalsySet -- active truthiness mode (`mustache` by default)
  , depth :: Int -- partial-recursion depth, guarded against the budget
  , blocks :: List (Map String Template)
  -- the inheritance block-override stack — a namespace *distinct* from the
  -- data context. `parent` conses one layer per parent it expands; `block`
  -- consults it (never the data stack). Layered down a parent chain, with the
  -- more-derived (outer) override winning on conflict (see `blookup`).
  }

minStack :: MinEnv -> List Value
minStack (MinEnv e) = e.stack

minPartials :: MinEnv -> Map String Template
minPartials (MinEnv e) = e.partials

minFalsy :: MinEnv -> FalsySet
minFalsy (MinEnv e) = e.falsy

minDepth :: MinEnv -> Int
minDepth (MinEnv e) = e.depth

minBlocks :: MinEnv -> List (Map String Template)
minBlocks (MinEnv e) = e.blocks

-- | Push a value onto the context stack (sections/`with` render their children
-- | under a push; the frame's lifetime is the `render` call, so there is no pop).
push :: Value -> MinEnv -> MinEnv
push v (MinEnv e) = MinEnv (e { stack = v : e.stack })

-- | Enter one partial deeper — bump the recursion-depth counter.
enterPartial :: MinEnv -> MinEnv
enterPartial (MinEnv e) = MinEnv (e { depth = e.depth + 1 })

-- | Layer one block-override map onto the block stack: `parent` conses its
-- | harvested `{{$…}}` blocks before expanding the named template. Each parent
-- | down a chain conses one layer, so the stack head is the *innermost*
-- | (least-derived) parent's overrides and the tail end holds the *outermost*
-- | (most-derived) override — matching `blookup`'s outer-wins rule.
layerBlocks :: Map String Template -> MinEnv -> MinEnv
layerBlocks m (MinEnv e) = MinEnv (e { blocks = m : e.blocks })

-- | Resolve a `{{$name}}` override from the layered block stack, applying the
-- | **outer-wins** rule: overrides accumulate down a parent chain and the
-- | more-derived (outer) one wins on conflict. Layers are consed innermost-first
-- | (see `layerBlocks`), so we fold keeping the *deepest* (tail-most) match —
-- | i.e. the override contributed by the outermost parent. `Nothing` ⇒ no
-- | override anywhere (the block falls back to its default body).
blookup :: String -> List (Map String Template) -> Maybe Template
blookup name = List.foldl pick Nothing
  where
  pick acc layer = case Map.lookup name layer of
    Just tmpl -> Just tmpl
    Nothing -> acc

-- | The starting environment: the root datum as the sole stack frame, the given
-- | partials and truthiness mode, depth 0.
seedEnv :: Value -> Map String Template -> FalsySet -> MinEnv
seedEnv dat partials falsy = MinEnv
  { stack: dat : Nil
  , partials
  , falsy
  , depth: 0
  , blocks: Nil
  }

-- | Resolve a Mustache name against the context stack (spec §4.2):
-- |
-- | 1. `.` (the implicit iterator) is the **top** of the stack.
-- | 2. Otherwise split on `.`; the head is the lookup key, the tail is retained.
-- | 3. Walk the stack top→bottom for the first frame that is a `VObject`
-- |    containing the head key — the *parent fallback*.
-- | 4. No frame matches ⇒ `VNull`.
-- | 5. Resolve each retained tail segment against **only** that result (a single
-- |    frame, no further stack walk); any failed segment ⇒ `VNull`.
mresolve :: String -> MinEnv -> Value
mresolve name (MinEnv e)
  | name == "." = fromMaybe VNull (List.head e.stack)
  | otherwise = case Array.uncons (split (Pattern ".") name) of
      Nothing -> VNull
      Just { head, tail } ->
        let
          base = walk head e.stack
        in
          Array.foldl descend base tail

-- | Walk the stack top→bottom for the first object frame holding `key`.
walk :: String -> List Value -> Value
walk key = case _ of
  Nil -> VNull
  v : rest -> case v of
    VObject m -> case Map.lookup key m of
      Just found -> found
      Nothing -> walk key rest
    _ -> walk key rest

-- | Resolve one dotted-tail segment against a single value (no stack walk).
descend :: Value -> String -> Value
descend acc seg = case acc of
  VObject m -> fromMaybe VNull (Map.lookup seg m)
  _ -> VNull
