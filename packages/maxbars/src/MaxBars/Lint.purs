-- | MaxBars schema-less *warn-always* lints (ADR-021). Two warnings remain after
-- | the bare loop-variable vocabulary was retired (ADR-006 §1–2 superseded): there
-- | are no bare loop variables left to shadow, so the old `loopVarShadowWarnings`
-- | is gone. What remains:
-- |
-- |  * `strayHeadBarWarnings` — an unparenthesised top-level pipe in a block head
-- |    (ADR-019), parsed as a block-parameter delimiter rather than the pipe.
-- |  * `labelShadowWarnings` — a loop `label NAME` whose name is one of the reserved
-- |    roots (`this`/`loop`/`root`/`parent`), which would shadow it for the body.
module MaxBars.Lint
  ( reservedNames
  , strayHeadBarWarnings
  , labelShadowWarnings
  , booleanInOutputWarnings
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..), maybe)
import FlatBars.Syntax (Expr(..), Template)
import FlatBars.Value (Value(..))
import FullBars.Surface (extractBlockParams)
import Kernel.Walk (Issue, Severity(..), foldTemplate)

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
  , nodeError: \_ _ -> []
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

-- | Warn when an *output* expression is a bare boolean logical operator —
-- | `{{ a || b }}` / `{{ a && b }}` (desugar targets `or` / `and`). In output
-- | position these yield the literal text `true`/`false`, which is almost always a
-- | mistake: a JS author reaches for `||` expecting a value fallback (`Hi Ada`),
-- | but `||` is boolean here. The fix is a value-coalesce — `??` (first non-null)
-- | or `?:` (first truthy). Runs over the *desugared* tree, where the operators are
-- | `or`/`and` applications; only the whole-output head is flagged, so a boolean in
-- | a condition (`{{#if (a || b)}}`, a block-head arg) or nested as an argument
-- | (`{{ pick (a || b) }}`) is left alone — those are legitimate boolean uses.
booleanInOutputWarnings :: Template -> Array Issue
booleanInOutputWarnings = foldTemplate
  { content: const []
  , output: \e -> maybe [] pure (boolWarn e)
  , raw: \name _ _ -> maybe [] pure (issueFor name)
  , sep: \_ _ -> []
  , block: \b -> b.recurse b.children
  , nodeError: \_ _ -> []
  , concat: Array.concat
  }
  where
  -- escaped output `{{ … }}` desugars to `escapeHtml (…)`; unwrap that one layer
  -- so we inspect the real expression head.
  boolWarn e = case unescape e of
    App name _ -> issueFor name
    _ -> Nothing
  unescape = case _ of
    App "escapeHtml" [ inner ] -> inner
    other -> other
  issueFor name = case name of
    "or" -> Just (issue "||" "or")
    "and" -> Just (issue "&&" "and")
    _ -> Nothing
  issue op nm =
    { severity: Warn
    , name: nm
    , message:
        "this tag outputs a boolean — the " <> op <> " (" <> nm
          <> ") operator yields true/false, not a value. For a fallback value use "
          <> "?? (first non-null) or ?: (first truthy); use "
          <> op
          <> " only in a condition, e.g. {{#if a "
          <> op
          <> " b}}"
    }

-- | The reserved variable roots (ADR-021): a loop `label NAME` that picks one of
-- | these shadows the reserved name for the whole body, so a bare `{{loop.…}}` /
-- | `{{parent.…}}` / `{{root.…}}` / `{{this}}` / `{{yield}}` would resolve the
-- | label instead.
reservedNames :: Array String
reservedNames = [ "this", "loop", "root", "parent", "yield" ]

-- | Warn on a loop `label NAME` whose name collides with a reserved root
-- | (ADR-021). Runs over the *desugared* template, where a label survives as the
-- | reserved `@label` marker the surface emits.
labelShadowWarnings :: Template -> Array Issue
labelShadowWarnings = foldTemplate
  { content: const []
  , output: const []
  , raw: \_ _ _ -> []
  , sep: \_ _ -> []
  , block: \b -> Array.mapMaybe labelOf b.args <> b.recurse b.children
  , nodeError: \_ _ -> []
  , concat: Array.concat
  }
  where
  labelOf = case _ of
    App "@label" [ Lit (VString nm) ] | Array.elem nm reservedNames ->
      Just
        { severity: Warn
        , name: nm
        , message:
            "loop label '" <> nm <> "' shadows the reserved name '" <> nm
              <> "'; choose a different label name so {{"
              <> nm
              <> "}} keeps its meaning"
        }
    _ -> Nothing
