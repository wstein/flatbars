-- | The MinBars prelude — the five Mustache-core helpers and the MinBars
-- | `Engine`.
-- |
-- | The desugar (`MinBars.Surface`) rewrites every surface shape into core
-- | applications over exactly these names: `mlookup`, `escape`, `section`,
-- | `inverted`, `partial`. The engine's `resolve` is therefore **closed** — it
-- | maps those fixed names and throws `HelperError` for anything else.
-- |
-- | These are *not* the FullBars prelude: MinBars' `section` is polymorphic
-- | (list-coercion + push), name resolution walks the context stack with parent
-- | fallback, and a missing `partial` renders `""` rather than throwing.
module MinBars.Prelude
  ( minEngine
  , mlookupH
  , escapeH
  , sectionH
  , invertedH
  , partialH
  , parentH
  , blockH
  , indentTemplate
  , harvestBlocks
  , leadingIndent
  ) where

import Prelude

import Control.Monad.Error.Class (class MonadThrow, throwError)
import Data.Array as Array
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String (Pattern(..), split, stripPrefix)
import Data.String.CodeUnits as SCU
import Data.String.Common (joinWith)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Error (Error(..))
import FlatBars.Syntax (Expr(..), Node(..), Sigil(..), Template)
import FlatBars.Value (Value(..))
import Kernel.Engine (Engine, Operation)
import Kernel.Env (liftEither, recursionBudget)
import Kernel.Value (escapeHtml, stringify)
import MinBars.Context (MinEnv, blookup, enterPartial, layerBlocks, minBlocks, minDepth, minPartials, minTruthy, mresolve, push)

-- | The MinBars engine over any `MonadThrow Error m`. `resolve` is closed: the
-- | five fixed helper names map to their helpers; an unknown name (which the
-- | desugar never emits) throws `HelperError`. `stringify` reuses the kernel's
-- | `Value.stringify`.
minEngine :: forall m. MonadThrow Error m => MinEnv -> Engine m MinEnv
minEngine initial =
  { initial
  , resolve: \_ name -> case name of
      "mlookup" -> pure mlookupH
      "escape" -> pure escapeH
      "section" -> pure sectionH
      "inverted" -> pure invertedH
      "partial" -> pure partialH
      "parent" -> pure parentH
      "block" -> pure blockH
      other -> throwError (HelperError ("unknown MinBars helper '" <> other <> "'"))
  , stringify: \v -> liftEither (stringify v)
  -- Mustache has no hash / block-param / label surface, so the identity split (ADR-020 Phase 3).
  , blockArgs: \args -> { positional: args, hash: Nothing, params: [], label: Nothing }
  }

-- | `mlookup name` — resolve a (possibly dotted) name against the context stack
-- | (parent fallback), per `MinBars.Context.mresolve`. The name is baked in by
-- | the desugar as a single `VString` argument; the value comes from `ctl.env`.
mlookupH :: forall m. MonadThrow Error m => Operation m MinEnv
mlookupH ctl args = case args of
  [ VString name ] -> pure (mresolve name ctl.env)
  _ -> throwError (HelperError "mlookup: expected exactly one string name")

-- | `escape v` — stringify then HTML-escape, marking the result safe (`VSafe`).
-- | `VNull` stringifies to `""`. Re-escaping a `VSafe` is idempotent (the kernel
-- | `escapeHtml` is only applied to freshly-stringified text here).
escapeH :: forall m. MonadThrow Error m => Operation m MinEnv
escapeH _ args = case args of
  [ v ] -> (VSafe <<< escapeHtml) <$> stringifyOrEmpty v
  _ -> throwError (HelperError "escape: expected exactly one argument")

-- | Stringify a value to output text, treating an object as an error (as the
-- | kernel does); `VNull` ⇒ `""`.
stringifyOrEmpty :: forall m. MonadThrow Error m => Value -> m String
stringifyOrEmpty = liftEither <<< stringify

-- | `section v` — the polymorphic Mustache section. The body is `ctl.children`;
-- | the value is coerced to a list of frames to push:
-- |
-- |  * `VArray xs` — render the body once per element, each pushed;
-- |  * a truthy non-list (under the env's falsy set) — render once with `v`
-- |    pushed (a hash becomes the new top frame; a scalar pushes too, so `{{.}}`
-- |    yields it and named lookups fall through to a parent);
-- |  * a falsy value (`false`/`null`/`[]`) — render zero times.
sectionH :: forall m. MonadThrow Error m => Operation m MinEnv
sectionH ctl args = case args of
  [ v ] ->
    let
      items = case v of
        VArray xs -> xs
        _ -> if minTruthy ctl.env v then [ v ] else []
    in
      (VSafe <<< joinWith "")
        <$> traverse (\it -> ctl.render (push it ctl.env) ctl.children) items
  _ -> throwError (HelperError "section: expected exactly one argument")

-- | `inverted v` — render the body once (context unchanged) iff `v` is falsy
-- | under the env's mode (`false`/`null`/`[]`), else `""`.
invertedH :: forall m. MonadThrow Error m => Operation m MinEnv
invertedH ctl args = case args of
  [ v ] ->
    if not (minTruthy ctl.env v) then VSafe <$> ctl.render ctl.env ctl.children
    else pure (VSafe "")
  _ -> throwError (HelperError "inverted: expected exactly one argument")

-- | `partial name indent` — render the registered partial `name` under the
-- | **current** context stack (it inherits the caller's stack). The name arrives
-- | as a `VString` literal from the desugar, followed by the standalone `indent`
-- | (also a `VString`; `""` when the partial was not standalone). A missing /
-- | non-string / unregistered name renders `""` (Mustache behaviour — never an
-- | error). When `indent` is non-empty it is re-applied to **every line** of the
-- | partial's rendered output (§4.6). Partial entry is guarded against
-- | `recursionBudget`, raising `RecursionLimit`.
partialH :: forall m. MonadThrow Error m => Operation m MinEnv
partialH ctl args = case args of
  [ VString name, VString indent ] -> case Map.lookup name (minPartials ctl.env) of
    Just tmpl
      | minDepth ctl.env >= recursionBudget -> throwError (RecursionLimit recursionBudget)
      | otherwise -> VSafe <$> ctl.render (enterPartial ctl.env) (indentTemplate indent tmpl)
    Nothing -> pure (VSafe "")
  _ -> pure (VSafe "")

-- | `parent name` — the Mustache-inheritance parent (§4.6.2). The body
-- | (`ctl.children`) supplies block *overrides*: each immediate
-- | `Block Section "block" [Lit (VString b)] body` child contributes `b -> body`
-- | and **all other content is ignored** (the "text inside parent" rule). That
-- | map is layered onto `env.blocks` (`layerBlocks`), then the named parent
-- | template is rendered under the **current data stack** with the overlay. The
-- | name arrives as a `VString` (static `{{<p}}`) or resolved (`{{<*name}}`).
-- | Missing / non-string / unregistered name ⇒ `""`. Guarded against the
-- | recursion budget like `partial`.
parentH :: forall m. MonadThrow Error m => Operation m MinEnv
parentH ctl args = case args of
  [ VString name, VString indent ] -> case Map.lookup name (minPartials ctl.env) of
    Just tmpl
      | minDepth ctl.env >= recursionBudget -> throwError (RecursionLimit recursionBudget)
      | otherwise ->
          let
            overrides = harvestBlocks ctl.children
            env' = layerBlocks overrides (enterPartial ctl.env)
          in
            -- a standalone parent re-indents the expanded parent template's lines
            -- to its captured indent, exactly as a standalone partial does (§4.8).
            VSafe <$> ctl.render env' (indentTemplate indent tmpl)
    Nothing -> pure (VSafe "")
  _ -> pure (VSafe "")

-- | Collect the `{{$name}}` block overrides from a parent body: each immediate
-- | `Block Section "block" [Lit (VString b), …] body` child maps `b -> body`. Any
-- | other node (text, interpolation, sections) is ignored.
-- |
-- | Reindentation, part 1 — "removed at the site of definition" (§4.6.2): a
-- | *standalone* override (arity-2, an indent literal was injected) is **dedented**
-- | here, at its definition site, by its own common leading whitespace; nested
-- | blocks inside keep their separately-captured indents. The matching "added at
-- | the site of expansion" half is `blockH`.
harvestBlocks :: Template -> Map String Template
harvestBlocks = Map.fromFoldable <<< Array.mapMaybe blockChild
  where
  blockChild = case _ of
    Block _ Section "block" args body -> case Array.head args of
      Just (Lit (VString b)) ->
        let
          standalone = Array.length args >= 2
        in
          Just (Tuple b (if standalone then dedentTemplate body else body))
      _ -> Nothing
    _ -> Nothing

-- | Strip a standalone override's own common leading indentation from each line
-- | of its template (the definition-site dedent, §4.6.2). The amount removed is
-- | the leading horizontal whitespace of the body's first content line; it is
-- | dropped at the body's start and after every newline in a `Content` node.
-- | Interpolations/nested blocks are untouched (they keep their own indents).
dedentTemplate :: Template -> Template
dedentTemplate = \tmpl ->
  let
    amount = case Array.head tmpl of
      Just (Content s) -> leadingIndent s
      _ -> ""
  in
    if amount == "" then tmpl else go true amount tmpl
  where
  go atLineStart amount nodes = case Array.uncons nodes of
    Nothing -> []
    Just { head, tail } -> case head of
      Content s ->
        let
          { text, nextAtLineStart } = dropContent atLineStart amount s
        in
          Array.cons (Content text) (go nextAtLineStart amount tail)
      other -> Array.cons other (go false amount tail)

  -- drop `amount` from each line start of `s` (start if `atLineStart`, and after
  -- every internal newline); report whether `s` ends mid-line or at a new line.
  dropContent atLineStart amount s =
    let
      parts = split (Pattern "\n") s
      strip p = fromMaybe p (stripPrefix (Pattern amount) p)
      piece i p = if i == 0 && not atLineStart then p else strip p
      text = joinWith "\n" (Array.mapWithIndex piece parts)
      endsNL = SCU.takeRight 1 s == "\n"
    in
      { text, nextAtLineStart: endsNL }

-- | `block name indent` — render the override for `name` from the layered block
-- | stack (`env.blocks`) under the outer-wins rule (`blookup`), else the
-- | **default** body (`ctl.children`). Block resolution consults `env.blocks`
-- | **only**: a data key of the same name never overrides a block. Both branches
-- | render in the current data context (where the `block` site sits).
-- |
-- | Reindentation, part 2 — "added at the site of expansion" (§4.6.2): when the
-- | parent's `{{$block}}` is standalone (arity-2), the block's expansion indent is
-- | prepended to each line of the (already definition-site-dedented, see
-- | `harvestBlocks`) override. The expansion indent is the standalone tag's own
-- | leading whitespace (`indent`), or — when the tag sits at column 0 — the
-- | default body's intrinsic indentation ("Intrinsic indentation"). The default
-- | body is never reindented.
blockH :: forall m. MonadThrow Error m => Operation m MinEnv
blockH ctl args = case args of
  [ VString name, VString indent ] -> case blookup name (minBlocks ctl.env) of
    Just override -> do
      -- the expansion indent is the standalone tag's own indent, or — when the
      -- tag is at column 0 — the default body's intrinsic indentation. Render the
      -- default for that fallback *only* when needed (rendering it eagerly would
      -- diverge on a recursive default body).
      expand <-
        if indent /= "" then pure indent
        else leadingIndent <$> ctl.render ctl.env ctl.children
      out <- ctl.render ctl.env override
      pure (VSafe (indentOverride expand out))
    Nothing -> VSafe <$> ctl.render ctl.env ctl.children
  -- a non-standalone block (arity-1): render the override (or default) verbatim,
  -- no reindentation (§4.6.2 reindentation applies only to standalone blocks).
  [ VString name ] -> case blookup name (minBlocks ctl.env) of
    Just override -> VSafe <$> ctl.render ctl.env override
    Nothing -> VSafe <$> ctl.render ctl.env ctl.children
  _ -> throwError (HelperError "block: expected exactly one string name")

-- | The leading horizontal-whitespace run of the first line of a rendered string
-- | (its "intrinsic" indentation), used as a fallback block-expansion indent.
leadingIndent :: String -> String
leadingIndent s =
  SCU.fromCharArray (Array.takeWhile isHWs (SCU.toCharArray s))
  where
  isHWs c = c == ' ' || c == '\t'

-- | Add the block's expansion `indent` to each line of an override's rendered
-- | text (the definition-site dedent has already run; see `harvestBlocks`). A
-- | standalone block occupies a full line slot in the parent, so the result ends
-- | with exactly one trailing newline (the slot's line terminator) regardless of
-- | whether the override source ended in one. An empty expansion indent is the
-- | identity apart from that trailing-newline guarantee.
indentOverride :: String -> String -> String
indentOverride indent body
  | body == "" = body
  | otherwise = ensureTrailingNL (joinWith "\n" (Array.mapWithIndex prefix ls))
      where
      ls = split (Pattern "\n") body
      lastI = Array.length ls - 1
      prefix i l = if (i == lastI && l == "") || l == "" then l else indent <> l

-- | Append a single trailing newline unless the string already ends in one.
ensureTrailingNL :: String -> String
ensureTrailingNL s = if SCU.takeRight 1 s == "\n" then s else s <> "\n"

-- | Re-apply a standalone partial's captured leading whitespace to each line of
-- | the partial's **template** (§4.6) — *before* rendering, so a newline produced
-- | by an interpolated value is **not** indented (only the partial's own static
-- | line breaks are). The indent is prepended at the partial's start and after
-- | every newline in a `Content` node, except a trailing newline at the very end
-- | of the partial (which would indent a phantom final line). An empty `indent`
-- | (a non-standalone partial) is identity.
indentTemplate :: String -> Template -> Template
indentTemplate indent tmpl
  | indent == "" = tmpl
  | otherwise = go true 0 tmpl
      where
      lastI = Array.length tmpl - 1
      go atLineStart i nodes = case Array.uncons nodes of
        Nothing -> []
        Just { head, tail } ->
          let
            isLast = i == lastI
          in
            case head of
              Content s ->
                let
                  { text, nextAtLineStart } = indentContent atLineStart isLast s
                in
                  Array.cons (Content text) (go nextAtLineStart (i + 1) tail)
              other ->
                let
                  -- a tag at line start is preceded by the indent as its own
                  -- content; tags carry no newline, so the next node is not.
                  pre = if atLineStart then [ Content indent ] else []
                in
                  pre <> Array.cons other (go false (i + 1) tail)

      -- Indent one content string: prefix `indent` if we begin a line, and insert
      -- `indent` after every internal newline. A trailing newline that ends the
      -- *last* node gets no following indent (no phantom final line); a trailing
      -- newline elsewhere defers the indent to the next node (`nextAtLineStart`).
      indentContent atLineStart isLast s =
        let
          parts = split (Pattern "\n") s
          nParts = Array.length parts
          lastP = nParts - 1
          endsNL = lastP >= 0 && Array.index parts lastP == Just ""
          piece j p =
            let
              lead = if (j == 0 && atLineStart) || j > 0 then indent else ""
              -- the final empty piece after a trailing newline carries no indent
              -- when this is the last node; otherwise its indent defers downstream.
              dropLead = j == lastP && p == "" && (j > 0)
            in
              if dropLead then "" else lead <> p
          text = joinWith "\n" (Array.mapWithIndex piece parts)
          nextAtLineStart = endsNL
        in
          { text, nextAtLineStart: nextAtLineStart && not isLast }
