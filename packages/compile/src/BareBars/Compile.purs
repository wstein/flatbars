-- | The dialect-agnostic template *compiler* — the fourth instance of the
-- | BareBars inversion-of-control pattern.
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
-- | runtime (`runtime/barebars-runtime.mjs`); data-dependent work is deferred to
-- | it, so the compiled function operates on plain JS values, not the `Value`
-- | ADT.
-- |
-- | The output is one ES module: `export default function (data, rt) { … }`.
module BareBars.Compile
  ( Ctx
  , Rec
  , Emit
  , compile
  , jsString
  ) where

import Prelude

import BareBars.Syntax (Expr, Ident, Node(..), Template)
import Data.Foldable (foldMap)
import Data.String as String
import Data.String.CodeUnits as SCU

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

-- | Compile a `Template` to an ES-module JS source string. `runtimeVersion` is
-- | recorded in a header and checked by the runtime (a Handlebars-style
-- | `compilerInfo` handshake).
compile :: { runtimeVersion :: String } -> Emit -> Template -> String
compile meta emit tmpl =
  "// barebars-compiled — runtime " <> meta.runtimeVersion <> "\n"
    <> "export const runtimeVersion = "
    <> jsString meta.runtimeVersion
    <> ";\n"
    <> "export default function (data, rt) {\n"
    <> "  let out = \"\";\n"
    <> "  const c0 = rt.scope(data);\n"
    <> rec.nodes { scope: "c0", depth: 0 } tmpl
    <> "  return out;\n}\n"
  where
  rec :: Rec
  rec =
    { expr: \ctx e -> emit.expr rec ctx e
    , nodes: \ctx ts -> foldMap (node ctx) ts
    , child: \ctx -> { scope: "c" <> show (ctx.depth + 1), depth: ctx.depth + 1 }
    }

  -- The universal, meaning-free node cases; `Block`/`Expr` defer to the dialect.
  node :: Ctx -> Node -> String
  node ctx = case _ of
    Content s -> stmtOut (jsString s)
    Output _ e -> stmtOut ("rt.out(" <> rec.expr ctx e <> ")")
    Block _ name args body -> emit.block rec ctx name args body
    -- a separator rendered on its own is just its helper applied (the engine's
    -- rule); `else` standing alone yields "" — the runtime decides.
    Sep _ name args -> stmtOut
      ( "rt.out(rt.call(" <> jsString name <> ", [" <> commaArgs ctx args <> "], " <> ctx.scope <>
          "))"
      )
    -- a raw block's verbatim body, passed through its raw helper.
    RawBlock _ name _ raw -> stmtOut ("rt.raw(" <> jsString name <> ", " <> jsString raw <> ")")

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
