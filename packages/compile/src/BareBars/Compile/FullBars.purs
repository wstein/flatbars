-- | The **FullBars** dialect's compile rules — the first `Emit` binding for the
-- | dialect-agnostic `BareBars.Compile` driver (Core/Max would add their own).
-- |
-- | This is the *optimiser* tier: the prelude's block helpers (`if`/`unless`/
-- | `each`/`with`) emit native JS control flow, and the hot value helpers
-- | (`this`/`lookup`/`esc_html`/`safe`) inline to direct runtime calls;
-- | everything else routes through `rt.call`/`rt.block` (the faithful baseline).
-- | The emitted code runs against `runtime/barebars-runtime.mjs`, which carries
-- | the FullBars value semantics — including the deliberate divergences
-- | (content-based `VSafe` truthiness, explicit escaping).
module BareBars.Compile.FullBars
  ( fullbarsEmit
  , compileCore
  , compileSurface
  , runtimeVersion
  ) where

import Prelude

import BareBars.Compile (Ctx, Emit, Rec, compile, jsString)
import BareBars.Error (ParseError)
import BareBars.Parser (parse)
import BareBars.Syntax (Expr(..), Ident, Template)
import BareBars.Value (Value(..))
import BareBars.Walk (Clause, splitClauses)
import Data.Array as Array
import Data.Either (Either)
import Data.Maybe (Maybe(..))
import Data.String (joinWith)
import FullBars (desugarSurface)

-- | The runtime contract version, recorded in the compiled header and checked by
-- | `barebars-runtime.mjs`. Bump on any runtime-incompatible codegen change.
runtimeVersion :: String
runtimeVersion = "0.1.0"

-- | Compile *core* FullBars source to a JS ES module.
compileCore :: String -> Either ParseError String
compileCore src = compile { runtimeVersion } fullbarsEmit <$> parse src

-- | Compile *surface* FullBars source: desugar (paths, `{{ }}` auto-escape,
-- | `@data`, hash args, block params, `else if`) to the core skeleton, then emit
-- | with the same rules. The emit rules are dialect-pure — they only ever see
-- | core — so surface is just one `desugarSurface` upstream.
compileSurface :: String -> Either ParseError String
compileSurface src = (compile { runtimeVersion } fullbarsEmit <<< desugarSurface) <$> parse src

fullbarsEmit :: Emit
fullbarsEmit = { expr: fbExpr, block: fbBlock }

--------------------------------------------------------------------------------
-- Expressions
--------------------------------------------------------------------------------

-- Inline the hot helpers; route the rest through the runtime helper registry.
fbExpr :: Rec -> Ctx -> Expr -> String
fbExpr rec ctx = case _ of
  Lit v -> litJs v
  App "this" [] -> ctx.scope <> ".ctx"
  App "lookup" args -> "rt.lookup(" <> args' rec ctx args <> ")"
  App "esc_html" [ a ] -> "rt.esc(" <> rec.expr ctx a <> ")"
  App "safe" [ a ] -> "rt.safe(" <> rec.expr ctx a <> ")"
  App name args ->
    "rt.call(" <> jsString name <> ", [" <> args' rec ctx args <> "], " <> ctx.scope <> ")"

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

fbBlock :: Rec -> Ctx -> Ident -> Array Expr -> Template -> String
fbBlock rec ctx name args body = case name of
  "if" -> ifBlock rec ctx (truthyTest rec ctx args) body
  "unless" -> ifBlock rec ctx ("!(" <> truthyTest rec ctx args <> ")") body
  "each" -> frameBlock rec ctx "each" args body
  "with" -> frameBlock rec ctx "with" args body
  _ -> rtBlock rec ctx name args body

-- The condition test: 1 arg ⇒ `rt.truthy`; an options object (includeZero) ⇒
-- `rt.truthyWith`.
truthyTest :: Rec -> Ctx -> Array Expr -> String
truthyTest rec ctx args = case args of
  [ c ] -> "rt.truthy(" <> rec.expr ctx c <> ")"
  [ c, opts ] -> "rt.truthyWith(" <> rec.expr ctx c <> ", " <> rec.expr ctx opts <> ")"
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
  Just { head: cl, tail } -> case cl.name, cl.args of
    "elif", [ cond ] ->
      " else if (rt.truthy(" <> rec.expr ctx cond <> ")) {\n"
        <> rec.nodes ctx cl.body
        <> "  }"
        <> elseChain rec ctx tail
    _, _ -> " else {\n" <> rec.nodes ctx cl.body <> "  }" -- else (terminal)

-- `each`/`with`: shift the frame, so the body runs in a fresh scope variable and
-- its own buffer; the empty/falsy `else` clause renders in the parent frame. The
-- subject is the first argument; any trailing *string-literal* arguments are
-- block-param binding names (surface `as |item i|` desugars to them), passed to
-- the runtime to bind in the child frame.
frameBlock :: Rec -> Ctx -> String -> Array Expr -> Template -> String
frameBlock rec ctx fn args body =
  let
    s = splitClauses body
    child = rec.child ctx
    subject = head1 rec ctx args
    names = "[" <> joinWith ", " (map jsString (bindingNames (Array.drop 1 args))) <> "]"
    elseClause = case Array.head s.clauses of
      Just cl -> cl.body
      Nothing -> []
  in
    "  out += rt." <> fn <> "(" <> subject <> ", " <> ctx.scope <> ", " <> names <> ", "
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

-- An unrecognised block helper: hand the body to the runtime as closures, so the
-- engine's control handle survives as JS functions (the baseline tier).
rtBlock :: Rec -> Ctx -> Ident -> Array Expr -> Template -> String
rtBlock rec ctx name args body =
  let
    s = splitClauses body
  in
    "  out += rt.block(" <> jsString name <> ", [" <> args' rec ctx args <> "], "
      <> ctx.scope
      <> ", "
      <> lambda rec (rec.child ctx) s.before
      <> ", "
      <> clausesObj rec ctx s.clauses
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
