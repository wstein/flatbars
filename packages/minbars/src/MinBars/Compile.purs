-- | The MinBars **emit rules** for the dialect-agnostic `FlatBars.Compile` driver
-- | (ADR-016). MinBars is a *peer* engine, so — unlike the RawBars/ClassicBars/MaxBars
-- | ladder, which shares `FlatBars.Compile.Emit.classicbarsEmit` — it plugs in its own
-- | `Emit` targeting the MinBars `m*` runtime ops (`flatbars-runtime.mjs`), exactly
-- | as it plugs in its own `Engine m MinEnv` for interpretation.
-- |
-- | The desugar (`MinBars.Surface`) has already rewritten the surface into core
-- | applications over a closed helper set, so this only has to map those:
-- |
-- |  * `(mlookup "name")` → `rt.mlookup(env, "name")` — context-stack resolve.
-- |  * `(escape e)`       → `rt.esc(e)` — stringify + HTML-escape (reused; the
-- |    runtime's `escapeHtml`/`stringify` already match the kernel's, gated by the
-- |    compile-conformance harness). Raw output goes through the driver's `rt.out`.
-- |  * `section`  → `rt.msection(value, env, fn)` — the body renders once per
-- |    pushed frame (array → per element; truthy non-list → once; falsy → never).
-- |  * `inverted` → an inline `if (rt.mfalsy(env, value)) { … }` (no push).
-- |
-- | `partial`/`parent`/`block` are out of scope for slice 1 and are rejected up
-- | front by `MinBars.compileMinJs` (a `DisallowedShape`), so they never reach
-- | these rules; the defensive arms emit a throwing stub rather than miscompile.
module MinBars.Compile
  ( minEmit
  ) where

import Prelude

import Data.Array as Array
import Data.Maybe (Maybe(..))
import FlatBars.Compile (Ctx, Emit, Rec, jsString)
import FlatBars.Syntax (Expr(..), Ident, Template)
import FlatBars.Value (Value(..))

-- | The MinBars emission rules.
minEmit :: Emit
minEmit = { expr: mExpr, block: mBlock }

mExpr :: Rec -> Ctx -> Expr -> String
mExpr rec ctx = case _ of
  -- A context-stack lookup; the (possibly dotted) name is a baked-in string lit.
  App "mlookup" [ Lit (VString name) ] -> "rt.mlookup(" <> ctx.scope <> ", " <> jsString name <> ")"
  -- Escaped interpolation reuses the shared escape op (`{{x}}`); raw output
  -- (`{{{x}}}`) is the bare `mlookup`, stringified by the driver's `rt.out`.
  App "escape" [ a ] -> "rt.esc(" <> rec.expr ctx a <> ")"
  Lit v -> litJs v
  _ -> "(function () { throw new Error(\"MinBars compile: unsupported expression\"); })()"

mBlock :: Rec -> Ctx -> Ident -> Array Expr -> Template -> String
mBlock rec ctx name args body = case name of
  -- Polymorphic section: the body runs in a fresh child frame per pushed item.
  "section" ->
    "  out += rt.msection(" <> arg0 <> ", " <> ctx.scope <> ", function (" <> child.scope
      <> ") { let out = \"\";\n"
      <> rec.nodes child body
      <> "  return out; });\n"
  -- Inverted section: render the body once, in the unchanged context, iff falsy.
  "inverted" ->
    "  if (rt.mfalsy(" <> ctx.scope <> ", " <> arg0 <> ")) {\n" <> rec.nodes ctx body <> "  }\n"
  -- A standalone `{{$block}}` whose override was inlined (ADR-016 slice 3): render
  -- the override into a buffer (in the current data scope, hence a closing-over
  -- IIFE) and reindent each line by the expansion indent (a compile-time literal
  -- carried as the sole arg). Non-standalone blocks and defaults are spliced
  -- directly by the inliner and never reach here.
  "@reindent" ->
    "  out += rt.mindentOverride(" <> arg0 <> ", (function () { let out = \"\";\n"
      <> rec.nodes ctx body
      <> "  return out; })());\n"
  _ -> "  throw new Error(\"MinBars compile: unsupported block '" <> name <> "'\");\n"
  where
  child = rec.child ctx
  arg0 = case Array.head args of
    Just e -> rec.expr ctx e
    Nothing -> "null"

-- | A literal as a JS expression. In MinBars-desugared templates the only literal
-- | reaching an expression position is the `mlookup` name (a `VString`, consumed
-- | above), so the other arms are defensive.
litJs :: Value -> String
litJs = case _ of
  VString s -> jsString s
  VBool b -> if b then "true" else "false"
  VNull -> "null"
  VNumber n -> show n
  _ -> "null"
