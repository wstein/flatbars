-- | **Trussbars v1 codegen** — the MaxBars→Rust emitter (`trussbars/docs/`).
-- |
-- | This is the v1 "trussbars-codegen": it reuses the proven MaxBars front-end
-- | (`parseWith maxOptions` → `desugarSurfaceWith maxLoopVars`) and walks the core
-- | skeleton AST, emitting *typed* straight-line Rust that links against the
-- | `trussbars-core` / `trussbars-std` crates — no interpreter, no `Value`, no
-- | runtime dispatch. The key translation: a desugared path `lookup (this) "k1"
-- | "k2"` becomes a typed field access `ctx.k1.k2`; operators become native Rust
-- | or `trussbars_std` calls; `{{#each}}`/`{{#if}}`/`{{#with}}` become native
-- | `for`/`if`.
-- |
-- | The existing JS emit driver (`FlatBars.Compile`) bakes in JS scaffolding, so
-- | this is a parallel Rust driver rather than an `Emit` record.
-- |
-- | **Scope (vertical slice).** Implemented: content, escaped/raw output, paths,
-- | `this`/`root`/`loop`, block params, the `parent` / `loop.parent` / `loop.root`
-- | chains, `if`/`unless`/`elif`/`else`, `each` (+ loop metadata, block params,
-- | empty clause), `with`, the comparison / logic / arithmetic operators, the
-- | `ternary` (`? :`), the coalescers `??` (over `Option<T>`) and `?:` (over a
-- | unifying `T`), and the full value-helper pack — string (incl. integer-argument
-- | `slice`/`truncate`), number (`abs`/`round`/`toFixed`/…), and array
-- | (`join`/`count`/`at`/`take`/…). Anything else (partials, inline, yield, raw
-- | blocks, `outer` labelled-loop chains, the key-path `pluck`/`sortBy`/`groupBy`,
-- | `dict`) returns a `Left` "unsupported …" so the conformance harness excludes it
-- | honestly.
-- | All generated locals are `__`-prefixed (so an unused one never warns), and
-- | every runtime reference is fully path-qualified (so there are no `use`
-- | statements and thus no unused-import warnings) — the output passes
-- | `clippy -D warnings`.
module MaxBars.Rust
  ( compileMaxRust
  ) where

import Prelude

import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Foldable (foldMap)
import Data.Int as Int
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), maybe)
import Data.String (joinWith)
import Data.String.CodeUnits as SCU
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Parser (parseWith)
import FlatBars.Syntax (Expr(..), Ident, Node(..), Template, splitBlockArgs)
import FlatBars.Value (Value(..))
import FullBars (desugarSurfaceWith)
import Kernel.Walk (splitClauses)
import MaxBars (maxLoopVars, maxOptions)

-- | The emit context threaded through the walk: the Rust binding holding the
-- | current context (`this`), the current loop binding (if inside an `each`),
-- | the in-scope block-param names → their Rust bindings, and the nesting depth
-- | (to mint fresh, non-colliding locals).
type Env =
  { scope :: String
  , loop :: Maybe String
  , params :: Map String String
  , parents :: Array String -- enclosing context bindings, innermost first (`parent` chain)
  , depth :: Int
  }

-- | Compile MaxBars surface `src` to a Rust `pub fn render(ctx: &<ctxType>) ->
-- | String`. Returns a plain record (a JS object across the FFI): `ok` with the
-- | Rust source in `out`, or `!ok` with the reason in `err` (a parse error, or an
-- | unsupported construct outside the slice).
compileMaxRust :: String -> String -> { ok :: Boolean, out :: String, err :: String }
compileMaxRust ctxType src = case build of
  Right rust -> { ok: true, out: rust, err: "" }
  Left e -> { ok: false, out: "", err: e }
  where
  build :: Either String String
  build = do
    parsed <- lmap (show <<< NEA.head) (parseWith maxOptions src)
    let desugared = desugarSurfaceWith maxLoopVars parsed.nodes
    body <- nodes initialEnv desugared
    pure (renderFn ctxType body)

  initialEnv :: Env
  initialEnv = { scope: "ctx", loop: Nothing, params: Map.empty, parents: [], depth: 0 }

renderFn :: String -> String -> String
renderFn ctxType body =
  "pub fn render(ctx: &" <> ctxType <> ") -> String {\n"
    <> "    let __root = ctx;\n"
    <> "    let mut out = String::new();\n"
    <> body
    <> "    out\n}\n"

--------------------------------------------------------------------------------
-- Nodes (statements)
--------------------------------------------------------------------------------

nodes :: Env -> Template -> Either String String
nodes env ts = foldMap identity <$> traverse (node env) ts

node :: Env -> Node -> Either String String
node env = case _ of
  Content s -> Right ("    out.push_str(" <> rustStr s <> ");\n")
  -- `{{ x }}` desugars to `escapeHtml (…)`: escape and append.
  Output _ (App "escapeHtml" [ a ]) -> do
    ae <- expr env a
    Right ("    trussbars_core::esc(&(" <> ae <> "), &mut out);\n")
  -- `{{{ x }}}` (raw): append the text form unescaped.
  Output _ e -> do
    ee <- expr env e
    Right ("    trussbars_core::ToText::write_text(&(" <> ee <> "), &mut out);\n")
  Block _ _ name args body -> block env name args body
  Sep _ name _ -> Left ("unsupported: standalone separator '" <> name <> "'")
  RawBlock _ name _ _ -> Left ("unsupported: raw block '" <> name <> "'")
  NodeError _ msg -> Left ("parse error: " <> msg)

block :: Env -> Ident -> Array Expr -> Template -> Either String String
block env name args body =
  let
    split = splitBlockArgs args
  in
    case name of
      "if" -> condBlock env "if " split.positional body
      "unless" -> condBlock env "if !" split.positional body
      -- `split.positional` demarks `@param` block-param names to trailing string
      -- literals (which `bindingNames` reads); the subject is its head.
      "each" -> eachBlock env split.positional body
      "with" -> withBlock env split.positional body
      _ -> Left ("unsupported: block helper '" <> name <> "'")

-- `{{#if}}` / `{{#unless}}`: a native `if`/`else if`/`else` over the same buffer.
-- `prefix` is `"if "` or `"if !"`.
condBlock :: Env -> String -> Array Expr -> Template -> Either String String
condBlock env prefix positional body = case positional of
  [ c ] -> do
    ce <- expr env c
    let s = splitClauses body
    before <- nodes env s.before
    elsePart <- elseChain env s.clauses
    Right
      ( "    " <> prefix <> "trussbars_core::truthy(&(" <> ce <> ")) {\n"
          <> before
          <> "    }"
          <> elsePart
          <> "\n"
      )
  _ -> Left "unsupported: conditional with an options argument (e.g. includeZero)"

elseChain :: Env -> Array { name :: Ident, args :: Array Expr, body :: Template } -> Either String String
elseChain env clauses = case Array.uncons clauses of
  Nothing -> Right ""
  Just { head: cl, tail } -> case cl.name of
    "elif" -> case cl.args of
      [ c ] -> do
        ce <- expr env c
        b <- nodes env cl.body
        rest <- elseChain env tail
        Right (" else if trussbars_core::truthy(&(" <> ce <> ")) {\n" <> b <> "    }" <> rest)
      _ -> Left "unsupported: elif with an options argument"
    _ -> do
      b <- nodes env cl.body
      Right (" else {\n" <> b <> "    }")

-- `{{#each subject as |item idx|}}` → a native `for` over `subject.iter()
-- .enumerate()`, binding the loop metadata (`Loop::at`) and the block params, with
-- the empty collection rendering the `{{else}}` clause in the parent scope.
eachBlock :: Env -> Array Expr -> Template -> Either String String
eachBlock env args body = case Array.head args of
  Nothing -> Left "unsupported: each without a subject"
  Just subjE -> do
    subj <- expr env subjE
    let
      paramNames = bindingNames (Array.drop 1 args)
      d = env.depth + 1
      ds = show d
      cVar = "__c" <> ds
      lVar = "__l" <> ds
      iVar = "__i" <> ds
      subVar = "__sub" <> ds
      lenVar = "__len" <> ds
      params' = bindEachParams paramNames cVar iVar env.params
      childEnv =
        { scope: cVar
        , loop: Just lVar
        , params: params'
        , parents: Array.cons env.scope env.parents
        , depth: d
        }
      parentLoop = maybe "None" (\pl -> "Some(&" <> pl <> ")") env.loop
      s = splitClauses body
    bodyS <- nodes childEnv s.before
    elseS <- clauseBody env s.clauses
    Right
      ( "    {\n"
          <> "    let " <> subVar <> " = &(" <> subj <> ");\n"
          <> "    let " <> lenVar <> " = " <> subVar <> ".len();\n"
          <> "    if " <> lenVar <> " == 0 {\n"
          <> elseS
          <> "    } else {\n"
          <> "    for (" <> iVar <> ", " <> cVar <> ") in " <> subVar <> ".iter().enumerate() {\n"
          <> "    let " <> lVar <> " = trussbars_core::Loop::at(" <> iVar <> ", " <> lenVar
          <> ", None, " <> parentLoop <> ");\n"
          <> bodyS
          <> "    }}\n"
          <> "    }\n"
      )

-- `{{#with subject as |u|}}` → bind the subject and, when truthy, render the body
-- in its scope; otherwise render the `{{else}}` clause.
withBlock :: Env -> Array Expr -> Template -> Either String String
withBlock env args body = case Array.head args of
  Nothing -> Left "unsupported: with without a subject"
  Just subjE -> do
    subj <- expr env subjE
    let
      paramNames = bindingNames (Array.drop 1 args)
      d = env.depth + 1
      cVar = "__c" <> show d
      params' = maybe env.params (\n -> Map.insert n cVar env.params) (Array.index paramNames 0)
      childEnv =
        { scope: cVar
        , loop: env.loop
        , params: params'
        , parents: Array.cons env.scope env.parents
        , depth: d
        }
      s = splitClauses body
    bodyS <- nodes childEnv s.before
    elseS <- clauseBody env s.clauses
    Right
      ( "    {\n"
          <> "    let " <> cVar <> " = &(" <> subj <> ");\n"
          <> "    if trussbars_core::truthy(" <> cVar <> ") {\n"
          <> bodyS
          <> "    } else {\n"
          <> elseS
          <> "    }\n    }\n"
      )

-- The first clause's body (the `{{else}}` of an each/with), in the parent scope;
-- empty when there is none.
clauseBody :: Env -> Array { name :: Ident, args :: Array Expr, body :: Template } -> Either String String
clauseBody env clauses = case Array.head clauses of
  Just cl -> nodes env cl.body
  Nothing -> Right ""

-- The trailing string-literal arguments — the `as |…|` block-param binding names.
bindingNames :: Array Expr -> Array String
bindingNames = Array.mapMaybe case _ of
  Lit (VString s) -> Just s
  _ -> Nothing

-- `as |item idx|`: param 0 binds the element; param 1 binds the 0-based index.
bindEachParams :: Array String -> String -> String -> Map String String -> Map String String
bindEachParams names cVar iVar m =
  let
    m1 = maybe m (\n -> Map.insert n cVar m) (Array.index names 0)
  in
    maybe m1 (\n -> Map.insert n iVar m1) (Array.index names 1)

--------------------------------------------------------------------------------
-- Expressions
--------------------------------------------------------------------------------

expr :: Env -> Expr -> Either String String
expr env = case _ of
  Lit v -> lit v
  App "this" [] -> Right env.scope
  App "root" [] -> Right "__root"
  App "loop" [] -> case env.loop of
    Just l -> Right l
    Nothing -> Left "unsupported: 'loop' used outside an each"
  App "@parentchain" [] -> case Array.head env.parents of
    Just p -> Right p
    Nothing -> Left "unsupported: 'parent' used outside an enclosing block"
  App "true" [] -> Right "true"
  App "false" [] -> Right "false"
  App "null" [] -> Right "()"
  App "lookup" args -> path env args
  App "not" [ a ] -> do
    t <- truthyOf env a
    Right ("(!" <> t <> ")")
  App "and" args -> do
    ps <- traverse (truthyOf env) args
    Right ("(" <> joinWith " && " ps <> ")")
  App "or" args -> do
    ps <- traverse (truthyOf env) args
    Right ("(" <> joinWith " || " ps <> ")")
  App "eq" [ a, b ] -> binOp env "==" a b
  App "ne" [ a, b ] -> binOp env "!=" a b
  App "lt" [ a, b ] -> binOp env "<" a b
  App "gt" [ a, b ] -> binOp env ">" a b
  App "lte" [ a, b ] -> binOp env "<=" a b
  App "gte" [ a, b ] -> binOp env ">=" a b
  App "add" [ a, b ] -> binOp env "+" a b
  App "subtract" [ a, b ] -> binOp env "-" a b
  App "multiply" [ a, b ] -> binOp env "*" a b
  App "divide" [ a, b ] -> binOp env "/" a b
  App "modulo" [ a, b ] -> do
    ae <- expr env a
    be <- expr env b
    Right ("trussbars_std::modulo(" <> ae <> ", " <> be <> ")")
  App "safe" [ a ] -> do
    ae <- expr env a
    Right ("trussbars_std::safe(&(" <> ae <> "))")
  -- `cond ? a : b` — a native `if`-expression; the two arms must unify (Rust checks).
  App "ternary" [ c, a, b ] -> do
    ce <- expr env c
    ae <- expr env a
    be <- expr env b
    Right ("(if trussbars_core::truthy(&(" <> ce <> ")) { " <> ae <> " } else { " <> be <> " })")
  -- `a ?? b` (first non-null): the left is `Option<T>`, the right its `T`.
  App "coalesce" [ a, b ] -> do
    ae <- expr env a
    be <- expr env b
    Right ("(" <> ae <> ").clone().unwrap_or_else(|| (" <> be <> ").clone())")
  -- `a ?: b` (first truthy): both arms unify to one `T: Truthy + Clone`.
  App "firstTruthy" [ a, b ] -> do
    ae <- expr env a
    be <- expr env b
    Right
      ( "{ let __t = (" <> ae <> ").clone(); if trussbars_core::truthy(&__t) { __t } else { ("
          <> be
          <> ").clone() } }"
      )
  App name args
    | Just r <- emitHelper env name args -> r
  App name [] -> case Map.lookup name env.params of
    Just v -> Right v
    Nothing -> Left ("unsupported: expression head '" <> name <> "'")
  App name _ -> Left ("unsupported: helper '" <> name <> "'")

lit :: Value -> Either String String
lit = case _ of
  VString s -> Right (rustStr s)
  VNumber n -> Right (show n) -- an f64 literal (e.g. "5.0"); numbers are typed f64
  VBool b -> Right (if b then "true" else "false")
  VNull -> Right "()"
  VSafe s -> Right ("trussbars_std::safe(&(" <> rustStr s <> "))")
  VArray _ -> Left "unsupported: array literal"
  VObject _ -> Left "unsupported: object literal"

truthyOf :: Env -> Expr -> Either String String
truthyOf env a = do
  ae <- expr env a
  Right ("trussbars_core::truthy(&(" <> ae <> "))")

binOp :: Env -> String -> Expr -> Expr -> Either String String
binOp env op a b = do
  ae <- expr env a
  be <- expr env b
  Right ("(" <> ae <> " " <> op <> " " <> be <> ")")

-- A desugared path `lookup subject "k1" "k2" …` → a typed field access
-- `<subject>.k1.k2`. A path rooted at `loop` threads the `parent`/`root` chain
-- (the `Option<&Loop>` machinery). A non-literal key is a data-derived name
-- (spec §4.3).
path :: Env -> Array Expr -> Either String String
path env args = case Array.uncons args of
  Nothing -> Left "unsupported: lookup without a subject"
  Just { head: App "loop" [], tail: keys } -> case env.loop of
    Nothing -> Left "unsupported: 'loop' used outside an each"
    Just lvar -> traverse keyStr keys >>= emitLoopChain lvar
  Just { head: subj, tail: keys }
    | Just k <- parentIndex subj -> case Array.index env.parents k of
        Just pvar -> do
          segs <- traverse seg keys
          Right (pvar <> foldMap identity segs)
        Nothing -> Left "unsupported: 'parent' beyond the enclosing context depth"
  Just { head: subj, tail: keys } -> do
    base <- expr env subj
    segs <- traverse seg keys
    Right (base <> foldMap identity segs)
  where
  keyStr = case _ of
    Lit (VString k) -> Right k
    _ -> Left "unsupported: computed loop key"
  seg = case _ of
    Lit (VString k) -> Right ("." <> k)
    _ -> Left "unsupported: computed lookup (a data-derived field name, spec §4.3)"

-- A `@parentchain` path with `k` leading `parent` hops → the `k`-th enclosing
-- context. The desugar nests the hops: `{{parent.x}}` is `lookup @parentchain "x"`
-- (k = 0); `{{parent.parent.x}}` is `lookup (lookup @parentchain "parent") "x"`
-- (k = 1). The remaining keys are field accesses on that context binding.
parentIndex :: Expr -> Maybe Int
parentIndex = case _ of
  App "@parentchain" [] -> Just 0
  App "lookup" [ inner, Lit (VString "parent") ] -> (\i -> i + 1) <$> parentIndex inner
  _ -> Nothing

-- The direct (non-chained) `Loop` metadata fields.
loopFields :: Array String
loopFields = [ "index0", "index1", "rindex0", "rindex1", "first", "last", "length", "key" ]

-- A `loop` path: zero or more `parent`/`root` hops then a terminal metadata field.
-- `parent` introduces an `Option<&Loop>` (it is `None` at the outermost loop), so
-- the chain threads it (`map`/`and_then`); the terminal field becomes `.map(|p|
-- p.field)` once optional — yielding `""` at the root, exactly as the interpreter
-- renders `loop.parent.index0` of an outermost loop.
emitLoopChain :: String -> Array String -> Either String String
emitLoopChain lvar keys = case Array.unsnoc keys of
  Nothing -> Left "unsupported: bare 'loop'"
  Just { init: hops, last: field }
    | not (Array.elem field loopFields) -> Left ("unsupported: loop field '" <> field <> "'")
    | otherwise -> do
        acc <- Array.foldM stepHop { code: lvar, opt: false } hops
        Right
          ( if acc.opt then acc.code <> ".map(|__p| __p." <> field <> ")"
            else acc.code <> "." <> field
          )
  where
  stepHop st = case _ of
    "root" -> Right
      ( if st.opt then st { code = st.code <> ".map(|__p| __p.root())" }
        else st { code = st.code <> ".root()" }
      )
    "parent" -> Right
      ( if st.opt then { code: st.code <> ".and_then(|__p| __p.parent)", opt: true }
        else { code: st.code <> ".parent", opt: true }
      )
    h -> Left ("unsupported: loop hop '" <> h <> "'")

-- Argument-passing conventions for a `trussbars_std` value helper.
data ArgKind
  = Ref -- `&(expr)`: a text subject/argument, or a slice/`Vec` (deref-coerced)
  | Num -- `(expr)`: an `f64` by value (the number pack)
  | IntArg -- an `i64` index/count (a literal → integer; otherwise `(expr as i64)`)

-- Emit a homogeneous value helper as a `trussbars_std::<fn>(…)` call. `Nothing`
-- means "not a known value helper" — the caller falls through. The string pack,
-- the integer-index helpers (slice/at/take/…), and the number pack are covered;
-- the key-path helpers (sort_by/pluck/group_by) and the Option-typed coalescers
-- (`??`/`?:`) are not (out of the slice).
emitHelper :: Env -> Ident -> Array Expr -> Maybe (Either String String)
emitHelper env name args = case name of
  "uppercase" -> call "uppercase" [ Ref ]
  "lowercase" -> call "lowercase" [ Ref ]
  "capitalize" -> call "capitalize" [ Ref ]
  "trim" -> call "trim" [ Ref ]
  "trimStart" -> call "trim_start" [ Ref ]
  "trimEnd" -> call "trim_end" [ Ref ]
  "append" -> call "append" [ Ref, Ref ]
  "prepend" -> call "prepend" [ Ref, Ref ]
  "replace" -> call "replace" [ Ref, Ref, Ref ]
  "split" -> call "split" [ Ref, Ref ]
  "includes" -> call "includes" [ Ref, Ref ]
  "startsWith" -> call "starts_with" [ Ref, Ref ]
  "endsWith" -> call "ends_with" [ Ref, Ref ]
  "reverse" -> call "reverse" [ Ref ]
  "slice"
    | arity == 3 -> call "slice_range" [ Ref, IntArg, IntArg ]
    | otherwise -> call "slice" [ Ref, IntArg ]
  "truncate"
    | arity == 3 -> call "truncate_with" [ Ref, IntArg, Ref ]
    | otherwise -> call "truncate" [ Ref, IntArg ]
  "abs" -> call "abs" [ Num ]
  "floor" -> call "floor" [ Num ]
  "ceil" -> call "ceil" [ Num ]
  "round" -> call "round" [ Num ]
  "toFixed" -> call "to_fixed" [ Num, IntArg ]
  "toInt" -> call "to_int" [ Ref ]
  "toFloat" -> call "to_float" [ Ref ]
  "join" -> call "join" [ Ref, Ref ]
  "count" -> call "count" [ Ref ]
  "size" -> call "count" [ Ref ]
  "at" -> call "at" [ Ref, IntArg ]
  "take" -> call "take" [ Ref, IntArg ]
  "takeRight" -> call "take_right" [ Ref, IntArg ]
  "unique" -> call "unique" [ Ref ]
  _ -> Nothing
  where
  arity = Array.length args
  call fn kinds
    | Array.length kinds == arity = Just do
        parts <- traverse (\(Tuple k e) -> emitKind env k e) (Array.zip kinds args)
        Right ("trussbars_std::" <> fn <> "(" <> joinWith ", " parts <> ")")
    | otherwise = Just
        (Left ("unsupported: " <> name <> " with " <> show arity <> " arguments"))

emitKind :: Env -> ArgKind -> Expr -> Either String String
emitKind env kind e = case kind of
  Ref -> do
    ee <- expr env e
    Right ("&(" <> ee <> ")")
  Num -> expr env e
  IntArg -> case e of
    Lit (VNumber n) -> Right (show (Int.round n))
    _ -> do
      ee <- expr env e
      Right ("(" <> ee <> " as i64)")

-- A Rust double-quoted string literal with the dangerous characters escaped.
rustStr :: String -> String
rustStr s = "\"" <> foldMap esc (SCU.toCharArray s) <> "\""
  where
  esc c = case c of
    '"' -> "\\\""
    '\\' -> "\\\\"
    '\n' -> "\\n"
    '\r' -> "\\r"
    '\t' -> "\\t"
    _ -> SCU.singleton c
