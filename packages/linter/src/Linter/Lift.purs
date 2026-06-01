-- | **Linter.Lift** — the *lift* job (loopvars-linter-spec.md §B.3, phase X3):
-- | a **heuristic re-sugar from RawBars (core) source up to MaxBars source**.
-- | This is the inverse of `Linter.Lower` (X0), which runs the MaxBars front-end
-- | *forward* to the meaning-free core `Template`; lift runs it *backward* — it
-- | parses the input as RawBars (core syntax, no desugar), then re-sugars the
-- | core AST into the richer MaxBars surface (infix operators, pipes,
-- | dotted-path sugar, escaped/raw output).
-- |
-- | Lift is **assist-only, never an automated commit** (§B.3): the core→surface
-- | mapping is not injective, so several constructs are re-sugared on a *guess*
-- | and a `LiftFlag` is emitted for human confirmation:
-- |
-- |  * `(lookup this "x")` lifts to the bare path `x` — but the author may have
-- |    written `this.x` deliberately to dodge a shadowing helper. We emit `x`
-- |    (the common case) and flag it (`lookup-path`).
-- |  * `(f a)` lifts to the pipe `a | f` only when `f` is a *recognised unary
-- |    filter* (see `unaryFilters`); an unrecognised arity-1 helper has no
-- |    canonical pipe form and is left as a call (`unrecognised-filter`).
-- |  * a multi-argument call `(f a b …)` has no obvious pipe subject and is left
-- |    as a call (`multi-arg-call`).
-- |
-- | Everything else round-trips faithfully: the operator table (B.7) inverts
-- | exactly, `Output (App "esc_html" [e])` becomes escaped `{{ e }}` and any other
-- | `Output e` becomes raw `{{{ e }}}`, and blocks/separators re-emit as
-- | `{{#name …}}…{{/name}}` / `{{name …}}`. The re-sugar is render-preserving —
-- | the acceptance oracle asserts `RawBars.render input == renderMax (lift input)`
-- | — and flags are purely advisory (they do not change the emitted source).
-- |
-- | ### Parenthesisation policy
-- | An operand of an infix/prefix operator that is *itself* an infix expression
-- | is parenthesised, so the original grouping survives the round-trip — e.g.
-- | `(and a (gt b 21))` lifts to `a && (b > 21)` (the inner `gt` is wrapped).
-- | Bare atoms (a lifted path, a literal, a call, a pipe) take no parens. A pipe
-- | operand of an operator is also parenthesised (pipe binds loosest). This is
-- | conservative — it never *under*-parenthesises — which is what keeps the
-- | render oracle green without modelling MaxBars's full precedence ladder.
module Linter.Lift
  ( liftToMaxBars
  , LiftResult
  , LiftFlag
  , unaryFilters
  ) where

import Prelude

import BareBars.Error (ParseError)
import BareBars.Parser (defaultParseOptions, parseWith)
import BareBars.Span (Span)
import BareBars.Syntax (Expr(..), Ident, Node(..), Sigil, Template)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Either (Either)
import Data.Maybe (Maybe(..))
import Data.String (joinWith)
import Data.String as String
import Data.Tuple (Tuple(..), fst, snd)

-- | One advisory ambiguity flag raised during a lift. `kind` is a stable tag
-- | (`"lookup-path"`, `"unrecognised-filter"`, `"multi-arg-call"`); `span` locates
-- | the enclosing tag in the *original* RawBars source (the core AST carries spans
-- | on nodes, not on sub-expressions, so a flag points at its tag); `message`
-- | explains the ambiguity and the human review it wants. Flags never change the
-- | emitted `source` — lift is assist-only.
type LiftFlag =
  { kind :: String
  , span :: Span
  , message :: String
  }

-- | The lift result: the re-sugared MaxBars `source` and the per-file list of
-- | advisory `flags`.
type LiftResult =
  { source :: String
  , flags :: Array LiftFlag
  }

-- | The recognised **unary "filter-shaped" helpers** — the only arity-1 calls
-- | that have a canonical pipe form `a | f` (§B.3). Derived from
-- | `Kernel.Prelude.helperDefs`: the *value* helpers (non-block) whose arity
-- | admits a single argument and whose shape is a value→value transform, with the
-- | helpers that own a dedicated *operator* surface excluded (so they re-sugar via
-- | the operator table, never a pipe):
-- |
-- |  * `esc_html`, `safe` — `unary` value helpers.
-- |  * `json`, `esc_json` — `Between 1 2`; the 1-arg form is a transform.
-- |
-- | Excluded by design: `not` (arity 1, but its surface is the prefix `!`);
-- | `eq`/`ne`/`lt`/`gt`/`lte`/`gte` (binary operators); `and`/`or` (operators);
-- | `lookup`/`this`/`dict`/`log`/`apply`/`partial` (not value transforms, or
-- | variable-arity with no subject); the nullary literals `true`/`false`/`null`.
-- | `upper` etc. are NOT in the reference prelude, so they are *not* recognised —
-- | a `(upper a)` lifts to a flagged call, not a pipe (the conservative default).
unaryFilters :: Array String
unaryFilters = [ "esc_html", "safe", "json", "esc_json" ]

-- | The infix operator table, helper → infix symbol, for the binary operators
-- | MaxBars re-sugars to. `not` (prefix `!`) is handled separately. Arithmetic
-- | and `coalesce` (`??`) lift exactly like the comparison/boolean operators;
-- | conservative parenthesisation (any infix operand is wrapped) keeps the
-- | re-sugar render-equivalent without modelling the full precedence ladder.
binaryOps :: Array (Tuple String String)
binaryOps =
  [ Tuple "and" "&&"
  , Tuple "or" "||"
  , Tuple "eq" "=="
  , Tuple "ne" "!="
  , Tuple "lt" "<"
  , Tuple "gt" ">"
  , Tuple "lte" "<="
  , Tuple "gte" ">="
  , Tuple "add" "+"
  , Tuple "subtract" "-"
  , Tuple "multiply" "*"
  , Tuple "divide" "/"
  , Tuple "modulo" "%"
  , Tuple "coalesce" "??"
  -- handlebars-helpers aliases normalise to the canonical operator on lift.
  , Tuple "plus" "+"
  , Tuple "minus" "-"
  , Tuple "times" "*"
  ]

-- | Lift RawBars (core) source up to MaxBars source, collecting advisory flags.
-- | A parse failure is propagated. The input is parsed with the *default core*
-- | options (RawBars is core syntax, no surface desugar), then each node is
-- | re-sugared by the MaxBars-surface printer below.
liftToMaxBars :: String -> Either ParseError LiftResult
liftToMaxBars src = do
  { nodes } <- parseWith (defaultParseOptions { extras = false }) src
  pure (printTemplate nodes)

--------------------------------------------------------------------------------
-- The MaxBars-surface printer (a `Writer`-style fold collecting flags)
--------------------------------------------------------------------------------

-- | A printed fragment paired with the flags raised while producing it.
type Out = { text :: String, flags :: Array LiftFlag }

emptyOut :: Out
emptyOut = { text: "", flags: [] }

-- | Concatenate printed fragments, accumulating their flags.
concatOut :: Array Out -> Out
concatOut outs =
  { text: joinWith "" (map _.text outs)
  , flags: Array.concat (map _.flags outs)
  }

printTemplate :: Template -> LiftResult
printTemplate nodes =
  let
    out = concatOut (map printNode nodes)
  in
    { source: out.text, flags: out.flags }

printNode :: Node -> Out
printNode = case _ of
  Content s -> emptyOut { text = s }

  -- `Output _ (App "esc_html" [e])` is FullBars's auto-escaped `{{ e }}`; any
  -- other `Output _ e` is the raw `{{{ e }}}`.
  Output span e -> case e of
    App "esc_html" [ inner ] ->
      let
        ex = exprTop span inner
      in
        ex { text = "{{ " <> ex.text <> " }}" }
    _ ->
      let
        ex = exprTop span e
      in
        ex { text = "{{{ " <> ex.text <> " }}}" }

  Block span sig name args body -> printBlock span sig name args body

  -- A separator (`{{else}}`, `{{elif c}}`, …) — re-emit as a bare `{{name …}}`.
  Sep span name args ->
    let
      h = headOut span name args
    in
      h { text = "{{" <> h.text <> "}}" }

  -- A raw block (`{{{{name}}}}…{{{{/name}}}}`) — re-emit verbatim; its body is
  -- literal text, not re-sugared.
  RawBlock span name args raw ->
    let
      h = headOut span name args
    in
      h { text = "{{{{" <> h.text <> "}}}}" <> raw <> "{{{{/" <> name <> "}}}}" }

-- | A `{{#name …}}body{{/name}}` section (every desugared sigil prints in the
-- | section shape; `Inverse`/`Parent`/`BlockDef` are unreachable for RawBars
-- | input under `extras = false`, but printed totally).
printBlock :: Span -> Sigil -> Ident -> Array Expr -> Template -> Out
printBlock span _ name args body =
  let
    h = headOut span name args
    inner = printTemplate body
  in
    { text: "{{#" <> h.text <> "}}" <> inner.source <> "{{/" <> name <> "}}"
    , flags: h.flags <> inner.flags
    }

-- | A tag *head*: the helper name plus space-separated argument re-sugars.
headOut :: Span -> Ident -> Array Expr -> Out
headOut span name args
  | Array.null args = emptyOut { text = name }
  | otherwise =
      let
        as = map (exprArg span) args
      in
        (concatOut as) { text = name <> " " <> joinWith " " (map _.text as) }

--------------------------------------------------------------------------------
-- Expression re-sugar
--------------------------------------------------------------------------------

-- | An expression at the *top* of an output/argument (no surrounding parens for
-- | the head application; an infix top-level reads fine unparenthesised).
exprTop :: Span -> Expr -> Out
exprTop span = exprWith span false

-- | An expression in *argument* position. Identical to `exprTop` except a bare
-- | (nullary path / call) head re-sugar that is a non-nullary *call* application
-- | must be parenthesised so juxtaposition stays grouped — handled inside
-- | `exprWith` via the `arg` flag.
exprArg :: Span -> Expr -> Out
exprArg span = exprWith span true

-- | Re-sugar an expression. `arg` is true when the expression sits in argument
-- | position (a fallback call must then be parenthesised). The result text is the
-- | MaxBars surface spelling; flags accumulate ambiguities.
exprWith :: Span -> Boolean -> Expr -> Out
exprWith span arg expr = case expr of
  Lit v -> emptyOut { text = litStr v }

  -- `(lookup this "x")` ⇒ the bare path `x` (flagged: could be `this.x`).
  App "lookup" [ App "this" [], Lit (VString path) ] ->
    { text: path
    , flags:
        [ { kind: "lookup-path"
          , span
          , message:
              "emitted `" <> path <> "` for `(lookup this \"" <> path <> "\")`; if "
                <> "the author wrote `this."
                <> path
                <> "` to force a data path past a shadowing "
                <> "helper, this should be `this."
                <> path
                <> "` instead — confirm."
          }
        ]
    }

  -- prefix `not` ⇒ `!operand` (operand parenthesised if itself infix).
  App "not" [ a ] ->
    let
      o = operand span a
    in
      o { text = "!" <> o.text }

  App name args -> case lookupBinop name, args of
    -- a binary operator with exactly two operands ⇒ `a OP b`.
    Just sym, [ a, b ] ->
      let
        oa = operand span a
        ob = operand span b
        s = oa.text <> " " <> sym <> " " <> ob.text
      in
        { text: if arg then "(" <> s <> ")" else s
        , flags: oa.flags <> ob.flags
        }
    _, _ -> reSugarCall span arg name args

-- | Re-sugar a plain helper application that is not an operator: a path, a nullary
-- | call, a unary-filter pipe, or a flagged call.
reSugarCall :: Span -> Boolean -> Ident -> Array Expr -> Out
reSugarCall span arg name args = case args of
  -- a nullary application: a bare name (loop var / scoped helper / nullary call).
  [] -> emptyOut { text = name }

  -- a single-argument call. A recognised unary filter ⇒ the pipe `a | f`; an
  -- unrecognised one is left as a call and flagged.
  [ a ]
    | Array.elem name unaryFilters ->
        let
          o = operand span a
          s = o.text <> " | " <> name
        in
          { text: if arg then "(" <> s <> ")" else s
          , flags: o.flags
          }
    | otherwise ->
        let
          call = callOut span name args
        in
          call
            { flags = call.flags <>
                [ { kind: "unrecognised-filter"
                  , span
                  , message:
                      "`(" <> name <> " …)` is a single-argument call, but `" <> name
                        <> "` is not a recognised unary filter (one of "
                        <> joinWith ", " unaryFilters
                        <> "); no canonical pipe form, left as a call `("
                        <> name
                        <> " …)`."
                  }
                ]
            }

  -- a multi-argument call: no obvious pipe subject; left as a call and flagged.
  _ ->
    let
      call = callOut span name args
    in
      call
        { flags = call.flags <>
            [ { kind: "multi-arg-call"
              , span
              , message:
                  "`(" <> name <> " …)` is a multi-argument call with no obvious pipe "
                    <> "subject; no canonical pipe form, left as a call `("
                    <> name
                    <> " …)`."
              }
            ]
        }

-- | Print an application as an explicit call `(name arg arg …)`, parenthesising
-- | so it stays grouped wherever it sits.
callOut :: Span -> Ident -> Array Expr -> Out
callOut span name args =
  let
    as = map (exprArg span) args
  in
    (concatOut as) { text = "(" <> name <> " " <> joinWith " " (map _.text as) <> ")" }

-- | Re-sugar an *operand* of an operator. An operand that is itself an infix
-- | expression (a binary operator or a prefix `!`) — or a pipe — is parenthesised
-- | so the original grouping survives; everything else (atoms, calls, paths) is
-- | left bare. The bare form is produced by `exprTop` (no argument-parens), then
-- | wrapped here only when the operand is infix/pipe.
operand :: Span -> Expr -> Out
operand span e =
  let
    o = exprTop span e
  in
    if needsParens e then o { text = "(" <> o.text <> ")" } else o

-- | Does an expression need parenthesising when it is an operand of an operator?
-- | True for an infix binary operator, a prefix `!`, or a unary-filter pipe —
-- | all of which would otherwise re-associate against the surrounding operator.
needsParens :: Expr -> Boolean
needsParens = case _ of
  App "not" [ _ ] -> true
  App name [ _ ] | Array.elem name unaryFilters -> true
  App name [ _, _ ] -> isBinop name
  _ -> false

lookupBinop :: Ident -> Maybe String
lookupBinop name = snd <$> Array.find (\t -> fst t == name) binaryOps

isBinop :: Ident -> Boolean
isBinop name = Array.any (\t -> fst t == name) binaryOps

--------------------------------------------------------------------------------
-- Literals (mirrors Linter.Print's literal logic)
--------------------------------------------------------------------------------

-- | A literal value as MaxBars source. Only `VString`/`VNumber` arise from the
-- | parsed core surface; the others are printed defensively so the function is
-- | total.
litStr :: Value -> String
litStr = case _ of
  VString s -> "\"" <> escapeString s <> "\""
  VNumber n -> numberStr n
  VBool b -> if b then "true" else "false"
  VNull -> "null"
  VSafe s -> "\"" <> escapeString s <> "\""
  VArray _ -> "null"
  VObject _ -> "null"

escapeString :: String -> String
escapeString =
  String.replaceAll (String.Pattern "\\") (String.Replacement "\\\\")
    >>> String.replaceAll (String.Pattern "\"") (String.Replacement "\\\"")
    >>> String.replaceAll (String.Pattern "\n") (String.Replacement "\\n")
    >>> String.replaceAll (String.Pattern "\r") (String.Replacement "\\r")
    >>> String.replaceAll (String.Pattern "\t") (String.Replacement "\\t")

numberStr :: Number -> String
numberStr n =
  let
    s = show n
  in
    case String.stripSuffix (String.Pattern ".0") s of
      Just intPart -> intPart
      Nothing -> s
