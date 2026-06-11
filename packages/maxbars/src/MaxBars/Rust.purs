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
-- | map, iterated via the `Each` trait), the collection filters `where` / `reject` /
-- | `find` / `some` / `every` (ADR-036/037: predicate closures over
-- | `.iter().filter`/`.find`/`.any`/`.all`; `find` → `Option`, unwrapped by an
-- | Option-aware `with`), `{{#let}}` block-scoped bindings, list literals `[…]`
-- | (→ a Rust array), and raw blocks (the built-in `raw` head, emitted verbatim).
-- | Anything else (`dict` literals — which need a generated struct; a non-`raw`
-- | raw-block head) returns a `Left` "unsupported …" so the conformance harness
-- | excludes it honestly.
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
  , compileMaxRustCommentedWith
  ) where

import Prelude

import ClassicBars (desugarSurfaceWith, hoistInline, renameSurfaceHeads, resolveInheritance)
import Data.Array as Array
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Foldable (foldMap, sum)
import Data.Int as Int
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), isJust, maybe)
import Data.String (Pattern(..), Replacement(..), joinWith, replaceAll, split, trim)
import Data.String.CodeUnits as SCU
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import FlatBars.Span (Span, spanText)
import FlatBars.Syntax (Expr(..), Ident, Node(..), Template, splitBlockArgs)
import FlatBars.Value (Value(..))
import Kernel.Walk (Clause, splitClauses)
import MaxBars (maxLoopVars)
import MaxBars.Parser as Parser

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
compileMaxRust = compileWith false [] ""

-- | Like `compileMaxRust`, but annotates each emitted statement with a
-- | `// <file>:<line>:<col>  {{…}}` comment locating its originating MaxBars source
-- | (the tag sliced by the node's span; the line:col computed from the span start)
-- | — a readability/teaching aid and the docs/07 source-trail breadcrumb. `file`
-- | labels the location (pass the template's name; "" ⇒ line:col only). The comments
-- | are inert: rendered output is byte-for-byte identical to `compileMaxRust`.
compileMaxRustCommented
  :: String -> String -> String -> { ok :: Boolean, out :: String, err :: String }
compileMaxRustCommented = compileWith true []

-- | `compileMaxRustCommented` with named *external* partials (each MaxBars surface
-- | source), hoisted into the inline registry alongside the template's own
-- | `{{#inline}}` definitions (and inlined at every `{{> name}}`). This is what the
-- | Lab's AOT-compat lint uses, so a `{{> styles}}` resolving to a host/Lab-registered
-- | partial is *not* mis-reported as an "unknown partial" — the check sees the same
-- | partials the render does.
compileMaxRustCommentedWith
  :: Array (Tuple String String)
  -> String
  -> String
  -> String
  -> { ok :: Boolean, out :: String, err :: String }
compileMaxRustCommentedWith = compileWith true

compileWith
  :: Boolean
  -> Array (Tuple String String)
  -> String
  -> String
  -> String
  -> { ok :: Boolean, out :: String, err :: String }
compileWith commented externalSrcs file ctxType src = case build of
  Right rust -> { ok: true, out: rust, err: "" }
  Left e -> { ok: false, out: "", err: e }
  where
  build :: Either String String
  build = do
    parsed <- lmap (show <<< NEA.head) (Parser.parse src)
    -- ADR-040: flatten `{% extends %}`/`{% block %}`/`{% super %}` before desugar, exactly
    -- as the interpreter does, so the emitted Rust matches the oracle.
    inherited <- lmap show (resolveInheritance parsed.nodes)
    externals <- traverse compilePartial externalSrcs
    let
      -- `renameSurfaceHeads`: `{% scope %}`→`with` (item 9) and `{% for %}`→`each`
      -- (item 4) — the MaxBars sugar heads → their op-name heads, matching `desugarStmt`.
      h = hoistInline (desugarSurfaceWith maxLoopVars (renameSurfaceHeads inherited))
      externalMap = Map.fromFoldable externals
      -- The template's own `{{#inline}}` definitions plus the external partials; an
      -- inline of the same name wins (it indexes `main`).
      env0 = initialEnv (Map.union h.partials externalMap)
      -- The `#[doc]` form of the breadcrumb: render-fn provenance (commented builds).
      docAttr =
        if commented && file /= "" then "#[doc = \"Generated by Trussbars from `" <> file <>
          "`.\"]\n"
        else ""
    body <- nodes env0 h.template
    pure (docAttr <> renderFn ctxType (estimateBytes h.template) body)

  -- A named external partial: parse + desugar its body into the registry form.
  compilePartial :: Tuple String String -> Either String (Tuple String Template)
  compilePartial (Tuple name s) = do
    p <- lmap (show <<< NEA.head) (Parser.parse s)
    Right (Tuple name (desugarSurfaceWith maxLoopVars (renameSurfaceHeads p.nodes)))

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
    <> "    static __CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new("
    <> show cap
    <> ");\n"
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
    Content _ s -> SCU.length s
    Output _ _ -> 8
    Block _ _ "each" _ body -> 8 * estimateBytes body
    Block _ _ _ _ body -> estimateBytes body
    _ -> 0

--------------------------------------------------------------------------------
-- Nodes (statements)
--------------------------------------------------------------------------------

nodes :: Env -> Template -> Either String String
nodes env ts = foldMap identity <$> traverse (node env) ts

-- The `<file>:<line>:<col>` breadcrumb for a span — the reusable location string
-- that drops straight into a `// …` comment, a `#[doc = "…"]`, or a
-- `compile_error!("…")` (the docs/07 class-A diagnostic form). `file` is omitted
-- when empty (⇒ bare `line:col`).
breadcrumb :: Env -> Span -> String
breadcrumb env sp =
  let
    { line, col } = lineCol env.source sp.start
  in
    (if env.file == "" then "" else env.file <> ":") <> show line <> ":" <> show col

-- A `// <breadcrumb>  {{…}}` annotation for a node (commented builds only): the
-- node's location and the opening tag sliced from the source — enough to read the
-- generated Rust back against the template and jump to it.
srcComment :: Env -> Span -> String
srcComment env sp
  | env.commented = "    // " <> breadcrumb env sp <> "  " <> openTag (spanText env.source sp) <>
      "\n"
  | otherwise = ""

-- The span of a node that carries one (`Content`/`NodeError` do not).
spanOf :: Node -> Maybe Span
spanOf = case _ of
  Output sp _ -> Just sp
  Block sp _ _ _ _ -> Just sp
  RawBlock sp _ _ _ -> Just sp
  Sep sp _ _ -> Just sp
  _ -> Nothing

-- Prefix an emitter error with the node's breadcrumb (commented builds only), so an
-- "unsupported …" reads `file:line:col: unsupported …` — a `compile_error!`-ready,
-- template-located message (docs/07 class A). Plain builds keep the bare reason.
locate :: Env -> Node -> String -> String
locate env n reason
  | env.commented = case spanOf n of
      Just sp -> breadcrumb env sp <> ": " <> reason
      Nothing -> reason
  | otherwise = reason

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
node env n = case nodeBody env n of
  Right code -> Right (commentOf env n <> code)
  Left reason -> Left (locate env n reason)

nodeBody :: Env -> Node -> Either String String
nodeBody env = case _ of
  Content _ s -> Right ("    out.push_str(" <> rustStr s <> ");\n")
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

-- `{{> name}}` (implicit `this`), `{{> name ctx}}` (explicit context), or
-- `{% include "name" k=v %}` (a trailing `dict` of hash arguments, ADR-042).
emitPartial :: Env -> Array Expr -> Either String String
emitPartial env = case _ of
  [ Lit (VString name) ] -> inlinePartial env name (App "this" []) [] Nothing
  [ Lit (VString name), ctxE ] -> inlinePartial env name ctxE [] Nothing
  [ Lit (VString name), ctxE, App "dict" kvs ] -> do
    pairs <- hashPairs kvs
    inlinePartial env name ctxE pairs Nothing
  _ -> Left "unsupported: partial with a dynamic name"

-- `{{#partial "name"}}body{{/partial}}` — render the body in the caller's frame,
-- then inline the named partial with that pre-rendered body bound to `{{yield}}`.
partialBlock :: Env -> Array Expr -> Template -> Either String String
partialBlock env args body = do
  yieldCode <- nodes env body
  case args of
    [ Lit (VString name) ] -> inlinePartial env name (App "this" []) [] (Just yieldCode)
    [ Lit (VString name), ctxE ] -> inlinePartial env name ctxE [] (Just yieldCode)
    [ Lit (VString name), ctxE, App "dict" kvs ] -> do
      pairs <- hashPairs kvs
      inlinePartial env name ctxE pairs (Just yieldCode)
    _ -> Left "unsupported: block partial with a dynamic name"

-- The `key=value` pairs of an include's trailing `dict` (a flat `[key, val, …]`).
hashPairs :: Array Expr -> Either String (Array (Tuple String Expr))
hashPairs = go []
  where
  go acc xs = case Array.uncons xs of
    Nothing -> Right acc
    Just { head: Lit (VString k), tail } -> case Array.uncons tail of
      Just { head: v, tail: rest } -> go (Array.snoc acc (Tuple k v)) rest
      Nothing -> Left "unsupported: malformed include hash"
    Just _ -> Left "unsupported: include hash with a non-literal key"

-- Inline the hoisted partial body with the passed context as the new scope, the
-- include's hash arguments bound as scoped parameters (ADR-042 — each `key=value`
-- enters `env.params`, so a bare `{{key}}` in the body resolves to the emitted
-- value), and an optional pre-rendered `yield` body. Loop metadata and block params
-- do not cross into a partial; `root` (a function-level binding) does. Recursion is
-- rejected.
inlinePartial
  :: Env -> String -> Expr -> Array (Tuple String Expr) -> Maybe String -> Either String String
inlinePartial env name ctxE hash yieldCode = case Map.lookup name env.partials of
  Nothing -> Left ("unsupported: unknown partial '" <> name <> "'")
  Just body
    | Array.elem name env.expanding -> Left ("unsupported: recursive partial '" <> name <> "'")
    | otherwise -> do
        ctxCode <- expr env ctxE
        -- the hash values are emitted in the *caller* env (the include site), then
        -- bound for the partial body — exactly how `local`/loop variables bind.
        bound <- traverse (\(Tuple k vE) -> Tuple k <$> expr env vE) hash
        nodes
          ( env
              { scope = ctxCode
              , loop = Nothing
              , params = Map.fromFoldable bound
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
      -- `{% local a=(e) %}` — the bounded binding (renamed from `let`, docs-17). The
      -- surface desugar nests multi-binding locals into single-binding ones and roots
      -- a bare `{{a}}` at the alias, so each block carries exactly one `name=value`
      -- hash pair (ADR-024).
      "local" -> letBlock env split.hash body
      -- `{{#case s}}{{when V…}}…{{else}}…{{/case}}` (docs/12): a first-class multi-arm
      -- conditional, lowered to a Rust `match` — the subject is evaluated once (the bound
      -- `__subj`) and dispatched by one guard arm per `{{when}}`, `{{else}}` the `_` arm.
      "case" -> caseBlock env split.positional body
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

-- `{{#case}}` → a Rust `match`: bind the subject once (`__subj`), then one guard arm per
-- `{{when}}` (`*__subj == (value)`, OR-chained for a multi-value arm), with `{{else}}` the
-- `_` arm (an absent `{{else}}` is an empty `_ => {}`). The guard reuses the same `==` the
-- `eq` operator emits, so the rendered bytes match `caseH` (docs/12).
caseBlock :: Env -> Array Expr -> Template -> Either String String
caseBlock env positional body = case positional of
  [ subj ] -> do
    se <- expr env subj
    let s = splitClauses body
    arms <- caseArms env s.clauses
    Right ("    {\n    let __subj = &(" <> se <> ");\n    match () {\n" <> arms <> "    }\n    }\n")
  _ -> Left "unsupported: {{#case}} with multiple subject arguments"

caseArms :: Env -> Array Clause -> Either String String
caseArms env clauses = case Array.uncons clauses of
  Nothing -> Right "    _ => {}\n"
  Just { head: cl, tail } -> case cl.name of
    "else" -> do
      b <- nodes env cl.body
      Right ("    _ => {\n" <> b <> "    }\n")
    "when" -> do
      guards <- traverse (\v -> (\ve -> "*__subj == (" <> ve <> ")") <$> expr env v) cl.args
      b <- nodes env cl.body
      rest <- caseArms env tail
      let guard = if Array.null guards then "false" else joinWith " || " guards
      Right ("    () if " <> guard <> " => {\n" <> b <> "    }\n" <> rest)
    other -> Left ("unsupported: case clause '" <> other <> "'")

elseChain
  :: Env -> Array Clause -> Either String String
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

-- Whether a bare reference to `name` (head `App name …`, e.g. `loop` or a loop
-- label) appears anywhere in a subtree — used to elide a dead `Loop::at` frame. It
-- is conservative on purpose: a `loop` in a *nested* loop keeps this frame too
-- (the parent chain needs it), but when nothing in the subtree uses `loop`, the
-- whole subtree elides cleanly (so no nested `Loop::at` references this frame).
exprMentions :: String -> Expr -> Boolean
exprMentions name = case _ of
  App n args -> n == name || Array.any (exprMentions name) args
  Lit _ -> false

nodeMentions :: String -> Node -> Boolean
nodeMentions name = case _ of
  Output _ e -> exprMentions name e
  Block _ _ _ args body -> Array.any (exprMentions name) args || templateMentions name body
  RawBlock _ _ args _ -> Array.any (exprMentions name) args
  Sep _ _ args -> Array.any (exprMentions name) args
  _ -> false

templateMentions :: String -> Template -> Boolean
templateMentions name = Array.any (nodeMentions name)

-- `{{#each subject as |item idx|}}` → a native `for` over `subject.iter()
-- .enumerate()`, binding the loop metadata (`Loop::at`) and the block params, with
-- the empty collection rendering the `{{else}}` clause in the parent scope. The
-- `Loop::at` frame is emitted only when the body actually uses `loop`/the label.
eachBlock :: Env -> Array Expr -> Maybe String -> Template -> Either String String
eachBlock env args label body = case Array.head args of
  Nothing -> Left "unsupported: each without a subject"
  -- A dict literal compiles to a struct, which has no `Each` impl — reject iterating
  -- one up front (bind it and read its fields instead of a downstream rustc failure).
  Just subjE | isJust (dictArity subjE) ->
    Left "unsupported: cannot iterate a dict literal — bind it and read its fields"
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
      s = splitClauses body
      -- The frame is live only if the loop body uses `loop` or this loop's label.
      needsFrame = templateMentions "loop" s.before
        || maybe false (\l -> templateMentions l s.before) label
      childEnv = env
        { scope = cVar
        , loop = if needsFrame then Just lVar else Nothing
        , params = params'
        , parents = Array.cons env.scope env.parents
        , labels = if needsFrame then labels' else env.labels
        , depth = d
        }
      parentLoop = maybe "None" (\pl -> "Some(&" <> pl <> ")") env.loop
      -- The 0-based index `__i` is needed only by the frame or an index block param;
      -- without either, drop `.enumerate()` so no dead index lingers (clippy-clean).
      needIndex = needsFrame || isJust (Array.index paramNames 1)
      forHead =
        if needIndex then "    for (" <> iVar <> ", (" <> kVar <> ", " <> cVar
          <> ")) in trussbars_core::Each::each("
          <> subVar
          <> ").enumerate() {\n"
        else "    for (" <> kVar <> ", " <> cVar <> ") in trussbars_core::Each::each(" <> subVar <>
          ") {\n"
      frameLine =
        if needsFrame then "    let " <> lVar <> " = trussbars_core::Loop::at(" <> iVar <> ", "
          <> lenVar
          <> ", "
          <> kVar
          <> ", "
          <> parentLoop
          <> ");\n"
        else ""
    bodyS <- nodes childEnv s.before
    elseS <- clauseBody env s.clauses
    Right
      ( "    {\n"
          <> "    let "
          <> subVar
          <> " = &("
          <> subj
          <> ");\n"
          <> "    let "
          <> lenVar
          <> " = trussbars_core::Each::each_len("
          <> subVar
          <> ");\n"
          <> "    if "
          <> lenVar
          <> " == 0 {\n"
          <> elseS
          <> "    } else {\n"
          <> forHead
          <> frameLine
          <> bodyS
          <> "    }}\n"
          <> "    }\n"
      )

-- `(find coll "key" [cmp value])` — the first matching element as `Option<&T>`.
collFind :: Env -> Array Expr -> Either String String
collFind env args = case Array.uncons args of
  Just { head: collE, tail } | not (Array.null tail) -> do
    ie <- expr env collE
    body <- predBody env tail
    Right ("(" <> ie <> ").iter().find(|__x| " <> body <> ")")
  _ -> Left "unsupported: find without a collection and a predicate"

-- `{{#with (find …) as |x|}}` — the Option-aware `with`: unwrap the `find` result
-- with `if let Some`, rendering the body re-rooted at the found element, else the
-- `{{else}}` clause. (Plain `{{#with}}` can't field-access an `Option`.)
withFind :: Env -> Array Expr -> Array Expr -> Template -> Either String String
withFind env findArgs blockParams body = do
  found <- collFind env findArgs
  let
    d = env.depth + 1
    cVar = "__c" <> show d
    paramNames = bindingNames blockParams
    params' = maybe env.params (\n -> Map.insert n cVar env.params) (Array.index paramNames 0)
    childEnv = env
      { scope = cVar, params = params', parents = Array.cons env.scope env.parents, depth = d }
    s = splitClauses body
  bodyS <- nodes childEnv s.before
  elseS <- clauseBody env s.clauses
  Right
    ( "    {\n    if let Some(" <> cVar <> ") = " <> found <> " {\n"
        <> bodyS
        <> "    } else {\n"
        <> elseS
        <> "    }\n    }\n"
    )

-- `{{#with subject as |u|}}` → bind the subject and, when truthy, render the body
-- in its scope; otherwise render the `{{else}}` clause. A `find` subject takes the
-- Option-aware path (`withFind`).
withBlock :: Env -> Array Expr -> Template -> Either String String
withBlock env args body = case Array.head args of
  Nothing -> Left "unsupported: with without a subject"
  Just (App "find" findArgs) -> withFind env findArgs (Array.drop 1 args) body
  -- A dict-literal subject re-roots to a synthesized struct, which has no `Truthy`
  -- impl — so resolve its truthiness at compile time: a non-empty dict literal always
  -- renders the body, an empty one always the `{{else}}` clause.
  Just subjE | Just n <- dictArity subjE -> withDict env (Array.drop 1 args) subjE n body
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
          <> "    let "
          <> cVar
          <> " = &("
          <> subj
          <> ");\n"
          <> "    if trussbars_core::truthy("
          <> cVar
          <> ") {\n"
          <> bodyS
          <> "    } else {\n"
          <> elseS
          <> "    }\n    }\n"
      )

-- `{{#with {dict} as |c|}}` — compile-time truthiness: a non-empty dict literal
-- always renders the body (re-rooted at the synthesized struct), an empty `{}` always
-- the `{{else}}` clause. No runtime `truthy` check (the struct has no `Truthy` impl).
withDict :: Env -> Array Expr -> Expr -> Int -> Template -> Either String String
withDict env blockParams subjE n body =
  let
    s = splitClauses body
  in
    if n == 0 then clauseBody env s.clauses
    else do
      subj <- expr env subjE
      let
        paramNames = bindingNames blockParams
        d = env.depth + 1
        cVar = "__c" <> show d
        params' = maybe env.params (\nm -> Map.insert nm cVar env.params) (Array.index paramNames 0)
        childEnv = env
          { scope = cVar
          , params = params'
          , parents = Array.cons env.scope env.parents
          , depth = d
          }
      bodyS <- nodes childEnv s.before
      Right ("    {\n    let " <> cVar <> " = &(" <> subj <> ");\n" <> bodyS <> "    }\n")

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
clauseBody
  :: Env -> Array Clause -> Either String String
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

-- A collection-filter adapter (ADR-036/037): `(coll).iter().<method>(|__x| [!](pred))`,
-- collecting into a `Vec<&T>` for `filter` (an each-subject) or yielding a `bool` for
-- `any`/`all`. `negated` wraps the predicate in `!(…)` (for `reject`). The element is
-- `__x` (a reference that auto-derefs on field access).
collFilter :: Env -> String -> Boolean -> Array Expr -> Either String String
collFilter env method negated args = case Array.uncons args of
  Just { head: collE, tail } | not (Array.null tail) -> do
    ie <- expr env collE
    body <- predBody env tail
    let
      pred = if negated then "!(" <> body <> ")" else body
      suffix = if method == "filter" then ".collect::<Vec<_>>()" else ""
    Right ("(" <> ie <> ").iter()." <> method <> "(|__x| " <> pred <> ")" <> suffix)
  _ -> Left "unsupported: collection filter without a collection and a predicate"

-- The boolean predicate body for a filter, referencing the element as `__x`:
-- `"key"` → the key's truthiness; `"key" "cmp" value` → a comparator / string-predicate.
predBody :: Env -> Array Expr -> Either String String
predBody env = case _ of
  [ Lit (VString key) ] -> Right ("trussbars_core::truthy(&__x." <> key <> ")")
  [ Lit (VString key), Lit (VString cmp), val ] -> do
    ve <- expr env val
    cmpBody key cmp ve
  _ -> Left "unsupported: collection-filter predicate (want `\"key\"` or `\"key\" \"cmp\" value`)"

-- A single comparator/string-predicate over `__x.<key>`. Numeric comparators need an
-- `f64` field (like any literal comparison); the string predicates need a string field.
cmpBody :: String -> String -> String -> Either String String
cmpBody key cmp ve =
  let
    field = "__x." <> key
  in
    case cmp of
      "gt" -> Right (field <> " > " <> ve)
      "gte" -> Right (field <> " >= " <> ve)
      "lt" -> Right (field <> " < " <> ve)
      "lte" -> Right (field <> " <= " <> ve)
      "eq" -> Right (field <> " == " <> ve)
      "ne" -> Right (field <> " != " <> ve)
      "startsWith" -> Right (field <> ".starts_with(" <> ve <> ")")
      "endsWith" -> Right (field <> ".ends_with(" <> ve <> ")")
      "includes" -> Right (field <> ".contains(" <> ve <> ")")
      _ -> Left ("unsupported: collection comparator '" <> cmp <> "'")

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
  -- `~` (ADR-042): `trussbars_std::concat` takes string refs, so a non-string
  -- operand is a Rust compile error — the typed AOT mirror of the oracle's strict
  -- string-only `concat`.
  App "concat" [ a, b ] -> do
    ae <- expr env a
    be <- expr env b
    Right ("trussbars_std::concat(&(" <> ae <> "), &(" <> be <> "))")
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
  -- Collection filters (ADR-036/037): a key-truthiness (`"key"`) or key-comparator
  -- (`"key" "cmp" value`) predicate over a collection, emitted as a native iterator
  -- adapter. `where`/`reject` → `Vec<&T>` (an each-subject); `some`/`every` → `bool`.
  -- `find` (→ `Option`) is deferred — it needs an Option-aware `with`.
  App "where" args -> collFilter env "filter" false args
  App "reject" args -> collFilter env "filter" true args
  App "some" args -> collFilter env "any" false args
  App "every" args -> collFilter env "all" false args
  -- `find` → `Option<&T>`; `{{#with (find …)}}` unwraps it (withFind), and
  -- `{{#if (find …)}}` reads here (truthiness of the `Option`).
  App "find" args -> collFind env args
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
  -- `{k: v, …}` (dict literal, or the `(dict "k" v …)` call form) → a typed,
  -- block-local *generic* struct whose field types are inferred at instantiation, so
  -- a field can hold a literal (by value) or a path (by reference) without naming the
  -- type. `{{#with {a: 1} as |c|}}{{c.a}}{{/with}}` re-roots to it; `c.a` is an
  -- ordinary field access. Keys are static identifiers — a closed compile-time record.
  App "dict" xs -> emitDict env xs
  App name args
    | Just r <- emitHelper env name args -> r
  App name [] -> case Map.lookup name env.params of
    Just v -> Right v
    Nothing -> Left ("unsupported: expression head '" <> name <> "'")
  App name _ -> Left ("unsupported: helper '" <> name <> "'")

-- A dict literal `{k0: v0, …}` (desugared `dict "k0" v0 …`) → a block expression
-- defining a generic local struct and returning an instance. Generic so each field
-- type is inferred (a literal by value, a path by reference); the empty dict `{}` is
-- a fieldless unit struct (falsy — see `withBlock`).
emitDict :: Env -> Array Expr -> Either String String
emitDict env args = do
  pairs <- dictPairs args
  if Array.null pairs then Right "{ struct __Dict; __Dict }"
  else do
    parts <- traverse field (Array.mapWithIndex Tuple pairs)
    let
      gens = joinWith ", " (map _.gen parts)
      decls = joinWith ", " (map _.decl parts)
      inits = joinWith ", " (map _.init parts)
    Right ("{ struct __Dict<" <> gens <> "> { " <> decls <> " } __Dict { " <> inits <> " } }")
  where
  field (Tuple i (Tuple key val)) = do
    v <- dictFieldValue env val
    pure
      { gen: "F" <> show i
      , decl: key <> ": F" <> show i
      , init: key <> ": " <> v
      }

-- The `(key, value)` pairs of a `dict` application — alternating string-literal keys
-- and value expressions. A computed (non-literal) key is rejected (the surface only
-- produces literal keys, but be explicit).
dictPairs :: Array Expr -> Either String (Array (Tuple String Expr))
dictPairs args = case Array.uncons args of
  Nothing -> Right []
  Just { head: Lit (VString k), tail } -> case Array.uncons tail of
    Just { head: v, tail: rest } -> Array.cons (Tuple k v) <$> dictPairs rest
    Nothing -> Left "unsupported: dict literal with a dangling key"
  Just _ -> Left "unsupported: dict literal with a computed key"

-- A literal field is held by value; any other expression (a path) by reference, so it
-- borrows from `&ctx` rather than moving out of it.
dictFieldValue :: Env -> Expr -> Either String String
dictFieldValue env = case _ of
  Lit v -> lit v
  e -> do
    ee <- expr env e
    Right ("&(" <> ee <> ")")

-- The field count of a dict-literal subject (`Just n`), else `Nothing` — used to
-- resolve a dict's truthiness at compile time (a synthesized struct has no `Truthy`
-- impl; a non-empty dict literal is always truthy, an empty one always falsy).
dictArity :: Expr -> Maybe Int
dictArity = case _ of
  App "dict" args -> Just (Array.length args / 2)
  _ -> Nothing

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
  -- a hash-argument include (ADR-042) binds its keys in `env.params`; a
  -- `this`-rooted lookup of a bound key resolves to the emitted hash value,
  -- shadowing the partial's context — the AOT mirror of the oracle's `mergeHash`.
  Just { head: App "this" [], tail: keys }
    | Just { head: Lit (VString k), tail: rest } <- Array.uncons keys
    , Just code <- Map.lookup k env.params -> do
        segs <- traverse seg rest
        Right (code <> foldMap identity segs)
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
loopFields = [ "index0", "index1", "rindex0", "rindex1", "first", "last", "length", "depth", "key" ]

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
  "even" -> call "even" [ Num ]
  "odd" -> call "odd" [ Num ]
  "divisibleBy" -> call "divisible_by" [ Num, Num ]
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
