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
-- | chains, `if`/`unless`/`elif`/`else`, `each` (over a sequence **or a map** — via
-- | the `Each` trait, with `loop.key` in sorted-key order — + loop metadata, block
-- | params, empty clause), `with`, the comparison / logic / arithmetic operators, the
-- | `ternary` (`? :`), the coalescers `??` (over `Option<T>`) and `?:` (over a
-- | unifying `T`), the full value-helper pack — string (incl. integer-argument
-- | `slice`/`truncate`), number (`abs`/`round`/`toFixed`/…), and array
-- | (`join`/`count`/`at`/`take`/…) — inline and block partials (`{{#inline}}` +
-- | `{{> name [ctx]}}`, and `{{#partial}}` + `{{yield}}` with the body pre-rendered
-- | in the caller frame), labelled loops (`label NAME` → `outer`), and the
-- | literal-key closures `pluck` / `sortBy` / `groupBy` (the last grouping into a
-- | map, iterated via the `Each` trait), and raw blocks (the built-in `raw` head,
-- | emitted verbatim). Anything else (`dict`/collection literals, a non-`raw`
-- | raw-block head — which needs a host helper) returns a `Left` "unsupported …"
-- | so the conformance harness excludes it honestly.
-- | All generated locals are `__`-prefixed (so an unused one never warns), and
-- | every runtime reference is fully path-qualified (so there are no `use`
-- | statements and thus no unused-import warnings) — the output passes
-- | `clippy -D warnings`.
-- |
-- | `compileMaxRustCommented` is a readability variant: it threads the original
-- | surface through and annotates each emitted statement with a
-- | `// <file>:<line>:<col>  {{…}}` comment — the tag sliced from the template by
-- | the node's span, the location computed from the span start. The comments are
-- | inert (output is byte-identical), and the fact that the spans survive
-- | `desugarSurfaceWith` and slice cleanly is feasibility evidence for the v2
-- | span-mapped diagnostics (`trussbars/docs/07-v2-spike.md`).
module MaxBars.Rust
  ( compileMaxRust
  , compileMaxRustCommented
  ) where

import Prelude

import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Foldable (foldMap, sum)
import Data.Int as Int
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), maybe)
import Data.String (Pattern(..), Replacement(..), joinWith, replaceAll, split, trim)
import Data.String.CodeUnits as SCU
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Parser (parseWith)
import FlatBars.Span (Span, spanText)
import FlatBars.Syntax (Expr(..), Ident, Node(..), Template, splitBlockArgs)
import FlatBars.Value (Value(..))
import FullBars (desugarSurfaceWith, hoistInline)
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
  , labels :: Map String String -- labelled-loop name → its `Loop` binding (`label NAME`)
  , partials :: Map String Template -- hoisted `{{#inline}}` definitions, inlined at the call site
  , expanding :: Array String -- partials currently being inlined (recursion guard)
  , yield :: Maybe String -- pre-rendered body of an enclosing block partial (for `{{yield}}`)
  , depth :: Int
  -- The original surface source + the template file name + a flag, for the optional
  -- `// file:line:col {{…}}` annotations (`compileMaxRustCommented`); node spans
  -- index into `source`, and `file` labels the breadcrumb (empty ⇒ line:col only).
  , source :: String
  , file :: String
  , commented :: Boolean
  }

-- | Compile MaxBars surface `src` to a Rust `pub fn render(ctx: &<ctxType>) ->
-- | String`. Returns a plain record (a JS object across the FFI): `ok` with the
-- | Rust source in `out`, or `!ok` with the reason in `err` (a parse error, or an
-- | unsupported construct outside the slice).
compileMaxRust :: String -> String -> { ok :: Boolean, out :: String, err :: String }
compileMaxRust = compileWith false ""

-- | Like `compileMaxRust`, but annotates each emitted statement with a
-- | `// <file>:<line>:<col>  {{…}}` comment locating its originating MaxBars source
-- | (the tag sliced by the node's span; the line:col computed from the span start)
-- | — a readability/teaching aid and the docs/07 source-trail breadcrumb. `file`
-- | labels the location (pass the template's name; "" ⇒ line:col only). The comments
-- | are inert: rendered output is byte-for-byte identical to `compileMaxRust`.
compileMaxRustCommented :: String -> String -> String -> { ok :: Boolean, out :: String, err :: String }
compileMaxRustCommented = compileWith true

compileWith :: Boolean -> String -> String -> String -> { ok :: Boolean, out :: String, err :: String }
compileWith commented file ctxType src = case build of
  Right rust -> { ok: true, out: rust, err: "" }
  Left e -> { ok: false, out: "", err: e }
  where
  build :: Either String String
  build = do
    parsed <- lmap (show <<< NEA.head) (parseWith maxOptions src)
    let
      h = hoistInline (desugarSurfaceWith maxLoopVars parsed.nodes)
      env0 = initialEnv h.partials
    body <- nodes env0 h.template
    pure (renderFn ctxType (estimateBytes h.template) body)

  initialEnv :: Map String Template -> Env
  initialEnv partials =
    { scope: "ctx"
    , loop: Nothing
    , params: Map.empty
    , parents: []
    , labels: Map.empty
    , partials
    , expanding: []
    , yield: Nothing
    , depth: 0
    , source: src
    , file
    , commented
    }

renderFn :: String -> Int -> String -> String
renderFn ctxType cap body =
  "pub fn render(ctx: &" <> ctxType <> ") -> String {\n"
    -- An adaptive per-template capacity hint (the trick Sailfish uses): the
    -- fn-local `static` learns the last render's byte length, so a warm template
    -- reallocates at most once. Seeded with the compile-time literal estimate.
    -- Semantically inert — it only sizes the buffer, never the output.
    <> "    static __CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new(" <> show cap <> ");\n"
    <> "    let __root = ctx;\n"
    <> "    let mut out = String::with_capacity(__CAP.suggest());\n"
    <> body
    <> "    __CAP.record(out.len());\n"
    <> "    out\n}\n"

-- A heuristic estimate of the output size that SEEDS the adaptive `SizeHint`
-- (above) for the first render: the static literal bytes, ~8 bytes per
-- interpolation, and a `{{#each}}` body scaled by an assumed iteration count.
-- After the first render the hint learns the true size, so this only matters
-- cold; it must stay a safe lower-ish bound, never affecting output.
estimateBytes :: Template -> Int
estimateBytes = sum <<< map est
  where
  est = case _ of
    Content s -> SCU.length s
    Output _ _ -> 8
    Block _ _ "each" _ body -> 8 * estimateBytes body
    Block _ _ _ _ body -> estimateBytes body
    _ -> 0

--------------------------------------------------------------------------------
-- Nodes (statements)
--------------------------------------------------------------------------------

nodes :: Env -> Template -> Either String String
nodes env ts = foldMap identity <$> traverse (node env) ts

-- A `// <file>:<line>:<col>  {{…}}` annotation for a node (commented builds only):
-- the location of the node's span (line:col from its start) and the opening tag
-- sliced from the source — enough to read the generated Rust back against the
-- template and jump to it. `file` is omitted when empty.
srcComment :: Env -> Span -> String
srcComment env sp
  | env.commented =
      let
        { line, col } = lineCol env.source sp.start
        loc = (if env.file == "" then "" else env.file <> ":") <> show line <> ":" <> show col
      in
        "    // " <> loc <> "  " <> openTag (spanText env.source sp) <> "\n"
  | otherwise = ""

-- The 1-based line/column of a code-unit offset into `src` (spans are code-unit
-- offsets, matching `spanText`). Splitting on `\n` (ASCII, so unit-aligned): the
-- piece count is the line; the last piece's length is the column prefix.
lineCol :: String -> Int -> { line :: Int, col :: Int }
lineCol src start =
  let
    pieces = split (Pattern "\n") (SCU.take start src)
  in
    { line: Array.length pieces, col: 1 + maybe 0 SCU.length (Array.last pieces) }

-- The opening tag of a (possibly whole-block) source slice: up to and including the
-- first `}}` run, collapsed to one line and capped to ~64 chars.
openTag :: String -> String
openTag raw =
  let
    oneLine = trim (replaceAll (Pattern "\n") (Replacement " ") raw)
    tag = case SCU.indexOf (Pattern "}}") oneLine of
      Just i ->
        let
          braces = SCU.length (SCU.takeWhile (_ == '}') (SCU.drop (i + 2) oneLine))
        in
          SCU.take (i + 2 + braces) oneLine
      Nothing -> oneLine
  in
    if SCU.length tag > 64 then SCU.take 61 tag <> "…" else tag

-- The `// {{…}}` source annotation for a node (commented builds only); `Content`
-- (literal text) and `NodeError` carry none.
commentOf :: Env -> Node -> String
commentOf env = case _ of
  Output sp _ -> srcComment env sp
  Block sp _ _ _ _ -> srcComment env sp
  RawBlock sp _ _ _ -> srcComment env sp
  Sep sp _ _ -> srcComment env sp
  _ -> ""

node :: Env -> Node -> Either String String
node env n = (\code -> commentOf env n <> code) <$> nodeBody env n

nodeBody :: Env -> Node -> Either String String
nodeBody env = case _ of
  Content s -> Right ("    out.push_str(" <> rustStr s <> ");\n")
  -- `{{> name [ctx]}}` — inline the hoisted partial body at the call site.
  Output _ (App "partial" args) -> emitPartial env args
  -- `{{yield}}` / `{{{yield}}}` — splice the pre-rendered block-partial body
  -- (already safe markup with its own internal escaping), bypassing the escape.
  Output _ (App "yield" []) -> yieldHere env
  Output _ (App "escapeHtml" [ App "yield" [] ]) -> yieldHere env
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
  -- `{{{{#raw}}}}body{{{{/raw}}}}` — the built-in `raw` head outputs its verbatim
  -- body unescaped (it is `Safe`); a non-`raw` head would need a host helper.
  RawBlock _ "raw" _ raw -> Right ("    out.push_str(" <> rustStr raw <> ");\n")
  RawBlock _ name _ _ ->
    Left ("unsupported: raw block '" <> name <> "' (only the built-in 'raw' head)")
  NodeError _ msg -> Left ("parse error: " <> msg)

-- Splice the pre-rendered block-partial body at a `{{yield}}`.
yieldHere :: Env -> Either String String
yieldHere env = case env.yield of
  Just code -> Right code
  Nothing -> Left "unsupported: '{{yield}}' outside a block partial"

-- `{{> name}}` (implicit `this`) or `{{> name ctx}}` (explicit context).
emitPartial :: Env -> Array Expr -> Either String String
emitPartial env = case _ of
  [ Lit (VString name) ] -> inlinePartial env name (App "this" []) Nothing
  [ Lit (VString name), ctxE ] -> inlinePartial env name ctxE Nothing
  _ -> Left "unsupported: partial with a hash or a dynamic name"

-- `{{#partial "name"}}body{{/partial}}` — render the body in the caller's frame,
-- then inline the named partial with that pre-rendered body bound to `{{yield}}`.
partialBlock :: Env -> Array Expr -> Template -> Either String String
partialBlock env args body = do
  yieldCode <- nodes env body
  case args of
    [ Lit (VString name) ] -> inlinePartial env name (App "this" []) (Just yieldCode)
    [ Lit (VString name), ctxE ] -> inlinePartial env name ctxE (Just yieldCode)
    _ -> Left "unsupported: block partial with a hash or a dynamic name"

-- Inline the hoisted partial body with the passed context as the new scope, and an
-- optional pre-rendered `yield` body. Loop metadata and block params do not cross
-- into a partial; `root` (a function-level binding) does. Recursion is rejected.
inlinePartial :: Env -> String -> Expr -> Maybe String -> Either String String
inlinePartial env name ctxE yieldCode = case Map.lookup name env.partials of
  Nothing -> Left ("unsupported: unknown partial '" <> name <> "'")
  Just body
    | Array.elem name env.expanding -> Left ("unsupported: recursive partial '" <> name <> "'")
    | otherwise -> do
        ctxCode <- expr env ctxE
        nodes
          ( env
              { scope = ctxCode
              , loop = Nothing
              , params = Map.empty
              , parents = []
              , expanding = Array.cons name env.expanding
              , yield = yieldCode
              }
          )
          body

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
      "each" -> eachBlock env split.positional split.label body
      "with" -> withBlock env split.positional body
      "partial" -> partialBlock env split.positional body
      -- `{{#let a=(e)}}` — the surface desugar nests multi-binding lets into
      -- single-binding ones and roots a bare `{{a}}` at the alias, so each block
      -- carries exactly one `name=value` hash pair (ADR-024).
      "let" -> letBlock env split.hash body
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
eachBlock :: Env -> Array Expr -> Maybe String -> Template -> Either String String
eachBlock env args label body = case Array.head args of
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
      kVar = "__k" <> ds
      subVar = "__sub" <> ds
      lenVar = "__len" <> ds
      params' = bindEachParams paramNames cVar iVar env.params
      -- a `label NAME` (ADR-013) binds the loop under NAME, visible into nested loops.
      labels' = maybe env.labels (\l -> Map.insert l lVar env.labels) label
      childEnv = env
        { scope = cVar
        , loop = Just lVar
        , params = params'
        , parents = Array.cons env.scope env.parents
        , labels = labels'
        , depth = d
        }
      parentLoop = maybe "None" (\pl -> "Some(&" <> pl <> ")") env.loop
      s = splitClauses body
    bodyS <- nodes childEnv s.before
    elseS <- clauseBody env s.clauses
    Right
      ( "    {\n"
          <> "    let " <> subVar <> " = &(" <> subj <> ");\n"
          <> "    let " <> lenVar <> " = trussbars_core::Each::each_len(" <> subVar <> ");\n"
          <> "    if " <> lenVar <> " == 0 {\n"
          <> elseS
          <> "    } else {\n"
          <> "    for (" <> iVar <> ", (" <> kVar <> ", " <> cVar <> ")) in trussbars_core::Each::each("
          <> subVar
          <> ").enumerate() {\n"
          <> "    let " <> lVar <> " = trussbars_core::Loop::at(" <> iVar <> ", " <> lenVar
          <> ", " <> kVar <> ", " <> parentLoop <> ");\n"
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
      childEnv = env
        { scope = cVar
        , params = params'
        , parents = Array.cons env.scope env.parents
        , depth = d
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

-- `{{#let name=(value)}}…{{/let}}` → a block-scoped `let` binding. The value is
-- emitted in the current scope (let never re-roots); the name is installed as a
-- scoped nullary op (`env.params`) so a bare `{{name}}` in the body resolves to the
-- Rust binding. The desugar nests multi-binding lets, so each block has one pair.
-- Bound by VALUE — correct for the computed-scalar case (`subtotal=(price*qty)`);
-- binding a non-`Copy` field directly (`n=(user.name)`) would move out of `&ctx`
-- (use the field directly instead).
letBlock :: Env -> Maybe Expr -> Template -> Either String String
letBlock env mhash body = case mhash of
  Nothing -> do
    bodyS <- nodes env body
    Right ("    {\n" <> bodyS <> "    }\n")
  Just (App "dict" [ Lit (VString name), valE ]) -> do
    ve <- expr env valE
    let
      rust = "__let_" <> name
      env' = env { params = Map.insert name rust env.params }
    bodyS <- nodes env' body
    Right ("    {\n    let " <> rust <> " = " <> ve <> ";\n" <> bodyS <> "    }\n")
  Just _ -> Left "unsupported: let with a non-single-binding hash"

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
  -- `items | pluck "key"` — a literal-key field-access closure (spec §4.3).
  App "pluck" [ items, Lit (VString key) ] -> do
    ie <- expr env items
    Right ("(" <> ie <> ").iter().map(|__x| &__x." <> key <> ").collect::<Vec<_>>()")
  -- `items | sortBy "key"` — a stable sort with a literal-key closure.
  App "sortBy" [ items, Lit (VString key) ] -> do
    ie <- expr env items
    Right ("trussbars_std::sort_by(&(" <> ie <> "), |__x| &__x." <> key <> ")")
  -- `items | groupBy "key"` — group by the stringified key into a `BTreeMap`.
  App "groupBy" [ items, Lit (VString key) ] -> do
    ie <- expr env items
    Right
      ( "trussbars_std::group_by(&(" <> ie
          <> "), |__x| { let mut __s = String::new(); trussbars_core::ToText::write_text(&__x."
          <> key
          <> ", &mut __s); __s })"
      )
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
  -- `[a, b, c]` (list literal) → a Rust array; `rustc` enforces homogeneity, so a
  -- mixed-type list (`[1, "a"]`) is a compile error (out of the typed subset).
  -- `Each`/`count` accept the array (the runtime impls a fixed array).
  App "list" xs -> do
    es <- traverse (expr env) xs
    Right ("[" <> joinWith ", " es <> "]")
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
  Just { head: App name [], tail: keys }
    | Just lvar <- Map.lookup name env.labels -> traverse keyStr keys >>= emitLoopChain lvar
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
