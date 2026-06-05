-- | The shared **emit rules** for the dialect-agnostic `FlatBars.Compile` driver
-- | — the FullBars *value semantics* lowered to JS, used by every dialect that
-- | compiles (RawBars/FullBars/MaxBars). It depends only on the driver and the
-- | kernel value policy, *never* on a dialect (no surface desugar here), so the
-- | austere RawBars compile path can use it without pulling in FullBars.
-- |
-- | The optimiser tier: `if`/`unless`/`each`/`with` emit native JS control flow;
-- | the hot value helpers (`this`/`lookup`/`escapeHtml`/`safe`) inline to direct
-- | runtime calls; everything else routes through `rt.call`/`rt.block`. The code
-- | runs against `runtime/flatbars-runtime.mjs`.
module FlatBars.Compile.Emit
  ( fullbarsEmit
  , coreEmit
  , metaFor
  , runtimeVersion
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..), isJust, maybe)
import Data.String (joinWith)
import FlatBars.Compile (Ctx, Emit, Rec, jsString)
import FlatBars.Syntax (Expr(..), Ident, Template, splitBlockArgs)
import FlatBars.Value (Value(..))
import Kernel.Prelude (sectionableValueNames)
import Kernel.Walk (Clause, splitClauses)

-- | The runtime contract version, recorded in the compiled header and checked by
-- | `flatbars-runtime.mjs`. Bump on any runtime-incompatible codegen change.
runtimeVersion :: String
runtimeVersion = "0.1.0"

-- | The compile metadata for the RefEnv dialects, parameterised by the runtime
-- | truthiness *callback* the root frame is seeded with (ADR-022 — truthiness is
-- | only ever a `Value -> Boolean` callback, never a baked falsy-set):
-- | `"rt.truthyHandlebars"` for FullBars, `"rt.truthyNonEmpty"` for RawBars/MaxBars.
-- | The seed references the callback directly (no module-level const — `rt` is only
-- | in scope inside the emitted function). MinBars supplies its own metadata.
metaFor :: String -> { runtimeVersion :: String, preamble :: String, seed :: String }
metaFor truthyCallback =
  { runtimeVersion
  , preamble: ""
  , seed: "rt.scope(data, " <> truthyCallback <> ")"
  }

-- | The *lenient* emit (FullBars / MaxBars): a prelude value helper used as a
-- | bare block (`{{#count}}…{{/count}}`) compiles to a data *section*, mirroring
-- | the interpreter's `Kernel.Prelude.lenientResolve`.
fullbarsEmit :: Emit
fullbarsEmit = emitWith true

-- | The *strict* emit (RawBars): no value-helper sectioning — RawBars keeps the
-- | austere `runResolved` resolve, so a value helper in block position is applied
-- | as-is (matching its interpreter), not rescued as a section.
coreEmit :: Emit
coreEmit = emitWith false

emitWith :: Boolean -> Emit
emitWith lenient = { expr: fbExpr, block: fbBlock lenient }

--------------------------------------------------------------------------------
-- Expressions
--------------------------------------------------------------------------------

-- Inline the hot helpers; route the rest through the runtime helper registry.
fbExpr :: Rec -> Ctx -> Expr -> String
fbExpr rec ctx = case _ of
  Lit v -> litJs v
  App "this" [] -> ctx.scope <> ".ctx"
  App "lookup" args -> "rt.lookup(" <> args' rec ctx args <> ")"
  App "escapeHtml" [ a ] -> "rt.esc(" <> rec.expr ctx a <> ")"
  App "safe" [ a ] -> "rt.safe(" <> rec.expr ctx a <> ")"
  -- `{{> name}}` ⇒ `partial name ctx [hash]` ⇒ a runtime partial call against
  -- the in-scope registry (`partials`).
  App "partial" args ->
    "rt.partial(" <> argAt rec ctx args 0 <> ", " <> argAt rec ctx args 1 <> ", "
      <> argAt rec ctx args 2
      <> ", partials, rt)"
  App name args ->
    "rt.call(" <> jsString name <> ", [" <> args' rec ctx args <> "], " <> ctx.scope <> ")"

-- The nth argument as a JS expression, or `null` if absent (partials take
-- name, context, and an optional hash object).
argAt :: Rec -> Ctx -> Array Expr -> Int -> String
argAt rec ctx args i = case Array.index args i of
  Just e -> rec.expr ctx e
  Nothing -> "null"

litJs :: Value -> String
litJs = case _ of
  VString s -> jsString s
  VNumber n -> show n
  VBool b -> if b then "true" else "false"
  VNull -> "null"
  VSafe s -> "rt.safe(" <> jsString s <> ")"
  VArray _ -> "null" -- array/object literals do not occur in source exprs
  VObject _ -> "null"

args' :: Rec -> Ctx -> Array Expr -> String
args' rec ctx = joinWith ", " <<< map (rec.expr ctx)

--------------------------------------------------------------------------------
-- Blocks — native control flow for the prelude, runtime fallback otherwise
--------------------------------------------------------------------------------

fbBlock :: Boolean -> Rec -> Ctx -> Ident -> Array Expr -> Template -> String
fbBlock lenient rec ctx name args body =
  -- Demarker `@hash`/`@param` once, centrally (ADR-020 Phase 3): the built-in
  -- lowerings see the plain positional args they saw before (the interpreter does
  -- the same in its `blockArgs` seam); `rtBlock` also reads the hash/param channel.
  let
    split = splitBlockArgs args
    -- A prelude value helper used as a *bare* block (`{{#count}}…{{/count}}`, any
    -- body) has no argument to apply, so the lenient dialects read it as a data
    -- section — the compiled twin of `Kernel.Prelude.valueOrSection`. The runtime
    -- is told via `channel.section`. `fbBlock` only ever runs in block position, so
    -- the gate is just (sectionable name, no positional args) — the exact mirror of
    -- the interpreter's `Array.null args`, keeping the two paths byte-identical.
    section =
      lenient
        && Array.elem name sectionableValueNames
        && Array.null split.positional
  in
    case name of
      "if" -> ifBlock rec ctx (truthyTest rec ctx split.positional) body
      "unless" -> ifBlock rec ctx ("!(" <> truthyTest rec ctx split.positional <> ")") body
      "each" -> frameBlock rec ctx "each" split.positional split.label body
      "with" -> frameBlock rec ctx "with" split.positional split.label body
      -- an un-hoisted `{{#inline}}` (core path) is a no-op, like the `inline` helper.
      "inline" -> ""
      -- A block partial (`{{#partial name}}body{{/partial}}` / `{{#>name}}`): like
      -- the inline `{{> name}}` but the body is threaded as a thunk so that
      -- `{{> @partial-block}}` / `{{yield}}` inside the partial render it (the
      -- rt-stack — `rt.partialBlock`). The body renders in the *caller's* frame
      -- (`ctx.scope`, closed over), matching `Kernel.Prelude.partialH`.
      "partial" ->
        "  out += rt.partialBlock(" <> argAt rec ctx args 0 <> ", " <> argAt rec ctx args 1
          <> ", "
          <> argAt rec ctx args 2
          <> ", partials, rt, "
          <> bodyThunk rec ctx body
          <> ");\n"
      _ -> rtBlock section rec ctx name split body

-- The condition test: 1 arg ⇒ `rt.truthy`; an options object (includeZero) ⇒
-- `rt.truthyWith`. `scope.truthy` is the engine's truthiness *callback* (ADR-022).
truthyTest :: Rec -> Ctx -> Array Expr -> String
truthyTest rec ctx args = case args of
  [ c ] -> "rt.truthy(" <> ctx.scope <> ".truthy, " <> rec.expr ctx c <> ")"
  [ c, opts ] ->
    "rt.truthyWith(" <> ctx.scope <> ".truthy, " <> rec.expr ctx c <> ", " <> rec.expr ctx opts <>
      ")"
  _ -> "false"

-- `if`/`unless`: branches share the current frame (no context shift), so they
-- are inline `if/else` over the same `out`. The clause chain handles `elif`.
ifBlock :: Rec -> Ctx -> String -> Template -> String
ifBlock rec ctx test body =
  let
    s = splitClauses body
  in
    "  if (" <> test <> ") {\n" <> rec.nodes ctx s.before <> "  }" <> elseChain rec ctx s.clauses <>
      "\n"

elseChain :: Rec -> Ctx -> Array Clause -> String
elseChain rec ctx clauses = case Array.uncons clauses of
  Nothing -> ""
  Just { head: cl, tail } -> case cl.name of
    -- `elif cond [opts]` reuses `truthyTest`, so a 2-arg `{{elif c includeZero=true}}`
    -- emits `rt.truthyWith` like the head `if` (and isn't mistaken for a terminal
    -- `else`, as the old `"elif", [cond]`-only match did).
    "elif" ->
      " else if (" <> truthyTest rec ctx cl.args <> ") {\n"
        <> rec.nodes ctx cl.body
        <> "  }"
        <> elseChain rec ctx tail
    _ -> " else {\n" <> rec.nodes ctx cl.body <> "  }" -- else (terminal)

-- `each`/`with`: shift the frame, so the body runs in a fresh scope variable and
-- its own buffer; the empty/falsy `else` clause renders in the parent frame. The
-- subject is the first argument; any trailing *string-literal* arguments are
-- block-param binding names (surface `as |item i|` desugars to them), passed to
-- the runtime to bind in the child frame.
frameBlock :: Rec -> Ctx -> String -> Array Expr -> Maybe String -> Template -> String
frameBlock rec ctx fn args label body =
  let
    s = splitClauses body
    child = rec.child ctx
    subject = head1 rec ctx args
    names = "[" <> joinWith ", " (map jsString (bindingNames (Array.drop 1 args))) <> "]"
    -- a loop `label NAME` (ADR-013) binds the frame reified as an object; the
    -- runtime builds the same field set the interpreter's `iterate` does.
    labelJs = maybe "null" jsString label
    elseClause = case Array.head s.clauses of
      Just cl -> cl.body
      Nothing -> []
  in
    "  out += rt." <> fn <> "(" <> subject <> ", " <> ctx.scope <> ", " <> names <> ", "
      <> labelJs
      <> ", "
      <> lambda rec child s.before
      <> ", "
      <> lambda rec ctx elseClause
      <> ");\n"

-- The trailing string-literal arguments — block-param binding names.
bindingNames :: Array Expr -> Array String
bindingNames = Array.mapMaybe case _ of
  Lit (VString s) -> Just s
  _ -> Nothing

-- A `function (frame) { let out=""; …; return out; }` for a sub-body.
lambda :: Rec -> Ctx -> Template -> String
lambda rec ctx body =
  "function (" <> ctx.scope <> ") { let out = \"\";\n" <> rec.nodes ctx body <> "  return out; }"

-- A *zero-arg* body thunk for a block partial: renders the body in the caller's
-- frame (`ctx.scope`, captured by the closure rather than passed in), so the
-- rt-stack can invoke it from inside the named partial for `{{yield}}`.
bodyThunk :: Rec -> Ctx -> Template -> String
bodyThunk rec ctx body =
  "function () { let out = \"\";\n" <> rec.nodes ctx body <> "  return out; }"

-- An unrecognised block helper: hand the body to the runtime as closures, so the
-- engine's control handle survives as JS functions (the baseline tier). `section`
-- flags a prelude value helper used as a bare block (`{{#count}}`): the runtime
-- then reads the head as data instead of applying the helper (see `block` in
-- `flatbars-runtime.mjs`), mirroring the interpreter's `lenientResolve`.
rtBlock
  :: Boolean
  -> Rec
  -> Ctx
  -> Ident
  -> { positional :: Array Expr, hash :: Maybe Expr, params :: Array String, label :: Maybe String }
  -> Template
  -> String
rtBlock section rec ctx name split body =
  let
    s = splitClauses body
    -- The hash + block-param values occupy the trailing positional slots (hash,
    -- then the `as |…|` values); drop them from the args and pass them through the
    -- `options` channel instead (ADR-020 Phase 3) — mirroring the interpreter.
    nDrop = Array.length split.params + (if isJust split.hash then 1 else 0)
    realArgs = Array.take (Array.length split.positional - nDrop) split.positional
    hashJs = maybe "null" (rec.expr ctx) split.hash
    paramsJs = "[" <> joinWith ", " (map jsString split.params) <> "]"
  in
    "  out += rt.block(" <> jsString name <> ", [" <> args' rec ctx realArgs <> "], "
      <> ctx.scope
      <> ", "
      <> lambda rec (rec.child ctx) s.before
      <> ", "
      <> clausesObj rec ctx s.clauses
      <> ", { hash: "
      <> hashJs
      <> ", params: "
      <> paramsJs
      <> ", section: "
      <> (if section then "true" else "false")
      <> " }"
      <> ");\n"

clausesObj :: Rec -> Ctx -> Array Clause -> String
clausesObj rec ctx clauses =
  "{" <> joinWith ", " (map one clauses) <> "}"
  where
  one cl = jsString cl.name <> ": " <> lambda rec (rec.child ctx) cl.body

head1 :: Rec -> Ctx -> Array Expr -> String
head1 rec ctx args = case Array.head args of
  Just e -> rec.expr ctx e
  Nothing -> "null"
