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
-- | This phase also wires Mustache *inheritance* and *dynamic-name* partials:
-- |
-- |  * `{{<p}} B {{/p}}` (Parent) ⇒ `Block Section "parent" [ "p" ] (desugar B)`
-- |  * `{{<*name}} B {{/*name}}` (dynamic parent) ⇒ the name resolves from
-- |    context, so the `parent` arg is `(mlookup "name")` instead of a literal.
-- |  * `{{$b}} D {{/b}}` (BlockDef) ⇒ `Block Section "block" [ "b" ] (desugar D)`
-- |  * `{{>* name}}` (dynamic partial) ⇒ `(partial (mlookup "name"))`.
-- |
-- | Out of scope for this phase: standalone-whitespace stripping, set-delimiters.
module MinBars.Surface
  ( desugar
  ) where

import Prelude

import BareBars.Syntax (Expr(..), Node(..), Sigil(..), Template)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Maybe (Maybe(..), maybe)
import Data.String (Pattern(..), stripPrefix)

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
      ">" -> Output sp (partialExpr (partialName args))
      _ -> Output sp (escape (mlookup name))
    -- `{{#x}}` (Section) ⇒ the `section` helper; `{{^x}}` (Inverse) ⇒ `inverted`.
    -- The head name becomes the resolved subject `(mlookup "x")`; the body
    -- recurses. (Block args are unused in the Mustache surface.)
    Block sp Section name _ body ->
      Block sp Section "section" [ mlookup name ] (desugar body)
    Block sp Inverse name _ body ->
      Block sp Section "inverted" [ mlookup name ] (desugar body)
    -- `{{<p}}` (Parent) ⇒ the `parent` helper over the (possibly dynamic) name.
    -- A static name is a `Lit (VString "p")`; a `*`-headed name resolves from
    -- the context stack via `(mlookup "name")`. The body keeps its `{{$…}}`
    -- children (they desugar to `block` apps `parent` harvests).
    Block sp Parent name _ body ->
      Block sp Section "parent" [ parentName name ] (desugar body)
    -- `{{$b}}` (BlockDef) ⇒ the `block` helper over the literal block name; the
    -- captured body is the default rendering.
    Block sp BlockDef name _ body ->
      Block sp Section "block" [ Lit (VString name) ] (desugar body)
    -- raw blocks are not part of the Mustache surface; carry them verbatim.
    RawBlock sp name args raw -> RawBlock sp name args raw

-- | The (possibly dotted) name an `Output` expression denotes. `{{{x}}}` parses
-- | its interior with the prefix grammar, so a bare path is `App "x" []`.
exprName :: Expr -> String
exprName = case _ of
  App name _ -> name
  Lit (VString s) -> s
  Lit _ -> "."

-- | The argument names of a `{{> p}}` / `{{>* name}}` separator.
-- |
-- |  * `{{> p}}` ⇒ `[App "p" []]` ⇒ a static `Static "p"`.
-- |  * `{{>*name}}` ⇒ `[App "*name" []]` (the `*` is an ident char, so it lexes
-- |    glued to the name) ⇒ a `Dynamic "name"`.
-- |  * `{{>* name}}` ⇒ `[App "*" [], App "name" []]` (the space splits them) ⇒
-- |    a `Dynamic "name"`.
-- |
-- | A `*`-marked name is *dynamic*: it is resolved from the context stack.
data PartialName = Static String | Dynamic String

partialName :: Array Expr -> PartialName
partialName args = case argName <$> Array.head args of
  Just n -> case stripPrefix (Pattern "*") n of
    -- `{{>* name}}` — a lone `*` head; the name is the second argument.
    Just "" -> Dynamic (maybe "" argName (Array.index args 1))
    -- `{{>*name}}` — `*` glued to the name.
    Just rest -> Dynamic rest
    -- `{{> p}}` — a static literal name.
    Nothing -> Static n
  Nothing -> Static ""

-- | The bare name an argument expression denotes (`App n []` or a string lit).
argName :: Expr -> String
argName = case _ of
  App n _ -> n
  Lit (VString s) -> s
  _ -> ""

-- | A parent template name (`{{<p}}` / `{{<*name}}`): a `*`-headed name is
-- | dynamic (`(mlookup "name")`), else a static `VString` literal. The `*` lexes
-- | glued to the name (it is an ident char), so `{{<*name}}` arrives as the
-- | single head identifier `*name`.
parentName :: String -> Expr
parentName name = case stripPrefix (Pattern "*") name of
  Just rest -> mlookup rest
  Nothing -> Lit (VString name)

-- | `(mlookup "name")`.
mlookup :: String -> Expr
mlookup name = App "mlookup" [ Lit (VString name) ]

-- | `(escape e)`.
escape :: Expr -> Expr
escape e = App "escape" [ e ]

-- | `(partial e)` over a static literal name or a dynamic `(mlookup …)`.
partialExpr :: PartialName -> Expr
partialExpr = case _ of
  Static name -> App "partial" [ Lit (VString name) ]
  Dynamic name -> App "partial" [ mlookup name ]
