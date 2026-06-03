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
  , AnalyseM
  , analysisWrappers
  , runAnalysis
  , namedRules
  , divergence
  , isFinding
  , findings
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
-- | the others are the cross-engine comparison set.
namedRules :: Array (Tuple String Truthy)
namedRules =
  [ Tuple "handlebars" handlebars
  , Tuple "mustache" mustache
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
-- | panel): location, the condition tag, a description of the ambiguous value,
-- | the engines whose branch flips, the portable fix, and the data path (`""`
-- | when the condition is computed rather than a bare path).
type Finding =
  { line :: Int
  , column :: Int
  , tag :: String
  , value :: String
  , flips :: Array String
  , fix :: String
  , path :: String
  }

-- | The findings (ambiguous-four conditions that diverge), as structured records
-- | for a host UI. The markdown `reportMarkdown` and this share the same
-- | `describe`/`fixFor`/path-recovery, so the panel and the report never drift.
findings :: String -> Array Decision -> Array Finding
findings src = map toFinding <<< Array.filter isFinding
  where
  toFinding d =
    let
      lc = lineColumn src d.span.start
      tagTxt = Str.trim (spanText src d.span)
    in
      { line: lc.line
      , column: lc.column
      , tag: tagTxt
      , value: describe d.value
      , flips: map fst d.diverges
      , fix: fixFor d.value
      , path: case recoverPath tagTxt of
          Just p -> p
          Nothing -> ""
      }

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
          <> " condition(s) evaluated, **"
          <> show (Array.length findings)
          <> " portability finding(s)**"
      , ""
      ]
        <>
          ( if Array.null findings then
              [ "_No portability findings — every condition agrees across engines for this data._"
              , ""
              ]
            else map findingSection findings
          )
        <> (if Array.null clean then [] else [ "## Portable conditions" ] <> map cleanLine clean)
    )
  where
  findings = Array.filter isFinding decisions
  clean = Array.filter (not <<< isFinding) decisions

  loc d = let lc = lineColumn src d.span.start in "line " <> show lc.line
  tag d = Str.trim (spanText src d.span)

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
  VObject _ -> "only `presence`/StringTemplate4 call `{}` falsy; test a known key explicitly."
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
  findings = Array.filter isFinding decisions
  transforms = Array.nub (Array.mapMaybe scaffoldLine findings)
  computed = Array.nub (Array.mapMaybe computedNote findings)

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
