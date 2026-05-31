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
  , compileCoreWith
  , compileSurface
  , compileSurfaceWith
  , resolveForCompile
  , metaFor
  , runtimeVersion
  ) where

import Prelude

import BareBars.Compile (Ctx, Emit, Rec, compile, jsString)
import BareBars.Error (Error(..), ParseError(..))
import BareBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import BareBars.Syntax (Directive, Expr(..), Ident, Template)
import BareBars.Value (Value(..))
import BareBars.Walk (Clause, splitClauses)
import Data.Array as Array
import Data.Bifunctor (lmap)
import Data.Either (Either)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Set as Set
import Data.String (joinWith)
import FullBars (FalsySet, FalsyShape(..), desugarSurface, hoistInline, resolveTruthiness)

-- | The runtime contract version, recorded in the compiled header and checked by
-- | `barebars-runtime.mjs`. Bump on any runtime-incompatible codegen change.
runtimeVersion :: String
runtimeVersion = "0.1.0"

-- | Compile *core* FullBars source to a JS ES module. Core does *not* hoist
-- | `{{#inline}}` (matching the core interpreter `renderWith`, which doesn't):
-- | an `{{#inline}}` block is a no-op and a `{{> }}`/`partial` to an
-- | unregistered name is a runtime error, exactly as in the interpreter.
compileCore :: String -> Either ParseError String
compileCore = compileCoreWith defaultParseOptions

-- | `compileCore` with explicit parse options (CLI/config: standalone trim).
compileCoreWith :: ParseOptions -> String -> Either ParseError String
compileCoreWith opts src = do
  { directives, nodes } <- parseWith opts src
  fs <- resolveForCompile directives
  pure (compile (metaFor fs) fullbarsEmit [] nodes)

-- | Compile *surface* FullBars source: desugar (paths, `{{ }}` auto-escape,
-- | `@data`, hash args, block params, `else if`) to the core skeleton, hoist
-- | `{{#inline}}` definitions into the partial registry (as `renderSurfaceWith`
-- | does), then emit. The emit rules are dialect-pure — they only ever see core.
compileSurface :: String -> Either ParseError String
compileSurface = compileSurfaceWith defaultParseOptions

-- | `compileSurface` with explicit parse options (CLI/config: standalone trim).
compileSurfaceWith :: ParseOptions -> String -> Either ParseError String
compileSurfaceWith opts src = do
  { directives, nodes } <- parseWith opts src
  fs <- resolveForCompile directives
  let h = hoistInline (desugarSurface nodes)
  pure (compile (metaFor fs) fullbarsEmit (Map.toUnfoldable h.partials) h.template)

-- | The compile metadata: the runtime version, a module-level `$falsy` constant
-- | (the file's resolved truthiness mode), and the root-frame seed that hands
-- | `$falsy` to `rt.scope`. Inline partials reference the same module const, so
-- | they inherit the file's mode (Phase 3 parity in the compiled path).
metaFor :: FalsySet -> { runtimeVersion :: String, preamble :: String, seed :: String }
metaFor fs =
  { runtimeVersion
  , preamble: "const $falsy = " <> falsyLiteral fs <> ";\n"
  , seed: "rt.scope(data, $falsy)"
  }

-- | Resolve the file's `@truthiness` mode for codegen, mapping a resolution
-- | error into the compiler's `ParseError` channel (a located `BadDirective`).
resolveForCompile :: Array Directive -> Either ParseError FalsySet
resolveForCompile = lmap toParseError <<< resolveTruthiness
  where
  toParseError = case _ of
    DirectiveError m o -> BadDirective m o
    e -> BadDirective (show e) 0

-- | The falsy-set as a JS object literal `{ b:1, n:1, … }` — one key per present
-- | shape (false/null/""/0/[]/{}); the runtime reads `!!set.<k>`. Mirrors
-- | `FullBars.Value.isFalsy` so the compiled path matches the interpreter.
falsyLiteral :: FalsySet -> String
falsyLiteral fs = "{ " <> joinWith ", " (Array.mapMaybe flag shapes) <> " }"
  where
  shapes = [ FFalse, FNull, FEmptyStr, FZero, FEmptyArr, FEmptyObj ]
  flag sh = if Set.member sh fs then Just (key sh <> ": 1") else Nothing
  key = case _ of
    FFalse -> "b"
    FNull -> "n"
    FEmptyStr -> "s"
    FZero -> "z"
    FEmptyArr -> "a"
    FEmptyObj -> "o"

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

fbBlock :: Rec -> Ctx -> Ident -> Array Expr -> Template -> String
fbBlock rec ctx name args body = case name of
  "if" -> ifBlock rec ctx (truthyTest rec ctx args) body
  "unless" -> ifBlock rec ctx ("!(" <> truthyTest rec ctx args <> ")") body
  "each" -> frameBlock rec ctx "each" args body
  "with" -> frameBlock rec ctx "with" args body
  -- an un-hoisted `{{#inline}}` (core path) is a no-op, like the `inline` helper.
  "inline" -> ""
  _ -> rtBlock rec ctx name args body

-- The condition test: 1 arg ⇒ `rt.truthy`; an options object (includeZero) ⇒
-- `rt.truthyWith`.
truthyTest :: Rec -> Ctx -> Array Expr -> String
truthyTest rec ctx args = case args of
  [ c ] -> "rt.truthy(" <> ctx.scope <> ".falsy, " <> rec.expr ctx c <> ")"
  [ c, opts ] ->
    "rt.truthyWith(" <> ctx.scope <> ".falsy, " <> rec.expr ctx c <> ", " <> rec.expr ctx opts <>
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
  Just { head: cl, tail } -> case cl.name, cl.args of
    "elif", [ cond ] ->
      " else if (rt.truthy(" <> ctx.scope <> ".falsy, " <> rec.expr ctx cond <> ")) {\n"
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
