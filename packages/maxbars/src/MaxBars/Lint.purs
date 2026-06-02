-- | MaxBars loop-variable **shadow lint** (ADR-006 §shadowing, the schema-less
-- | *warning* tier agreed in the final review).
-- |
-- | Dropping the `@` sigil lets a bare loop variable whose name reads like a
-- | data field — `first`, `last`, `length`, `key` — silently win over a field of
-- | the same name. ADR-006's schema-present tier makes that an *error* when a
-- | declared field collides; this tier needs no schema: it **always warns** on a
-- | use of such a name as a (bare) loop variable, so a schema-less template can't
-- | shadow a field unnoticed. The fix the message points to — `{{ this.NAME }}` —
-- | desugars to a `lookup` (not a scoped-var call) and so does *not* warn.
-- |
-- | The lint runs over the *desugared* template: a bare `{{first}}` lowered by
-- | MaxBars' loop-variable resolver is a nullary application `(first)`, whereas a
-- | data path `{{this.first}}` is `(lookup this "first")`. So a zero-arity
-- | application whose head is a shadow-prone loop-variable name is exactly a bare
-- | loop-variable use. (The unambiguous spellings `index0`/`index1`/`rindex0`/
-- | `rindex1` never read as data fields, so they are not flagged.)
module MaxBars.Lint
  ( shadowProneNames
  , loopVarNames
  , loopVarShadowWarnings
  , strayHeadBarWarnings
  , labelShadowWarnings
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import FlatBars.Syntax (Expr(..), Template)
import FlatBars.Value (Value(..))
import FullBars.Surface (extractBlockParams)
import Kernel.Walk (Issue, RefKind(..), Severity(..), foldTemplate, operationRefs)

-- | The loop-variable names that plausibly collide with data fields (ADR-006
-- | calls out `first`/`key`/`length`; `last` rounds out the set). The aliases
-- | (`index`/`rindex`/`size`) have already been resolved to canonical names by
-- | the desugar, and the canonical `index0`/`index1`/`rindex0`/`rindex1` are not
-- | data-like, so neither appears here.
shadowProneNames :: Array String
shadowProneNames = [ "first", "last", "length", "key" ]

-- | Warn on every bare loop-variable use whose name is shadow-prone, over a
-- | *desugared* MaxBars template. One `Warn` issue per occurrence.
loopVarShadowWarnings :: Template -> Array Issue
loopVarShadowWarnings = Array.mapMaybe warnOf <<< operationRefs
  where
  warnOf ref
    | ref.kind == AppRef && ref.argc == 0 && Array.elem ref.name shadowProneNames =
        Just
          { severity: Warn
          , name: ref.name
          , message:
              "bare {{" <> ref.name <> "}} is the loop variable here, not a data field; "
                <> "write {{ this."
                <> ref.name
                <> " }} to read a field named '"
                <> ref.name
                <> "'"
          }
    | otherwise = Nothing

-- | Warn on a *stray* bar in a block head, over a *parsed* (pre-desugar) MaxBars
-- | template. The MaxBars head grammar omits the top-level pipe rung so a bar can
-- | delimit an `as |…|` block-parameter clause; an unparenthesised top-level bar
-- | in a head is therefore parsed as structure (a nullary `(|)` application,
-- | matching FullBars and the core parser), not the pipe operator. The legitimate
-- | `as |…|` bars are stripped by `extractBlockParams` — the single source of
-- | `as`-truth, reused here so the lint never re-encodes the keyword — leaving any
-- | bar that survives in `mainArgs` as one the author most likely meant as a pipe
-- | (`{{#each xs | f}}` instead of `{{#each (xs | f)}}`). One `Warn` per stray bar.
-- |
-- | Run this on the *parsed* nodes, not the desugared ones: the surface desugar
-- | rewrites a bare `(|)` into a `lookup` of a field named "|", erasing the signal.
strayHeadBarWarnings :: Template -> Array Issue
strayHeadBarWarnings = foldTemplate
  { content: const []
  , output: const []
  , raw: \_ _ _ -> []
  , sep: \_ _ -> []
  , block: \b -> headBars b.args <> b.recurse b.children
  , concat: Array.concat
  }
  where
  -- a bar left in the head args after the `as |…|` clause is stripped
  headBars args = map (const warn) (Array.filter isBar (extractBlockParams args).mainArgs)
  isBar = case _ of
    App "|" [] -> true
    _ -> false
  warn =
    { severity: Warn
    , name: "|"
    , message:
        "a bar in a block head is the block-parameter delimiter, not the pipe "
          <> "operator; to pipe a block argument, parenthesise it — e.g. (x | f)"
    }

-- | The full bare loop-variable vocabulary (MaxBars), against which a loop
-- | `label NAME` is checked: choosing one of these as a label name silently
-- | re-binds the loop variable to the label object (`labelBind` is added last to
-- | the frame), so a bare `{{index0}}` would no longer read the index. Superset of
-- | `shadowProneNames`, which is only the field-like subset.
loopVarNames :: Array String
loopVarNames =
  [ "index0"
  , "index1"
  , "rindex0"
  , "rindex1"
  , "first"
  , "last"
  , "length"
  , "key"
  , "index"
  , "rindex"
  , "size"
  , "this"
  ]

-- | Warn on a loop `label NAME` whose name collides with a bare loop variable
-- | (ADR-013 §4 / ADR-006 §4): the label would shadow that variable for the whole
-- | body, re-opening the shadowing footgun. Runs over the *desugared* template,
-- | where a label survives as the reserved `@label` marker the surface emits.
labelShadowWarnings :: Template -> Array Issue
labelShadowWarnings = foldTemplate
  { content: const []
  , output: const []
  , raw: \_ _ _ -> []
  , sep: \_ _ -> []
  , block: \b -> Array.mapMaybe labelOf b.args <> b.recurse b.children
  , concat: Array.concat
  }
  where
  labelOf = case _ of
    App "@label" [ Lit (VString nm) ] | Array.elem nm loopVarNames ->
      Just
        { severity: Warn
        , name: nm
        , message:
            "loop label '" <> nm <> "' shadows the bare loop variable '" <> nm
              <> "'; choose a different label name so {{"
              <> nm
              <> "}} still reads the loop variable"
        }
    _ -> Nothing
