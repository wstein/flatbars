-- | **Linter.Print** — a faithful pretty-printer of the *core* skeleton AST back
-- | to **RawBars (core) source** text. This is the rendering half of the
-- | linter's *lower* job (loopvars-linter-spec.md §B.2): a MaxBars template,
-- | once desugared to the meaning-free core `Template`, is printed here in the
-- | austere RawBars surface — explicit `{{{ esc_html (lookup this "x") }}}`,
-- | `{{#name …}}`, no infix, no pipes, no dotted-path sugar.
-- |
-- | The printer is *mechanical and lossless* for the desugared corpus: every
-- | construct that appears after `desugarSurfaceWith` has one canonical core
-- | spelling, and re-parsing the printed text with the default core parser
-- | yields the same skeleton AST (the round-trip oracle in the tests).
-- |
-- | Inheritance sigils (`Parent`/`BlockDef`) cannot appear in a desugared
-- | MaxBars template (MaxBars gates inheritance off and lowers `{{^}}` to
-- | `unless`), so `printRawBars` is total over them — it prints the section form
-- | — but the entrypoint (`Linter.Lower`) refuses such inputs with a clear
-- | `Left` rather than silently re-spelling them.
module Linter.Print
  ( printRawBars
  ) where

import Prelude

import BareBars.Syntax (Expr(..), Ident, Node(..), Sigil(..), Template)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Maybe (Maybe(..))
import Data.String (joinWith)
import Data.String as String

-- | Pretty-print a desugared core `Template` as RawBars source text.
printRawBars :: Template -> String
printRawBars nodes = joinWith "" (map printNode nodes)

printNode :: Node -> String
printNode = case _ of
  Content s -> s
  Output _ e -> "{{{ " <> exprTop e <> " }}}"
  Block _ sig name args body -> printBlock sig name args body
  Sep _ name args -> "{{" <> head name args <> "}}"
  RawBlock _ name args raw ->
    "{{{{" <> head name args <> "}}}}" <> raw <> "{{{{/" <> name <> "}}}}"

-- | A `{{#name …}}…{{/name}}` section. The desugared MaxBars corpus only ever
-- | carries `Section` sigils; `Inverse`/`Parent`/`BlockDef` are printed in the
-- | same section shape (total, but unreachable for the corpus — the entrypoint
-- | rejects inheritance before printing).
printBlock :: Sigil -> Ident -> Array Expr -> Template -> String
printBlock sig name args body = case sig of
  Section -> section
  Inverse -> section
  Parent -> section
  BlockDef -> section
  where
  section =
    "{{#" <> head name args <> "}}" <> printRawBars body <> "{{/" <> name <> "}}"

-- | A tag *head*: the helper name, plus space-separated arguments when present.
head :: Ident -> Array Expr -> String
head name args
  | Array.null args = name
  | otherwise = name <> " " <> joinWith " " (map exprArg args)

-- | An expression at the *top* of an `Output` (no surrounding parens needed for
-- | the head application).
exprTop :: Expr -> String
exprTop = case _ of
  Lit v -> litStr v
  App name [] -> name
  App name args -> name <> " " <> joinWith " " (map exprArg args)

-- | An expression in *argument* position: identical to `exprTop` except a
-- | non-nullary application is parenthesised so juxtaposition stays grouped.
exprArg :: Expr -> String
exprArg = case _ of
  Lit v -> litStr v
  App name [] -> name
  App name args -> "(" <> name <> " " <> joinWith " " (map exprArg args) <> ")"

-- | A literal value as core source. Only `VString`/`VNumber` arise from the
-- | desugared surface (string keys, numeric literals); the other shapes are
-- | printed defensively so the function is total.
litStr :: Value -> String
litStr = case _ of
  VString s -> "\"" <> escapeString s <> "\""
  VNumber n -> numberStr n
  VBool b -> if b then "true" else "false"
  VNull -> "null"
  VSafe s -> "\"" <> escapeString s <> "\""
  VArray _ -> "null"
  VObject _ -> "null"

-- | Escape a string literal for core source: backslash, double-quote, and the
-- | common control characters that would otherwise break the token.
escapeString :: String -> String
escapeString =
  String.replaceAll (String.Pattern "\\") (String.Replacement "\\\\")
    >>> String.replaceAll (String.Pattern "\"") (String.Replacement "\\\"")
    >>> String.replaceAll (String.Pattern "\n") (String.Replacement "\\n")
    >>> String.replaceAll (String.Pattern "\r") (String.Replacement "\\r")
    >>> String.replaceAll (String.Pattern "\t") (String.Replacement "\\t")

-- | Print a number with no trailing `.0` for integral values, so the output
-- | reads like hand-written source. Either spelling re-parses to the same
-- | `VNumber` (the lexer uses `Number.fromString`), so this is cosmetic.
numberStr :: Number -> String
numberStr n =
  let
    s = show n
  in
    case String.stripSuffix (String.Pattern ".0") s of
      Just intPart -> intPart
      Nothing -> s
