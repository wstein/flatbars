-- | **Kernel.Analyse** — analyse mode (ADR-022 Part B). Render a template against
-- | real data and *observe* every truthiness decision the engine actually made,
-- | then report the ones that would branch differently on another engine.
-- |
-- | This is an engine *variant*, not a second interpreter: the five truthiness
-- | operations (`if`/`unless`/`and`/`or`/`not`) are wrapped so each **delegates to
-- | the real operation** (output is byte-identical by construction) and *also*
-- | `tell`s a `Decision`. The accumulation rides a `WriterT (Array Decision)` over
-- | the pure `Either Error` engine, so analysis needs no `Effect`/`Ref`/`Aff` —
-- | it is as pure as a normal render.
-- |
-- | Divergence is decided by replaying the *named rules* (Part A's data-backed
-- | menu) against the recorded value — no value-shape introspection needed.
module Kernel.Analyse
  ( Decision
  , Finding
  , runAnalysis
  , divergence
  , isFinding
  , findings
  , potentialFindings
  , allFindings
  , reportMarkdown
  , jsonataScaffold
  ) where

import Prelude

import Control.Monad.Writer.Class (tell)
import Control.Monad.Writer.Trans (WriterT, runWriterT)
import Data.Array as Array
import Data.Either (Either)
import Data.Foldable (for_)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.String as Str
import Data.String.CodeUnits as SCU
import Data.Tuple (Tuple(..), fst, snd)
import FlatBars.Error (Error)
import FlatBars.Span (Span, lineColumn, spanText)
import FlatBars.Syntax (Template)
import FlatBars.Value (Value(..))
import Kernel.Engine (Engine, Operation, runTemplate)
import Kernel.Env (RefEnv, refTruthy, registerAll)
import Kernel.Prelude (prelude)
import Kernel.Render (preludeEnv)
import Kernel.Value (Truthy, handlebars, minimal, mustache, presence)

-- | One observed truthiness decision: where the condition tag is, which operation
-- | tested it, the value it resolved to, whether the *engine* judged it truthy,
-- | and the named rules whose verdict differs (empty ⇒ portable here).
type Decision =
  { span :: Span
  , op :: String
  , value :: Value
  , truthyHere :: Boolean
  , diverges :: Array (Tuple String Boolean)
  }

-- | The analysis monad: a pure decision-accumulating writer over the engine's
-- | `Either Error`. No effects — the trace is the writer output.
type AnalyseM = WriterT (Array Decision) (Either Error)

-- | The named, data-backed rules Part B replays to decide divergence (ADR-022
-- | Part A.2). `handlebars` is the engine rule the analysed FullBars render uses;
-- | the others are the cross-engine comparison set. `mustache-spec` is the
-- | language-agnostic Mustache reading (`0`/`""` truthy, the Ruby/Python
-- | implementations) — deliberately *not* labelled plain `mustache`, because
-- | `mustache.js` (the dominant JS Mustache) follows the `handlebars` rule instead
-- | (`0`/`""` falsy), so it never diverges from the engine here. The report's
-- | legend spells that out, so a reader on `mustache.js` is not misled by a
-- | `mustache-spec` flip that does not apply to them (ADR-022 S1).
namedRules :: Array (Tuple String Truthy)
namedRules =
  [ Tuple "handlebars" handlebars
  , Tuple "mustache-spec" mustache
  , Tuple "minimal" minimal
  , Tuple "presence" presence
  ]

-- | The named rules whose truthiness verdict for `v` differs from `here` (the
-- | engine's verdict). Pure: each entry is `truthy rule v`. A non-empty result is
-- | exactly the ambiguous-four case — so it is the finding test.
divergence :: Value -> Boolean -> Array (Tuple String Boolean)
divergence v here =
  Array.filter (\t -> snd t /= here)
    (map (\t -> Tuple (fst t) ((snd t) v)) namedRules)

-- | A decision is a *finding* when some engine would branch the other way.
isFinding :: Decision -> Boolean
isFinding d = not (Array.null d.diverges)

-- | A structured portability finding for a host UI (the Lab's Truthiness dock
-- | panel): its `kind` (`"observed"` — the sample hit an ambiguous value;
-- | `"potential"` — the same-type ambiguous value *would* diverge, ADR-030),
-- | location, the condition tag, a description of the value, the engines whose
-- | branch flips, the portable fix, and the data path (`""` when computed).
type Finding =
  { kind :: String
  , line :: Int
  , column :: Int
  , tag :: String
  , value :: String
  , flips :: Array String
  , fix :: String
  , path :: String
  }

-- | A `Finding` for value `v` reported at decision `d`'s location, with the given
-- | `kind` and the rules that flip vs the engine's verdict (`here`).
findingAt :: String -> String -> Decision -> Value -> Boolean -> Finding
findingAt kind src d v here =
  let
    lc = lineColumn src d.span.start
    tagTxt = Str.trim (spanText src d.span)
  in
    { kind
    , line: lc.line
    , column: lc.column
    , tag: tagTxt
    , value: describe v
    , flips: map fst (divergence v here)
    , fix: fixFor v
    , path: case recoverPath tagTxt of
        Just p -> p
        Nothing -> ""
    }

-- | The *observed* findings: ambiguous-four conditions the sample data actually
-- | hit, which diverge across engines. The markdown `reportMarkdown` and this
-- | share the same helpers, so the panel and the report never drift.
findings :: String -> Array Decision -> Array Finding
findings src = map (\d -> findingAt "observed" src d d.value d.truthyHere) <<< Array.filter
  isFinding

-- | The same-type ambiguous value a non-ambiguous, non-falsy observed value could
-- | become (ADR-030 symbolic what-if): a positive number ⇒ `0`, a non-empty
-- | string ⇒ `""`, a non-empty array ⇒ `[]`, a non-empty object ⇒ `{}`. `false`/
-- | `null` (always falsy) and the ambiguous four themselves yield `Nothing`.
sameTypeAmbiguous :: Value -> Maybe Value
sameTypeAmbiguous = case _ of
  VNumber n | n /= 0.0 -> Just (VNumber 0.0)
  VString s | s /= "" -> Just (VString "")
  VSafe s | s /= "" -> Just (VString "")
  VArray a | not (Array.null a) -> Just (VArray [])
  VObject m | not (Map.isEmpty m) -> Just (VObject Map.empty)
  _ -> Nothing

-- | The *potential* findings (ADR-030): for each condition whose observed value
-- | was NOT ambiguous, the same-type ambiguous value it could hold — so coverage
-- | stops depending on the data sample. Deduped by tag+value, and a path already
-- | flagged by an *observed* finding is not re-reported as potential. The engine
-- | verdict for the hypothetical is the `handlebars` rule (the analysed engine).
potentialFindings :: String -> Array Decision -> Array Finding
potentialFindings src decisions =
  Array.nubByEq sameTagValue (Array.mapMaybe toPotential decisions)
  where
  observedPaths = Array.mapMaybe
    (\d -> if isFinding d then recoverPath (Str.trim (spanText src d.span)) else Nothing)
    decisions
  toPotential d = sameTypeAmbiguous d.value >>= \av ->
    let
      finding = findingAt "potential" src d av (handlebars av)
    in
      if Array.null finding.flips then Nothing
      else if finding.path /= "" && Array.elem finding.path observedPaths then Nothing
      else Just finding
  sameTagValue a b = a.tag == b.tag && a.value == b.value

-- | Observed findings then potential findings — the full host-UI finding set.
allFindings :: String -> Array Decision -> Array Finding
allFindings src decisions = findings src decisions <> potentialFindings src decisions

-- | The five truthiness operations, each wrapped to `tell` a `Decision` and then
-- | delegate to the real operation (looked up from the prelude — never
-- | re-implemented). Registered *over* the prelude, so they shadow the originals
-- | while still calling them. Built for any `MonadThrow`+`MonadTell` engine monad.
analysisWrappers :: Array (Tuple String (Operation AnalyseM (RefEnv AnalyseM)))
analysisWrappers = Array.mapMaybe wrap conds
  where
  preludeMap = Map.fromFoldable prelude
  -- `true` ⇒ every argument is a condition (and/or); `false` ⇒ only the first.
  conds =
    [ Tuple "if" false, Tuple "unless" false, Tuple "not" false, Tuple "and" true, Tuple "or" true ]
  wrap (Tuple name variadic) = case Map.lookup name preludeMap of
    Nothing -> Nothing
    Just orig -> Just (Tuple name (analysed name variadic orig))
  analysed name variadic orig ctl args = do
    let tested = if variadic then args else Array.take 1 args
    for_ tested \v -> tell [ decisionFor name ctl v ]
    orig ctl args
  decisionFor name ctl v =
    let
      here = refTruthy ctl.env v
    in
      { span: ctl.span, op: name, value: v, truthyHere: here, diverges: divergence v here }

-- | Render `nodes` against `dat` under analysis, returning the (byte-identical)
-- | output plus the decisions observed. `toEngine` is the dialect's engine builder
-- | (FullBars passes the lenient one); `setup` adds partials/helpers.
runAnalysis
  :: (RefEnv AnalyseM -> Engine AnalyseM (RefEnv AnalyseM))
  -> (RefEnv AnalyseM -> RefEnv AnalyseM)
  -> Template
  -> Value
  -> Either Error { output :: String, decisions :: Array Decision }
runAnalysis toEngine setup nodes dat =
  runWriterT (runTemplate (toEngine env) nodes) <#> \(Tuple output decisions) ->
    { output, decisions }
  where
  env = registerAll analysisWrappers (setup (preludeEnv dat))

--------------------------------------------------------------------------------
-- The markdown report
--------------------------------------------------------------------------------

-- | Format the decisions observed for `src` as a markdown report: findings first
-- | (a condition that would branch differently on another engine), each with the
-- | value, the rules that flip, and a concrete fix; then a `✓` line per portable
-- | condition as positive evidence. Slices `src` at each span for the tag text.
reportMarkdown :: String -> Array Decision -> String
reportMarkdown src decisions =
  Str.joinWith "\n"
    ( [ "# Truthiness analysis"
      , "Engine rule: `handlebars` · "
          <> show (Array.length decisions)
          <> " condition(s) evaluated · **"
          <> show (Array.length flagged)
          <> " observed**, "
          <> show (Array.length potentials)
          <> " potential finding(s)"
      , ""
      , "_Coverage: *observed* findings are conditions this **data** actually drove"
          <> " into the ambiguous four; *potential* findings are the same-type ambiguous"
          <> " value each other condition **could** hold (independent of the sample, so"
          <> " stable for CI). \"No observed findings\" means portable *for this data*, not"
          <> " for all data — read the potential section too._"
      , ""
      , "_The engine `handlebars` rule is also `mustache.js`' (`0`/`\"\"` falsy), so a"
          <> " finding's `flips under` names the engines that branch the *other* way —"
          <> " `mustache-spec` is the language-agnostic Mustache/Ruby reading (`0`/`\"\"`"
          <> " truthy), not `mustache.js`._"
      , ""
      ]
        <>
          ( if Array.null flagged then
              [ "_No observed portability findings — every condition agrees across engines for this data._"
              , ""
              ]
            else map findingSection flagged
          )
        <>
          ( if Array.null potentials then []
            else
              [ "## Potential findings (data-independent)"
              , "_These were portable for your data, but the same-type ambiguous value would diverge:_"
              , ""
              ] <> map potentialLine potentials <> [ "" ]
          )
        <> (if Array.null clean then [] else [ "## Portable conditions" ] <> map cleanLine clean)
    )
  where
  flagged = Array.filter isFinding decisions
  clean = Array.filter (not <<< isFinding) decisions
  potentials = potentialFindings src decisions

  loc d = let lc = lineColumn src d.span.start in "line " <> show lc.line
  tag d = Str.trim (spanText src d.span)

  potentialLine f =
    "* ⚠ line " <> show f.line <> " — `" <> f.tag <> "` would diverge if it held "
      <> f.value
      <> " (flips under "
      <> Str.joinWith ", " (map (\r -> "`" <> r <> "`") f.flips)
      <> ").  **Fix** · "
      <> f.fix
      <> (if f.path /= "" then "  ·  data path: `" <> f.path <> "`" else "")

  findingSection d =
    Str.joinWith "\n"
      [ "## ⚠ " <> loc d <> " — `" <> tag d <> "` tested " <> describe d.value
      , "Under `handlebars` (engine) this is **"
          <> verdict d.truthyHere
          <> "**; it flips under "
          <> Str.joinWith ", " (map (\t -> "`" <> fst t <> "`") d.diverges)
          <> "."
      , "**Fix** · " <> fixFor d.value <> pathNote (recoverPath (tag d))
      , ""
      ]

  cleanLine d = "* ✓ " <> loc d <> " — `" <> tag d <> "` tested " <> describe d.value <>
    " (agrees everywhere)"

  verdict b = if b then "truthy" else "falsy"

  pathNote = case _ of
    Just p -> "  ·  data path: `" <> p <> "`"
    Nothing -> ""

-- | Describe the value shape for the report (the ambiguous four are the ones that
-- | reach a finding; the rest appear on `✓` lines).
describe :: Value -> String
describe = case _ of
  VString "" -> "an empty string `\"\"`"
  VString s -> "a string `\"" <> s <> "\"`"
  VNumber n -> "the number `" <> (if n == 0.0 then "0" else show n) <> "`"
  VBool b -> "`" <> show b <> "`"
  VNull -> "`null`"
  VArray a -> if Array.null a then "an empty array `[]`" else "a non-empty array"
  VObject m -> if Map.isEmpty m then "an empty object `{}`" else "a non-empty object"
  VSafe _ -> "a safe string"

-- | The portable fix to suggest for an ambiguous value tested in a condition.
fixFor :: Value -> String
fixFor = case _ of
  VString "" -> "make it explicit and rule-free: `(ne s \"\")` / `(eq s \"\")`."
  VNumber _ ->
    "if 0 should count, `includeZero=true` (Handlebars-only — not portable); for portability test explicitly: `(ne x 0)`."
  VArray _ ->
    "iterate instead — `{{#each xs}}…{{else}}…{{/each}}` renders `else` on empty on every engine."
  VObject _ -> "only the `presence` rule calls `{}` falsy; test a known key explicitly."
  _ -> "branch explicitly so the decision does not ride on the host's truthiness rule."

--------------------------------------------------------------------------------
-- JSONata cleanup scaffold (ADR-022 Part B) — a *reviewable* skeleton
--------------------------------------------------------------------------------

-- | Emit a JSONata transform that normalises each *bare-path* finding's value out
-- | of the ambiguous truthy-set before the data reaches any engine. Honest scope
-- | (stated in the output): computed-condition findings have no single path and
-- | are listed as comments; the normalisation default is a human's choice, so the
-- | result is a scaffold to review — never applied automatically.
jsonataScaffold :: String -> Array Decision -> String
jsonataScaffold src decisions =
  Str.joinWith "\n"
    ( [ "(* Truthiness cleanup scaffold (ADR-022) — REVIEW each rule before applying. *)"
      , "(* Each path resolved to an engine-ambiguous value in a condition. *)"
      ]
        <>
          ( if Array.null transforms then [ "(* no bare-path findings to normalise *)" ]
            else transforms
          )
        <> (if Array.null computed then [] else [ "" ] <> computed)
    )
  where
  flagged = Array.filter isFinding decisions
  transforms = Array.nub (Array.mapMaybe scaffoldLine flagged)
  computed = Array.nub (Array.mapMaybe computedNote flagged)

  scaffoldLine d = recoverPath (Str.trim (spanText src d.span)) <#> \p ->
    "$ ~> |" <> parentOf p <> "|{ " <> jsq (leafOf p) <> ": " <> normOf p d.value <> " }|"

  computedNote d = case recoverPath (Str.trim (spanText src d.span)) of
    Just _ -> Nothing
    Nothing -> Just
      ("(* computed condition, not path-targetable: " <> Str.trim (spanText src d.span) <> " *)")

  parentOf p = case Str.lastIndexOf (Str.Pattern ".") p of
    Just i -> SCU.take i p
    Nothing -> "$"
  leafOf p = case Str.lastIndexOf (Str.Pattern ".") p of
    Just i -> SCU.drop (i + 1) p
    Nothing -> p
  normOf p = case _ of
    VString "" -> p <> " = \"\" ? null : " <> p
    VNumber _ -> p <> " = 0 ? null : " <> p
    VArray _ -> "$count(" <> p <> ") = 0 ? null : " <> p
    VObject _ -> "$keys(" <> p <> ") ? " <> p <> " : null"
    _ -> p
  jsq s = "\"" <> s <> "\""

-- | Recover a bare data path from a tag slice (`{{#if user.bio}}` ⇒ `user.bio`).
-- | Only simple dotted paths qualify — a computed condition (parens, spaces,
-- | literals) yields `Nothing` (reported, but not data-path-targetable).
recoverPath :: String -> Maybe String
recoverPath tag =
  let
    inner = Str.trim (dropSigil (stripBraces tag))
    body = Str.trim (dropKeyword inner)
  in
    if body /= "" && Array.all pathChar (SCU.toCharArray body) then Just body
    else Nothing
  where
  stripBraces s = Str.replaceAll (Str.Pattern "{{") (Str.Replacement "")
    (Str.replaceAll (Str.Pattern "}}") (Str.Replacement "") s)
  dropSigil s = Str.replaceAll (Str.Pattern "#") (Str.Replacement "")
    (Str.replaceAll (Str.Pattern "^") (Str.Replacement "") s)
  dropKeyword s = case Array.uncons (Str.split (Str.Pattern " ") s) of
    Just { head, tail }
      | head == "if" || head == "unless" || head == "and" || head == "or" || head == "not" ->
          Str.joinWith " " tail
    _ -> s
  pathChar c = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
    || c == '.'
    || c == '_'
    || c == '-'
