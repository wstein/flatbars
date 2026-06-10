-- | Schema inference (Trussbars docs/03), L1 template-symbolic core.
-- |
-- | The *producer dual* of ADR-0030's symbolic analyse: where the analyser
-- | *consumes* a schema to prune findings, this *produces* a candidate context
-- | type from the template's usage of each path. This module is the
-- | **template-symbolic** half (docs/03 §2) — a static walk of the parsed AST
-- | that collects, per canonical path, the type constraints its usage implies
-- | (§3), unifies them (§3/§4), and emits a Rust schema, a JSON data scaffold,
-- | and a human report (§6). Data-observed refinement, enums (§5) and the full
-- | §3 rule table are follow-on increments.
-- |
-- | Scope: `{% each x in xs %}` binds `x` to `xs`'s element (a canonical path
-- | ending in an element step), `{% with o %}` re-roots, `this`/`root`/`parent`
-- | resolve against the scope stack. Every access becomes a canonical path from
-- | the root context; constraints unify per path; the paths assemble into a type
-- | tree (objects, `Vec<_>`, scalars, `Option<_>`).
module Kernel.Schema
  ( Ty(..)
  , ScalarHint(..)
  , PathC
  , InferResult
  , inferTemplate
  , inferTemplateData
  ) where

import Prelude

import Control.Alt ((<|>))
import Data.Array as Array
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Set (Set)
import Data.Set as Set
import Data.String as Str
import Data.String.CodeUnits as SCU
import Data.Tuple (Tuple(..), fst, snd)
import Data.Foldable (foldl)
import FlatBars.Syntax (Expr(..), Node(..), Template, splitBlockArgs)
import FlatBars.Value (Value(..))

-- | A canonical-path segment, rooted at the context. `SElem` is an array
-- | element step (introduced by `each`).
data Seg = SKey String | SElem

derive instance eqSeg :: Eq Seg
derive instance ordSeg :: Ord Seg

type Canon = Array Seg

-- | Serialise a canon to a stable `Map`/`Set` key.
canonKey :: Canon -> String
canonKey = Str.joinWith "\x1f" <<< map segKey
  where
  segKey = case _ of
    SKey k -> "k:" <> k
    SElem -> "[]"

-- | The key name of a segment (`Nothing` for an element step).
segKeyName :: Seg -> Maybe String
segKeyName = case _ of
  SKey k -> Just k
  _ -> Nothing

-- | A scalar's inferred precision. `SUnknown` is under-determined (a bare
-- | output `{{x}}`), defaulted to `String` at emit and flagged (§4).
data ScalarHint = SUnknown | SString | SNumber | SBool | SConflict

derive instance eqScalarHint :: Eq ScalarHint

-- | Unify two scalar hints: `SUnknown` yields to anything; equal agree; unequal
-- | determined hints conflict (§3 — reported, never silently merged).
unifyScalar :: ScalarHint -> ScalarHint -> ScalarHint
unifyScalar SUnknown b = b
unifyScalar a SUnknown = a
unifyScalar SConflict _ = SConflict
unifyScalar _ SConflict = SConflict
unifyScalar a b
  | a == b = a
  | otherwise = SConflict

-- | The accumulated constraints on one canonical path.
type PathC =
  { isArray :: Boolean      -- used as a collection (each / count / join / pluck)
  , isMap :: Boolean        -- map iteration (loop.key in an each body)
  , fields :: Set String    -- object fields observed off this path
  , scalar :: ScalarHint    -- under-determined / pinned / conflicting scalar
  , optional :: Boolean      -- ?? / ?: / if-else signal (§5)
  , enumTag :: Maybe String  -- a {% case this.<tag> %} dispatch ⇒ a tagged enum (§5)
  , enumVariants :: Set String  -- the observed variant tags
  }

emptyC :: PathC
emptyC =
  { isArray: false, isMap: false, fields: Set.empty, scalar: SUnknown, optional: false
  , enumTag: Nothing, enumVariants: Set.empty }

mergeC :: PathC -> PathC -> PathC
mergeC a b =
  { isArray: a.isArray || b.isArray
  , isMap: a.isMap || b.isMap
  , fields: Set.union a.fields b.fields
  , scalar: unifyScalar a.scalar b.scalar
  , optional: a.optional || b.optional
  , enumTag: a.enumTag <|> b.enumTag
  , enumVariants: Set.union a.enumVariants b.enumVariants
  }

type Constraints = Map String (Tuple Canon PathC)

-- | Record (path, constraint) into the accumulator, unifying on collision.
record :: Canon -> PathC -> Constraints -> Constraints
record canon c =
  Map.insertWith (\(Tuple p old) (Tuple _ new) -> Tuple p (mergeC old new))
    (canonKey canon)
    (Tuple canon c)

-- | The scope at a point in the walk.
type Scope =
  { current :: Canon            -- `this`
  , parents :: Array Canon      -- enclosing contexts (for `parent`, `parent.parent`)
  , binds :: Map String Canon   -- loop/with-bound names → their canonical path
  , shadowed :: Set String      -- let/local-bound names (not data fields)
  , partials :: Map String Template  -- inline-partial bodies (for context coupling)
  , visiting :: Set String       -- partials being walked (recursion guard)
  }

rootScope :: Scope
rootScope =
  { current: [], parents: [], binds: Map.empty, shadowed: Set.empty
  , partials: Map.empty, visiting: Set.empty }

-- | Reserved scoped names that are engine metadata, never data fields (skip).
reserved :: Set String
reserved = Set.fromFoldable
  [ "loop", "index", "index0", "index1", "rindex0", "rindex1", "first", "last"
  , "length", "key", "yield", "true", "false", "null", "this", "root", "parent", "outer"
  ]

-- | Resolve a path's head name to a canonical base, or `Nothing` if it is
-- | engine metadata / a literal (not a data field).
resolveHead :: Scope -> String -> Maybe Canon
resolveHead sc name
  | name == "this" = Just sc.current
  | name == "root" = Just []
  -- the desugar rewrites `parent` to the reserved chain accessor `@parentchain`
  | name == "parent" || name == "@parentchain" = Array.head sc.parents
  | Str.take 1 name == "@" = Nothing  -- other reserved data-markers (@hash/@param/@label/…)
  | Set.member name reserved = Nothing
  | Set.member name sc.shadowed = Nothing  -- a let/local-bound name, not a data field
  | otherwise = case Map.lookup name sc.binds of
      Just c -> Just c
      Nothing -> Just (sc.current <> [ SKey name ])

-- | The canonical path an expression denotes, if it is a path access.
exprCanon :: Scope -> Expr -> Maybe Canon
exprCanon sc = case _ of
  App "lookup" args -> case Array.uncons args of
    Just { head: recv, tail: keys } -> do
      base <- recvCanon recv
      ks <- traverseKeys keys
      pure (base <> ks)
    Nothing -> Nothing
  App name [] -> resolveHead sc name
  _ -> Nothing
  where
  recvCanon = case _ of
    App n [] -> resolveHead sc n
    e -> exprCanon sc e
  traverseKeys = Array.foldr step (Just [])
  step e acc = case e, acc of
    Lit (VString k), Just rest -> Just (Array.cons (SKey k) rest)
    _, _ -> Nothing

-- | A literal? (used to skip non-path output like `{{ "x" }}`).
-- String-pack heads imply `String` for their subject; number/arith heads imply
-- `Number`; array-pack heads imply the subject is an array.
stringPack :: Set String
stringPack = Set.fromFoldable
  [ "uppercase", "lowercase", "capitalize", "trim", "trimStart", "trimEnd"
  , "append", "prepend", "replace", "split", "startsWith", "endsWith"
  , "includes", "slice", "truncate", "reverse" ]

numberPack :: Set String
numberPack = Set.fromFoldable
  [ "add", "subtract", "multiply", "divide", "modulo", "abs", "ceil", "floor"
  , "round", "toFixed", "toFloat", "toInt", "lt", "gt", "lte", "gte" ]

arrayPack :: Set String
arrayPack = Set.fromFoldable
  [ "count", "size", "length", "join", "at", "take", "takeRight", "unique", "reverse" ]

-- | Collection filters/projections whose 2nd arg is a literal field key
-- | (`xs | pluck "name"`, `xs | where "active"`): the subject is `Vec<{ key: _ }>`.
filterPack :: Set String
filterPack = Set.fromFoldable
  [ "where", "reject", "find", "some", "every", "pluck", "sortBy", "groupBy" ]

-- | Equality comparisons (`==`/`!=`): a path compared to a literal is pinned to
-- | the literal's scalar type.
comparePack :: Set String
comparePack = Set.fromFoldable [ "eq", "ne", "isnt" ]

-- | Record the subject `e` as a scalar of the given hint, if it is a path.
pinScalar :: Scope -> ScalarHint -> Expr -> Constraints -> Constraints
pinScalar sc hint e cs = case exprCanon sc e of
  Just canon -> record canon (emptyC { scalar = hint }) cs
  Nothing -> useExpr sc cs e

-- | Record the subject `e` as an array, if it is a path.
pinArray :: Scope -> Expr -> Constraints -> Constraints
pinArray sc e cs = case exprCanon sc e of
  Just canon -> record canon (emptyC { isArray = true }) cs
  Nothing -> useExpr sc cs e

-- | Walk an expression in *value* position, recording the constraints its head
-- | implies on its arguments, and descending.
useExpr :: Scope -> Constraints -> Expr -> Constraints
useExpr sc cs expr = case expr of
  Lit _ -> cs
  App "lookup" _ -> case exprCanon sc expr of
    Just canon -> record canon (emptyC { scalar = SUnknown }) cs   -- bare output ⇒ under-determined scalar
    Nothing -> cs
  App _ [] -> case exprCanon sc expr of
    Just canon -> record canon (emptyC { scalar = SUnknown }) cs
    Nothing -> cs
  App "partial" args -> partialUse args cs
  App name args
    | Set.member name filterPack -> filterUse args cs
    | Set.member name comparePack -> compareUse args cs
    | Set.member name stringPack -> pinFirst (pinScalar sc SString) name args cs
    | Set.member name numberPack -> foldl (\acc a -> pinScalar sc SNumber a acc) cs args
    | Set.member name arrayPack -> pinFirst (pinArray sc) name args cs
    | name == "coalesce" || name == "firstTruthy" -> optionalFirst sc args cs
    | otherwise -> foldl (useExpr sc) cs args
  where
  -- `a == lit` / `a != lit` couples `a` to the literal's type (the common,
  -- pin-by-comparison case of §3's `==` coupling). Two-path `a == b` coupling
  -- is a follow-on (needs cross-path unification).
  compareUse args acc = case Array.findMap litScalar args of
    Just h -> foldl (\a e -> pinScalar sc h e a) acc args
    Nothing -> foldl (useExpr sc) acc args
  litScalar = case _ of
    Lit (VString _) -> Just SString
    Lit (VNumber _) -> Just SNumber
    Lit (VBool _) -> Just SBool
    _ -> Nothing
  pinFirst pin _ args acc = case Array.head args of
    Just first -> foldl (useExpr sc) (pin first acc) (fromMaybe [] (Array.tail args))
    Nothing -> acc
  optionalFirst sc' args acc = case Array.head args of
    Just first -> case exprCanon sc' first of
      Just canon -> record canon (emptyC { optional = true }) acc
      Nothing -> useExpr sc' acc first
    Nothing -> acc
  -- `xs | pluck "k"` / `xs | where "k"`: `xs` is an array whose element has field `k`.
  filterUse args acc = case Array.uncons args of
    Just { head: coll, tail } ->
      let acc1 = pinArray sc coll acc
      in case exprCanon sc coll, keyOf tail of
        Just cc, Just k -> record (cc <> [ SElem, SKey k ]) emptyC acc1
        _, _ -> acc1
    Nothing -> acc
  keyOf args = case Array.head args of
    Just (Lit (VString k)) -> Just k
    _ -> Nothing
  -- `{{> name ctx}}`: walk the inline partial `name`'s body with `current` set
  -- to `ctx`'s canon, so the partial's field usage is recorded against `ctx`
  -- (partial-context coupling, §3). A recursion guard via `visiting`.
  partialUse args acc = case Array.uncons args of
    Just { head: Lit (VString nm), tail }
      | Just body <- Map.lookup nm sc.partials
      , not (Set.member nm sc.visiting) ->
          let
            ctxCanon = Array.head tail >>= exprCanon sc
            sc' = sc
              { current = fromMaybe sc.current ctxCanon
              , parents = Array.cons sc.current sc.parents
              , binds = Map.empty
              , visiting = Set.insert nm sc.visiting
              }
            acc1 = foldl (useExpr sc) acc tail
          in
            walk sc' acc1 body
    _ -> foldl (useExpr sc) acc args

-- | Walk a template body, threading scope + constraints.
walk :: Scope -> Constraints -> Template -> Constraints
walk sc = foldl (node sc)

node :: Scope -> Constraints -> Node -> Constraints
node sc cs = case _ of
  Content _ _ -> cs
  Output _ e -> useExpr sc cs e
  Sep _ _ args -> foldl (useExpr sc) cs args
  RawBlock _ _ _ _ -> cs
  NodeError _ _ -> cs
  Block _ _ name args body -> block sc cs name args body

block :: Scope -> Constraints -> String -> Array Expr -> Template -> Constraints
block sc cs name args body =
  let split = splitBlockArgs args
  in case name of
    "each" -> eachBlock split
    "with" -> withBlock split
    "if" -> walk sc (markCond sc cs split.positional body) body
    "unless" -> walk sc (markCond sc cs split.positional body) body
    "let" -> letBlock split
    "local" -> letBlock split
    -- an `{{#inline}}` *definition* emits nothing in place; its body is walked
    -- at each use site (partialUse), rooted at the call's context arg.
    "inline" -> cs
    "case" -> caseBlock split
    -- other blocks: descend, recording subject usage.
    _ -> walk sc (foldl (useExpr sc) cs split.positional) body
  where
  eachBlock split =
    case Array.head split.positional of
      Just collExpr ->
        let
          collCanon = exprCanon sc collExpr
          isMapIter = mentionsKey body            -- `loop.key` in the body ⇒ map iteration
          cs1 = case collCanon of
            Just cc -> record cc (emptyC { isArray = not isMapIter, isMap = isMapIter }) cs
            Nothing -> useExpr sc cs collExpr
          elemCanon = map (_ <> [ SElem ]) collCanon
          param = Array.head split.params
          binds' = case param, elemCanon of
            Just p, Just ec -> Map.insert p ec sc.binds
            _, _ -> sc.binds
          childCanon = fromMaybe sc.current elemCanon
          sc' = sc { current = childCanon, parents = Array.cons sc.current sc.parents, binds = binds' }
        in
          walk sc' cs1 body
      Nothing -> walk sc cs body
  withBlock split =
    case Array.head split.positional of
      Just o ->
        let
          oc = fromMaybe sc.current (exprCanon sc o)
          sc' = sc { current = oc, parents = Array.cons sc.current sc.parents }
          cs1 = useExpr sc cs o
        in
          walk sc' cs1 body
      Nothing -> walk sc cs body
  letBlock split =
    let
      pairs = hashPairs split.hash
      cs1 = foldl (\acc (Tuple _ v) -> useExpr sc acc v) cs pairs
      names = map fst pairs
      sc' = sc { shadowed = Set.union sc.shadowed (Set.fromFoldable names) }
    in
      walk sc' cs1 body
  -- `{% case x.tag %}{% when "A" %}…{% endcase %}`: walk the arms, then mark
  -- `x` as a tagged enum (tag = the subject's last key; variants = the `when`
  -- literals, later unioned with data-observed tag values, §5).
  caseBlock split =
    let
      cs1 = walk sc (foldl (useExpr sc) cs split.positional) body
      subjCanon = Array.head split.positional >>= exprCanon sc
      variants = whenLiterals body
    in
      case subjCanon of
        -- `{% case el.tag %}` where `el` is a *collection element* (init ends in
        -- an element step) ⇒ a tagged data-enum on `el` (§5: "over a collection").
        Just sj
          | Just { init, last: SKey tag } <- Array.unsnoc sj
          , Just SElem <- Array.last init
          , not (Set.isEmpty variants) ->
              record init (emptyC { enumTag = Just tag, enumVariants = variants }) cs1
        -- otherwise a plain value switch (`{% case status %}`): the subject is a
        -- scalar whose values are the (string) `when` literals ⇒ pin as String.
        Just sj
          | not (Set.isEmpty variants) ->
              record sj (emptyC { scalar = SString }) cs1
        _ -> cs1

-- | Mark each condition path: it exists (a non-numeric truthy field), and it is
-- | `Option` iff the block has an `{% else %}` clause (§5 optionality signal).
markCond :: Scope -> Constraints -> Array Expr -> Template -> Constraints
markCond sc cs conds body = foldl step cs conds
  where
  opt = hasElse body
  step acc e = case exprCanon sc e of
    Just canon -> record canon (emptyC { optional = opt }) acc
    Nothing -> useExpr sc acc e

-- | The `{% when "lit" … %}` literal values in a `{% case %}` body (§5 variants).
whenLiterals :: Template -> Set String
whenLiterals = foldl go Set.empty
  where
  go s = case _ of
    Sep _ "when" args -> Set.union s (Set.fromFoldable (Array.mapMaybe litStr args))
    _ -> s
  litStr = case _ of
    Lit (VString v) -> Just v
    _ -> Nothing

-- | Does a body contain an `{% else %}` / `{% elif %}` separator?
hasElse :: Template -> Boolean
hasElse = Array.any isElse
  where
  isElse = case _ of
    Sep _ n _ -> n == "else" || n == "elif"
    _ -> false

-- | Does a body reference `loop.key` / bare `key` (⇒ the loop is over a map)?
mentionsKey :: Template -> Boolean
mentionsKey = Array.any nodeKey
  where
  nodeKey = case _ of
    Output _ e -> mentionsKeyE e
    Sep _ _ as -> Array.any mentionsKeyE as
    Block _ _ _ as b -> Array.any mentionsKeyE as || mentionsKey b
    _ -> false

mentionsKeyE :: Expr -> Boolean
mentionsKeyE = case _ of
  App "key" [] -> true
  App "lookup" as -> case Array.head as of
    Just (App "loop" []) -> Array.any isKeyLit (fromMaybe [] (Array.tail as))
    Just (App "key" []) -> true
    _ -> Array.any mentionsKeyE as
  App _ as -> Array.any mentionsKeyE as
  Lit _ -> false

isKeyLit :: Expr -> Boolean
isKeyLit = case _ of
  Lit (VString "key") -> true
  _ -> false

-- | Extract `name = value` pairs from a desugared `{% let %}` hash
-- | (`App "dict" [Lit name1, val1, Lit name2, val2, …]`).
hashPairs :: Maybe Expr -> Array (Tuple String Expr)
hashPairs = case _ of
  Just (App "dict" xs) -> pairUp xs
  _ -> []
  where
  pairUp ys = case Array.uncons ys of
    Just { head: Lit (VString k), tail } -> case Array.uncons tail of
      Just { head: v, tail: rest } -> Array.cons (Tuple k v) (pairUp rest)
      Nothing -> []
    _ -> []

-- ---------------------------------------------------------------------------
-- Tree assembly: canonical paths → a `Ty` tree
-- ---------------------------------------------------------------------------

-- | An inferred type.
data Ty
  = TyScalar ScalarHint Boolean       -- hint, optional
  | TyArray Ty
  | TyMap Ty
  | TyObject (Map String Ty)
  | TyEnum String (Set String)        -- #[serde(tag)] enum: tag field, variant tags
  | TyUnknown

derive instance eqTy :: Eq Ty

-- | Build the root type from the flat constraint set.
buildTy :: Constraints -> Ty
buildTy cs = atPrefix []
  where
  entries :: Array (Tuple Canon PathC)
  entries = map snd (Map.toUnfoldable cs)

  -- the constraint recorded *exactly* at a path (if any)
  exact :: Canon -> Maybe PathC
  exact p = map snd (Array.find (\(Tuple q _) -> canonKey q == canonKey p) entries)

  -- immediate child segments of a prefix
  childrenOf :: Canon -> Array Seg
  childrenOf prefix =
    Array.nub $ Array.mapMaybe nextSeg entries
    where
    n = Array.length prefix
    nextSeg (Tuple q _) =
      if Array.take n q == prefix && Array.length q > n then Array.index q n
      else Nothing

  atPrefix :: Canon -> Ty
  atPrefix prefix =
    let
      c = fromMaybe emptyC (exact prefix)
      kids = childrenOf prefix
      keyKids = Array.mapMaybe segKeyName kids
      hasElem = Array.elem SElem kids
    in
      case c.enumTag of
        Just tag -> TyEnum tag c.enumVariants
        Nothing ->
          if c.isMap then
            TyMap (atPrefix (prefix <> [ SElem ]))
          else if c.isArray || hasElem then
            TyArray (atPrefix (prefix <> [ SElem ]))
          else if not (Array.null keyKids) || not (Set.isEmpty c.fields) then
            TyObject (Map.fromFoldable (map (\k -> Tuple k (atPrefix (prefix <> [ SKey k ]))) keyKids))
          else
            TyScalar c.scalar c.optional

-- ---------------------------------------------------------------------------
-- Emit: Rust structs, JSON scaffold, report
-- ---------------------------------------------------------------------------

type InferResult =
  { schema :: String      -- the Rust context type(s)
  , dataScaffold :: String -- a skeleton JSON fixture
  , report :: String       -- the human report
  , conflicts :: Int       -- number of scalar conflicts (for --strict)
  }

scalarRust :: ScalarHint -> String
scalarRust = case _ of
  SString -> "String"
  SNumber -> "f64"
  SBool -> "bool"
  SUnknown -> "String"   -- default (§4), flagged in the report
  SConflict -> "String"  -- conflict; flagged

-- | Naive singularise for a struct name (`teams` → `Team`).
structName :: String -> String
structName field =
  let
    base = if Str.length field > 1 && SCU.takeRight 1 field == "s"
      then SCU.dropRight 1 field
      else field
  in
    cap base
  where
  cap s = case SCU.uncons s of
    Just { head, tail } -> Str.toUpper (SCU.singleton head) <> tail
    Nothing -> s

-- | Collect the named object structs reachable from the root, emitting each.
-- Returns (root-fields-rendered, the named struct decls).
emitSchema :: Ty -> String
emitSchema root =
  Str.joinWith "\n\n" ([ rootDecl ] <> structDecls)
  where
  rootDecl = "#[derive(Deserialize, Trussbars)]\nstruct Ctx " <> objBody "Ctx" root

  -- accumulate nested object structs (named by their field) other than root
  structDecls = collect root

  collect :: Ty -> Array String
  collect = case _ of
    TyObject fields ->
      Array.concatMap (\(Tuple k t) -> namedFor k t <> collect t) (Map.toUnfoldable fields)
    TyArray t -> collect t
    TyMap t -> collect t
    _ -> []

  namedFor :: String -> Ty -> Array String
  namedFor k = case _ of
    TyArray (TyObject fields) ->
      [ "#[derive(Deserialize, Trussbars)]\nstruct " <> structName k <> " " <> objBody (structName k) (TyObject fields) ]
    TyArray (TyEnum tag vars) -> [ enumDecl (structName k) tag vars ]
    TyObject fields ->
      [ "#[derive(Deserialize, Trussbars)]\nstruct " <> cap1 k <> " " <> objBody (cap1 k) (TyObject fields) ]
    TyEnum tag vars -> [ enumDecl (cap1 k) tag vars ]
    _ -> []

  enumDecl nm tag vars =
    "#[derive(Deserialize, Trussbars)]\n#[serde(tag = \"" <> tag <> "\")]\nenum " <> nm <> " { "
      <> Str.joinWith ", " (map cap1 (Array.fromFoldable vars :: Array String)) <> " }"

  objBody :: String -> Ty -> String
  objBody _ = case _ of
    TyObject fields ->
      "{ " <> Str.joinWith ", " (map (\(Tuple k t) -> k <> ": " <> tyRef k t) (Map.toUnfoldable fields)) <> " }"
    _ -> "{ /* … */ }"

  -- a field's type reference (names nested objects after the field)
  tyRef :: String -> Ty -> String
  tyRef field = case _ of
    TyScalar h opt -> wrapOpt opt (scalarRust h)
    TyArray (TyObject _) -> "Vec<" <> structName field <> ">"
    TyArray (TyEnum _ _) -> "Vec<" <> structName field <> ">"
    TyArray t -> "Vec<" <> tyRef field t <> ">"
    TyMap t -> "BTreeMap<String, " <> tyRef field t <> ">"
    TyObject _ -> cap1 field
    TyEnum _ _ -> cap1 field
    TyUnknown -> "String"

  wrapOpt opt s = if opt then "Option<" <> s <> ">" else s
  cap1 s = case SCU.uncons s of
    Just { head, tail } -> (Str.toUpper (SCU.singleton head)) <> tail
    Nothing -> s

-- | A skeleton JSON value for a type (placeholder per field; one elem per array).
scaffoldJson :: Ty -> String
scaffoldJson = case _ of
  TyScalar h opt
    | opt -> "null"
    | otherwise -> case h of
        SNumber -> "0"
        SBool -> "false"
        _ -> "\"\""
  TyArray t -> "[ " <> scaffoldJson t <> " ]"
  TyMap t -> "{ \"key\": " <> scaffoldJson t <> " }"
  TyObject fields ->
    "{ " <> Str.joinWith ", " (map (\(Tuple k t) -> "\"" <> k <> "\": " <> scaffoldJson t) (Map.toUnfoldable fields)) <> " }"
  TyEnum tag vars ->
    "{ \"" <> tag <> "\": \"" <> fromMaybe "" (Array.head (Array.fromFoldable vars :: Array String)) <> "\" }"
  TyUnknown -> "\"\""

-- | Count scalar conflicts in the tree.
countConflicts :: Ty -> Int
countConflicts = case _ of
  TyScalar SConflict _ -> 1
  TyScalar _ _ -> 0
  TyArray t -> countConflicts t
  TyMap t -> countConflicts t
  TyObject fields -> foldl (\n (Tuple _ t) -> n + countConflicts t) 0 (Map.toUnfoldable fields :: Array (Tuple String Ty))
  TyEnum _ _ -> 0
  TyUnknown -> 0

-- | Count under-determined (defaulted) scalars.
countGuessed :: Ty -> Int
countGuessed = case _ of
  TyScalar SUnknown _ -> 1
  TyScalar _ _ -> 0
  TyArray t -> countGuessed t
  TyMap t -> countGuessed t
  TyObject fields -> foldl (\n (Tuple _ t) -> n + countGuessed t) 0 (Map.toUnfoldable fields :: Array (Tuple String Ty))
  TyEnum _ _ -> 0
  TyUnknown -> 0

emitReport :: Ty -> String
emitReport root =
  Str.joinWith "\n"
    [ "# Schema inference (template-symbolic)"
    , show guessed <> " field(s) defaulted to `String` (bare output — provide --data to refine), "
        <> show conflicts <> " conflict(s)."
    , if conflicts > 0 then "⚠ conflicts present — a path is used at two incompatible types; rerun with --strict to fail." else ""
    , if guessed > 0 then "Defaulted fields are a guess, not a deduction — confirm or narrow them." else ""
    ]
  where
  guessed = countGuessed root
  conflicts = countConflicts root

-- ---------------------------------------------------------------------------
-- Data-observed refinement (docs/03 §2): pin under-determined scalars from
-- sample data. Many samples are unioned (decision §2).
-- ---------------------------------------------------------------------------

-- | Observe the scalar type at every path of a sample value (arrays recurse
-- | through `SElem`, objects through `SKey`).
observe :: Canon -> Value -> Array (Tuple Canon ScalarHint)
observe canon = case _ of
  VString _ -> [ Tuple canon SString ]
  VSafe _ -> [ Tuple canon SString ]
  VNumber _ -> [ Tuple canon SNumber ]
  VBool _ -> [ Tuple canon SBool ]
  VNull -> []
  VArray xs -> Array.concatMap (observe (Array.snoc canon SElem)) xs
  VObject m ->
    Array.concatMap (\(Tuple k v) -> observe (Array.snoc canon (SKey k)) v)
      (Map.toUnfoldable m :: Array (Tuple String Value))

-- | Union the observed scalar at each path across all samples.
observeScalars :: Array Value -> Map String ScalarHint
observeScalars = foldl addSample Map.empty
  where
  addSample m s = foldl addObs m (observe [] s)
  addObs m (Tuple canon h) = Map.insertWith unifyScalar (canonKey canon) h m

-- | Refine each under-determined (`SUnknown`) scalar with the observed type.
refineScalars :: Map String ScalarHint -> Constraints -> Constraints
refineScalars obs cs =
  Map.fromFoldable (map ref (Map.toUnfoldable cs :: Array (Tuple String (Tuple Canon PathC))))
  where
  ref (Tuple key (Tuple canon c)) =
    let
      c' = case Map.lookup key obs of
        Just h | c.scalar == SUnknown -> c { scalar = h }
        _ -> c
    in
      Tuple key (Tuple canon c')

-- | Observe distinct string values at every path (for enum tag-value union, §5).
observeStr :: Canon -> Value -> Array (Tuple Canon String)
observeStr canon = case _ of
  VString s -> [ Tuple canon s ]
  VSafe s -> [ Tuple canon s ]
  VArray xs -> Array.concatMap (observeStr (Array.snoc canon SElem)) xs
  VObject m ->
    Array.concatMap (\(Tuple k v) -> observeStr (Array.snoc canon (SKey k)) v)
      (Map.toUnfoldable m :: Array (Tuple String Value))
  _ -> []

-- | The distinct string values observed at each path across all samples.
observeTags :: Array Value -> Map String (Set String)
observeTags = foldl addSample Map.empty
  where
  addSample m s = foldl addV m (observeStr [] s)
  addV m (Tuple canon v) = Map.insertWith Set.union (canonKey canon) (Set.singleton v) m

-- | Union data-observed tag values into each enum's variant set (§5: "the
-- | variants come from the data's tag field").
refineEnums :: Map String (Set String) -> Constraints -> Constraints
refineEnums obs cs =
  Map.fromFoldable (map ref (Map.toUnfoldable cs :: Array (Tuple String (Tuple Canon PathC))))
  where
  ref (Tuple key (Tuple canon c)) = case c.enumTag of
    Just tag ->
      let
        dataVars = fromMaybe Set.empty (Map.lookup (canonKey (canon <> [ SKey tag ])) obs)
      in
        Tuple key (Tuple canon (c { enumVariants = Set.union c.enumVariants dataVars }))
    Nothing -> Tuple key (Tuple canon c)

-- | Infer a candidate schema, refining under-determined scalars + enum variants
-- | with sample data (docs/03 §2, §5). `inferTemplate` is the no-data case.
inferTemplateData :: Array Value -> Template -> InferResult
inferTemplateData samples tmpl =
  let
    sc0 = rootScope { partials = collectInlines tmpl }
    cs = refineEnums (observeTags samples)
      (refineScalars (observeScalars samples) (walk sc0 Map.empty tmpl))
    ty = buildTy cs
  in
    { schema: emitSchema ty
    , dataScaffold: scaffoldJson ty
    , report: emitReport ty
    , conflicts: countConflicts ty
    }

-- | Infer a candidate schema from a parsed template (template-symbolic, no data).
inferTemplate :: Template -> InferResult
inferTemplate = inferTemplateData []

-- | Collect inline-partial definitions (`{{#inline "name"}}…{{/inline}}`) by name,
-- | recursing into block bodies.
collectInlines :: Template -> Map String Template
collectInlines = foldl go Map.empty
  where
  go m = case _ of
    Block _ _ "inline" args body ->
      let
        m' = Map.union (collectInlines body) m
      in
        case Array.head (splitBlockArgs args).positional of
          Just (Lit (VString nm)) -> Map.insert nm body m'
          _ -> m'
    Block _ _ _ _ body -> Map.union (collectInlines body) m
    _ -> m
