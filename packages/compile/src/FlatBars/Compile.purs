-- | The dialect-agnostic template *compiler* — the fourth instance of the
-- | FlatBars inversion-of-control pattern.
-- |
-- |   * interpret = a traversal driver + an `Engine` (helper meanings)
-- |   * desugar   = a fold driver + rewrite rules
-- |   * validate  = a walk driver + a `Schema`
-- |   * *compile* = an **emit driver** + **`Emit` rules** (this module)
-- |
-- | This module owns the meaning-free part: walking the structural `Template`
-- | and assembling a JS function source. It assigns no meaning to any name —
-- | a *dialect* plugs in an `Emit` record that decides how an expression and a
-- | block become JavaScript. Core's rules route everything through the runtime
-- | (the faithful baseline); FullBars' rules additionally emit native control
-- | flow for `if`/`each`/… (the optimiser). The emitted JS runs against a small
-- | runtime (`runtime/flatbars-runtime.mjs`); data-dependent work is deferred to
-- | it, so the compiled function operates on plain JS values, not the `Value`
-- | ADT.
-- |
-- | The output is one ES module: `export default function (data, rt) { … }`.
module FlatBars.Compile
  ( Ctx
  , Rec
  , Emit
  , compile
  , jsString
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldMap)
import Data.String as String
import Data.String.CodeUnits as SCU
import Data.Tuple (Tuple(..))
import FlatBars.Syntax (Expr, Ident, Node(..), Template)

-- | The compile-time context threaded through emission: the JS variable holding
-- | the current frame, and its nesting depth (so a block can mint a fresh,
-- | non-colliding child-frame variable).
type Ctx = { scope :: String, depth :: Int }

-- | The recursion handles the driver hands an `Emit` rule, so a rule can compile
-- | sub-expressions and sub-bodies without knowing the traversal.
type Rec =
  { expr :: Ctx -> Expr -> String -- compile an Expr → a JS *expression*
  , nodes :: Ctx -> Template -> String -- compile a node run → JS *statements* (append to `out`)
  , child :: Ctx -> Ctx -- a fresh child-frame context (new scope variable)
  }

-- | A dialect's emission rules — the *only* meaning-bearing part. Everything
-- | else (content, raw output, separators) is universal and handled by the
-- | driver. `expr` decides which helpers to inline vs route through the runtime;
-- | `block` decides which blocks become native control flow vs a runtime call.
type Emit =
  { expr :: Rec -> Ctx -> Expr -> String
  , block :: Rec -> Ctx -> Ident -> Array Expr -> Template -> String
  }

-- | Compile a template to an ES-module JS source string. `runtimeVersion` is
-- | recorded in a header and checked by the runtime (a Handlebars-style
-- | `compilerInfo` handshake). `partials` are named sub-templates (e.g. hoisted
-- | `{{#inline}}` definitions) compiled into a local registry the module passes
-- | to `rt.partial`; the dialect's `Emit.expr` decides how a partial *call* is
-- | emitted.
-- |
-- | Every module is `function (data, rt, partials)` — `partials` defaults to
-- | `{}`, so a caller may invoke `fn(data, rt)`; the main function augments it
-- | with its inline definitions, and each partial receives the registry too (so
-- | nested partials resolve).
-- |
-- | `preamble` is opaque dialect JS injected at module top (e.g. FullBars' falsy
-- | -set const), and `seed` is the JS expression building the root frame from
-- | `data` (default `rt.scope(data)`; FullBars seeds it with the falsy-set). The
-- | driver treats both as opaque strings — it stays meaning-free.
compile
  :: { runtimeVersion :: String, preamble :: String, seed :: String }
  -> Emit
  -> Array (Tuple String Template)
  -> Template
  -> String
compile meta emit partials main =
  "// flatbars-compiled — runtime " <> meta.runtimeVersion <> "\n"
    <> "export const runtimeVersion = "
    <> jsString meta.runtimeVersion
    <> ";\n"
    <> meta.preamble -- dialect module-level declarations (e.g. the falsy-set const)
    <> "export default "
    <> fn true main
    <> "\n"
  where
  rec :: Rec
  rec =
    { expr: \ctx e -> emit.expr rec ctx e
    , nodes: \ctx ts -> foldMap (node ctx) ts
    , child: \ctx -> { scope: "c" <> show (ctx.depth + 1), depth: ctx.depth + 1 }
    }

  -- A `function (data, rt, partials) { … }`. The main function (`withRegistry`)
  -- merges the inline-partial registry into `partials`; partial functions just
  -- use the registry they are handed.
  fn :: Boolean -> Template -> String
  fn withRegistry t =
    "function (data, rt, partials) {\n  partials = partials || {};\n"
      <> (if withRegistry then registry else "")
      <> "  let out = \"\";\n  const c0 = "
      <> meta.seed
      <> ";\n"
      <> rec.nodes { scope: "c0", depth: 0 } t
      <> "  return out;\n}"

  registry :: String
  registry
    | Array.null partials = ""
    | otherwise =
        "  partials = Object.assign({}, partials, {\n"
          <> String.joinWith ",\n"
            (map (\(Tuple n t) -> "    " <> jsString n <> ": " <> fn false t) partials)
          <> "\n  });\n"

  -- The universal, meaning-free node cases; `Block`/`Expr` defer to the dialect.
  node :: Ctx -> Node -> String
  node ctx = case _ of
    Content _ s -> stmtOut (jsString s)
    Output _ e -> stmtOut ("rt.out(" <> rec.expr ctx e <> ")")
    -- the sigil is `Section` here: FullBars desugars `Inverse` (`{{^}}`) to
    -- `unless` upstream, and RawBars rejects it — so the compiler never sees it.
    Block _ _ name args body -> emit.block rec ctx name args body
    -- a separator rendered on its own is just its helper applied (the engine's
    -- rule); `else` standing alone yields "" — the runtime decides.
    Sep _ name args -> stmtOut
      ( "rt.out(rt.call(" <> jsString name <> ", [" <> commaArgs ctx args <> "], " <> ctx.scope <>
          "))"
      )
    -- a raw block hands its verbatim body to the head helper (via options.fn()).
    -- The head resolves STRICTLY in the runtime — undefined ⇒ UnknownHelper, never
    -- an implicit section — mirroring the interpreter's `Engine.resolveStrict`.
    RawBlock _ name args raw -> stmtOut
      ( "rt.raw(" <> jsString name <> ", [" <> commaArgs ctx args <> "], " <> jsString raw <> ", "
          <> ctx.scope
          <> ")"
      )
    -- a recovered parse error (ADR-023) emits nothing: the compiler only runs on
    -- error-free trees (the fail-fast parse projection rejects the rest).
    NodeError _ _ -> ""

  commaArgs :: Ctx -> Array Expr -> String
  commaArgs ctx = String.joinWith ", " <<< map (rec.expr ctx)

-- | `out += <expr>;` — the one output primitive (string concatenation, as in
-- | Handlebars' default buffer).
stmtOut :: String -> String
stmtOut e = "  out += " <> e <> ";\n"

-- | A JS double-quoted string literal with the dangerous characters escaped.
jsString :: String -> String
jsString s = "\"" <> foldMap esc (SCU.toCharArray s) <> "\""
  where
  esc c = case c of
    '"' -> "\\\""
    '\\' -> "\\\\"
    '\n' -> "\\n"
    '\r' -> "\\r"
    '\t' -> "\\t"
    '\x2028' -> "\\u2028" -- JS line separators are not valid in string literals
    '\x2029' -> "\\u2029"
    _ -> SCU.singleton c
