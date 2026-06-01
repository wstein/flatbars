-- | The MinBars *surface dialect* — a structural `Template -> Template` rewrite
-- | from the Mustache surface into core applications over the MinBars prelude
-- | (`MinBars.Prelude`). Like `FullBars.Surface.desugar`, this is a pure rewrite
-- | of the one skeleton the parser already produces; the engine then runs the
-- | result unchanged.
-- |
-- | The mapping (spec §3); `(mlookup "x")` is `App "mlookup" [Lit (VString "x")]`:
-- |
-- |  * `{{x}}`   (a `Sep` — double-stash, escaped) ⇒ `(escape (mlookup "x"))`
-- |  * `{{{x}}}` / `{{&x}}` (an `Output` — triple/amp, raw) ⇒ `(mlookup "x")`
-- |  * `{{.}}`   ⇒ `(mlookup ".")` (the implicit iterator = stack top)
-- |  * `{{a.b.c}}` ⇒ `(mlookup "a.b.c")` (dotted name stays one ident)
-- |  * `{{#x}} B {{/x}}` ⇒ `Block Section "section" [(mlookup "x")] (desugar B)`
-- |  * `{{^x}} B {{/x}}` ⇒ `Block Section "inverted" [(mlookup "x")] (desugar B)`
-- |  * `{{> p}}` (a `Sep` whose head is `>`, arg `p`) ⇒ `(partial "p")`
-- |  * `{{! … }}` — already dropped by the parser (a comment).
-- |
-- | Out of scope for this phase: inheritance (`{{<p}}`/`{{$b}}`), dynamic names
-- | (`{{>* name}}`), standalone-whitespace stripping, set-delimiters.
module MinBars.Surface
  ( desugar
  ) where

import Prelude

import BareBars.Syntax (Expr(..), Node(..), Sigil(..), Template)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Maybe (Maybe(..))

-- | Desugar a MinBars surface template into core syntax.
desugar :: Template -> Template
desugar = map node
  where
  node = case _ of
    Content s -> Content s
    -- raw output: `{{{x}}}` / `{{&x}}` parse to `Output`; the head identifier is
    -- the (possibly dotted) name. ⇒ `(mlookup "name")`, unescaped.
    Output sp e -> Output sp (mlookup (exprName e))
    -- escaped output: `{{x}}` parses to a `Sep`. A partial `{{> p}}` arrives as a
    -- `Sep` whose head is `>` (via the parser's `partialHead` remap) with the
    -- name as its first argument. Anything else is an escaped interpolation.
    Sep sp name args -> case name of
      ">" -> Output sp (partial (firstName args))
      _ -> Output sp (escape (mlookup name))
    -- `{{#x}}` (Section) ⇒ the `section` helper; `{{^x}}` (Inverse) ⇒ `inverted`.
    -- The head name becomes the resolved subject `(mlookup "x")`; the body
    -- recurses. (Block args are unused in the Mustache surface.)
    Block sp Section name _ body ->
      Block sp Section "section" [ mlookup name ] (desugar body)
    Block sp Inverse name _ body ->
      Block sp Section "inverted" [ mlookup name ] (desugar body)
    -- raw blocks are not part of the Mustache surface; carry them verbatim.
    RawBlock sp name args raw -> RawBlock sp name args raw

-- | The (possibly dotted) name an `Output` expression denotes. `{{{x}}}` parses
-- | its interior with the prefix grammar, so a bare path is `App "x" []`.
exprName :: Expr -> String
exprName = case _ of
  App name _ -> name
  Lit (VString s) -> s
  Lit _ -> "."

-- | The partial name from a `{{> p}}` separator's arguments: the first argument
-- | is the bare name `App "p" []`.
firstName :: Array Expr -> String
firstName args = case Array.head args of
  Just (App n _) -> n
  Just (Lit (VString s)) -> s
  _ -> ""

-- | `(mlookup "name")`.
mlookup :: String -> Expr
mlookup name = App "mlookup" [ Lit (VString name) ]

-- | `(escape e)`.
escape :: Expr -> Expr
escape e = App "escape" [ e ]

-- | `(partial "name")`.
partial :: String -> Expr
partial name = App "partial" [ Lit (VString name) ]
