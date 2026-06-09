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

import Data.Array as Array
import Data.Maybe (Maybe(..), maybe)
import Data.String (Pattern(..), stripPrefix)
import FlatBars.Syntax (Expr(..), Node(..), Sigil(..), Template)
import FlatBars.Value (Value(..))

-- | Desugar a MinBars surface template into core syntax.
desugar :: Template -> Template
desugar = map node
  where
  node = case _ of
    Content sp s -> Content sp s
    -- a recovered parse error (ADR-023) passes through; desugar only runs on
    -- error-free trees (the fail-fast parse projection rejects the rest).
    NodeError sp msg -> NodeError sp msg
    -- raw output: `{{{x}}}` / `{{&x}}` parse to `Output`; the head identifier is
    -- the (possibly dotted) name. ⇒ `(mlookup "name")`, unescaped.
    Output sp e -> Output sp (mlookup (exprName e))
    -- escaped output: `{{x}}` parses to a `Sep`. A partial `{{> p}}` arrives as a
    -- `Sep` whose head is `>` (via the parser's `partialHead` remap) with the
    -- name as its first argument. Anything else is an escaped interpolation.
    Sep sp name args -> case name of
      ">" -> Output sp (partialExpr (partialName args) (partialIndent args))
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
    Block sp Parent name args body ->
      Block sp Section "parent" [ parentName name, Lit (VString (indentArg args)) ]
        (desugar body)
    -- `{{$b}}` (BlockDef) ⇒ the `block` helper over the literal block name; the
    -- captured body is the default rendering. A *standalone* block also carries
    -- its captured indent as a second arg (a `Lit (VString …)` injected by
    -- `MinBars.Standalone`), which signals the override is to be reindented; a
    -- non-standalone block emits only the name, so `block` never reindents it.
    Block sp BlockDef name args body ->
      Block sp Section "block" (Array.cons (Lit (VString name)) (indentArgs args))
        (desugar body)
    -- the Handlebars block sigils `{{#*…}}` (Decorator) / `{{#>…}}` (PartialBlock)
    -- are gated off for MinBars (`minOptions`), so the parser rejects them before
    -- here; carry any stray one verbatim to keep this desugar total.
    Block sp sig name args body -> Block sp sig name args (desugar body)
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
-- | A standalone partial also carries a trailing string-literal *indent*
-- | argument injected by `MinBars.Standalone`; `partialIndent` recovers it.
data PartialName = Static String | Dynamic String

-- | The leading-whitespace indent injected by the standalone pass as the *last*
-- | argument, when it is a string literal (`Lit (VString …)`). A non-standalone
-- | partial has no such argument ⇒ `""`. A lone `*` dynamic head consumes args 0
-- | and 1 for the name; the indent is then arg 2.
partialIndent :: Array Expr -> String
partialIndent args = case Array.last args of
  Just (Lit (VString ind)) -> ind
  _ -> ""

partialName :: Array Expr -> PartialName
partialName args0 = case argName <$> Array.head args of
  Just n -> case stripPrefix (Pattern "*") n of
    -- `{{>* name}}` — a lone `*` head; the name is the second argument.
    Just "" -> Dynamic (maybe "" argName (Array.index args 1))
    -- `{{>*name}}` — `*` glued to the name.
    Just rest -> Dynamic rest
    -- `{{> p}}` — a static literal name.
    Nothing -> Static n
  Nothing -> Static ""
  where
  -- drop the trailing injected indent literal (if any) before reading the name.
  args = case Array.last args0 of
    Just (Lit (VString _)) -> Array.dropEnd 1 args0
    _ -> args0

-- | The bare name an argument expression denotes (`App n []` or a string lit).
argName :: Expr -> String
argName = case _ of
  App n _ -> n
  Lit (VString s) -> s
  _ -> ""

-- | The standalone indent injected by `MinBars.Standalone` as a `Parent` open's
-- | trailing string-literal argument (`""` when the parent was not standalone).
indentArg :: Array Expr -> String
indentArg args = case Array.last args of
  Just (Lit (VString ind)) -> ind
  _ -> ""

-- | The standalone-indent argument(s) for a `BlockDef`: a single-element
-- | `[Lit (VString indent)]` when the block was standalone (an indent literal was
-- | injected), else `[]` — so the emitted `block` app signals standalone-ness by
-- | *arity*, and a non-standalone block is never reindented.
indentArgs :: Array Expr -> Array Expr
indentArgs args = case Array.last args of
  Just (Lit (VString ind)) -> [ Lit (VString ind) ]
  _ -> []

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

-- | `(partial e indent)` over a static literal name or a dynamic `(mlookup …)`,
-- | carrying the standalone indent as a trailing string-literal argument the
-- | `partial` helper re-applies to every line of the partial's output.
partialExpr :: PartialName -> String -> Expr
partialExpr pn indent = App "partial" [ nameExpr, Lit (VString indent) ]
  where
  nameExpr = case pn of
    Static name -> Lit (VString name)
    Dynamic name -> mlookup name
