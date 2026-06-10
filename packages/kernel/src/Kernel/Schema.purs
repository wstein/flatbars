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
  ) where

import Prelude

import Data.Array as Array
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Set (Set)
import Data.Set as Set
import Data.String as Str
import Data.String.CodeUnits as SCU
import Data.Tuple (Tuple(..), snd)
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
  }

emptyC :: PathC
emptyC = { isArray: false, isMap: false, fields: Set.empty, scalar: SUnknown, optional: false }

mergeC :: PathC -> PathC -> PathC
mergeC a b =
  { isArray: a.isArray || b.isArray
  , isMap: a.isMap || b.isMap
  , fields: Set.union a.fields b.fields
  , scalar: unifyScalar a.scalar b.scalar
  , optional: a.optional || b.optional
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
  }

rootScope :: Scope
rootScope = { current: [], parents: [], binds: Map.empty }

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
  [ "count", "size", "length", "join", "at", "take", "takeRight", "unique"
  , "sortBy", "pluck", "groupBy", "where", "reject", "find", "some", "every" ]

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
  App name args
    | Set.member name stringPack -> pinFirst (pinScalar sc SString) name args cs
    | Set.member name numberPack -> foldl (\acc a -> pinScalar sc SNumber a acc) cs args
    | Set.member name arrayPack -> pinFirst (pinArray sc) name args cs
    | name == "coalesce" || name == "firstTruthy" -> optionalFirst sc args cs
    | otherwise -> foldl (useExpr sc) cs args
  where
  pinFirst pin _ args acc = case Array.head args of
    Just first -> foldl (useExpr sc) (pin first acc) (fromMaybe [] (Array.tail args))
    Nothing -> acc
  optionalFirst sc' args acc = case Array.head args of
    Just first -> case exprCanon sc' first of
      Just canon -> record canon (emptyC { optional = true }) acc
      Nothing -> useExpr sc' acc first
    Nothing -> acc

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
    "each" ->
      case Array.head split.positional of
        Just collExpr ->
          let
            cs1 = pinArray sc collExpr cs                     -- the collection is an array
            collCanon = exprCanon sc collExpr
            elemCanon = map (_ <> [ SElem ]) collCanon
            param = Array.head split.params
            binds' = case param, elemCanon of
              Just p, Just ec -> Map.insert p ec sc.binds
              _, _ -> sc.binds
            childCanon = fromMaybe sc.current elemCanon
            sc' = { current: childCanon, parents: Array.cons sc.current sc.parents, binds: binds' }
          in
            walk sc' cs1 body
        Nothing -> walk sc cs body
    "with" ->
      case Array.head split.positional of
        Just o ->
          let
            oc = fromMaybe sc.current (exprCanon sc o)
            sc' = { current: oc, parents: Array.cons sc.current sc.parents, binds: sc.binds }
            cs1 = useExpr sc cs o
          in
            walk sc' cs1 body
        Nothing -> walk sc cs body
    "if" -> condBody sc (markNonNumeric sc cs split.positional) body
    "unless" -> condBody sc (markNonNumeric sc cs split.positional) body
    -- let/local/set, case, etc.: descend, recording subject usage; binding
    -- semantics for scalar `let` names are a follow-on increment.
    _ -> walk sc (foldl (useExpr sc) cs split.positional) body
  where
  condBody sc' cs' b = walk sc' cs' b

-- | A condition path is non-numeric truthy (§3) and optional-ish; record it as
-- | optional (it is treated as possibly-absent) — a coarse but useful signal.
markNonNumeric :: Scope -> Constraints -> Array Expr -> Constraints
markNonNumeric sc cs = foldl step cs
  where
  step acc e = case exprCanon sc e of
    Just canon -> record canon (emptyC { optional = true }) acc
    Nothing -> useExpr sc acc e

-- ---------------------------------------------------------------------------
-- Tree assembly: canonical paths → a `Ty` tree
-- ---------------------------------------------------------------------------

-- | An inferred type.
data Ty
  = TyScalar ScalarHint Boolean       -- hint, optional
  | TyArray Ty
  | TyMap Ty
  | TyObject (Map String Ty)
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
    TyObject fields ->
      [ "#[derive(Deserialize, Trussbars)]\nstruct " <> cap1 k <> " " <> objBody (cap1 k) (TyObject fields) ]
    _ -> []

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
    TyArray t -> "Vec<" <> tyRef field t <> ">"
    TyMap t -> "BTreeMap<String, " <> tyRef field t <> ">"
    TyObject _ -> cap1 field
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
  TyUnknown -> "\"\""

-- | Count scalar conflicts in the tree.
countConflicts :: Ty -> Int
countConflicts = case _ of
  TyScalar SConflict _ -> 1
  TyScalar _ _ -> 0
  TyArray t -> countConflicts t
  TyMap t -> countConflicts t
  TyObject fields -> foldl (\n (Tuple _ t) -> n + countConflicts t) 0 (Map.toUnfoldable fields :: Array (Tuple String Ty))
  TyUnknown -> 0

-- | Count under-determined (defaulted) scalars.
countGuessed :: Ty -> Int
countGuessed = case _ of
  TyScalar SUnknown _ -> 1
  TyScalar _ _ -> 0
  TyArray t -> countGuessed t
  TyMap t -> countGuessed t
  TyObject fields -> foldl (\n (Tuple _ t) -> n + countGuessed t) 0 (Map.toUnfoldable fields :: Array (Tuple String Ty))
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

-- | Infer a candidate schema from a parsed template (template-symbolic, no data).
inferTemplate :: Template -> InferResult
inferTemplate tmpl =
  let
    cs = walk rootScope Map.empty tmpl
    ty = buildTy cs
  in
    { schema: emitSchema ty
    , dataScaffold: scaffoldJson ty
    , report: emitReport ty
    , conflicts: countConflicts ty
    }
