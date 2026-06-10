-- | `flatbars` — a command-line renderer for FlatBars core templates.
-- |
-- | Usage:
-- |
-- | ```text
-- | flatbars <template.bars> [--data <data.json>] [--validate | --compile] [--help]
-- | ```
-- |
-- | Renders a template against JSON data using the reference prelude, writing
-- | the result to stdout. Core syntax by default; `--surface` reads the
-- | Handlebars-flavoured surface dialect. With `--validate` it runs the
-- | skeleton-AST validation pass instead; with `--compile` it emits a JS module
-- | (`FlatBars.Compile`, honouring `--surface`) to stdout — pair it with
-- | `flatbars-runtime.mjs`.
module Cli.Main where

import Prelude

import ClassicBars (analyseSurface, directiveLints, handlebars, noLoopVars, preludeSchema, renderSurfaceDiagWith)
import ClassicBars.Compile (compileSurfaceWith) as Compile
import Data.Array as Array
import Data.Either (Either(..))
import Data.Int as Int
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe, isJust, maybe)
import Data.String (Pattern(..), contains, joinWith, split, stripPrefix, stripSuffix)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Exception (message, try)
import FlatBars (ParseOptions, defaultParseOptions, parseWith, renderParseErrorAt, renderParseErrorsAt)
import FlatBars.Json (parseValue)
import FlatBars.Lexer (defaultLexConfig)
import FlatBars.Value (Value(..))
import Kernel.Walk (Severity, validate)
import Linter.Aliases (aliasWarnings, scopedCanonWarnings)
import MaxBars (maxOptions, maxbarsWarnings)
import MinBars (renderMinCompat, renderMinDelimsCompatDiag, renderMinDelimsDiag, renderMinDiag, renderMinWith) as MinBars
import Node.Encoding (Encoding(..))
import Node.FS.Sync (readTextFile, readdir)
import RawBars (compileJsWith, compileWith, coreOptions)

foreign import argv :: Effect (Array String)
foreign import writeStdout :: String -> Effect Unit
foreign import writeStderr :: String -> Effect Unit
foreign import setExitCode :: Int -> Effect Unit

usage :: String
usage =
  joinWith "\n"
    [ "flatbars — render a FlatBars core template"
    , ""
    , "Usage:"
    , "  flatbars <template> [--data <data.json>] [--validate | --compile]"
    , "  flatbars analyse <template> <data.json> [--emit-jsonata]"
    , "  flatbars lint <template> [--surface | --maxbars] [--max-warnings <n>]"
    , "  flatbars examples verify [--provider mustache]"
    , ""
    , "Options:"
    , "  -d, --data <file>   JSON data file (default: null context)"
    , "  -s, --surface       read the template in the surface dialect ({{ name }}, paths, @data,"
    , "                      as |x|) instead of core syntax — applies to render and --compile"
    , "  -m, --mustache      render with the Mustache (MinBars) engine — sections, inverted,"
    , "                      partials, inheritance; render-only (no --compile/--validate/--surface)"
    , "      --mustache-js   like --mustache, but with mustache.js truthiness (0 and \"\" are falsy,"
    , "                      as in the JS implementation); the default treats them as truthy (spec)"
    , "      --validate      validate the template against the prelude schema; do not render"
    , "  -c, --compile       compile the template to a JS module (printed to stdout); do not render"
    , "      --trim <mode>   standalone whitespace: 'standalone' (default) strips a lone block/"
    , "                      comment line; 'none' keeps it. Overrides flatbars.json; a @trim"
    , "                      directive in the template overrides both."
    , "      --delimiters <pair>"
    , "                      set the initial tag delimiters (Mustache set delimiters, ADR-015),"
    , "                      e.g. --delimiters '<% %>'. Enables {{=<% %>=}} switching and the"
    , "                      {{! @delimiters }} directive. Applies to core syntax or --mustache"
    , "                      (the initial pair); not with --surface."
    , "  -h, --help          show this help"
    , ""
    , "Config: a flatbars.json in the working directory may set { \"trim\": \"standalone\" | \"none\","
    , "        \"delimiters\": [\"<%\", \"%>\"] } (--trim/--delimiters override it)."
    , "Core syntax: {{{ lookup this \"x\" }}}, {{#each …}}, …. Surface (--surface): {{ x }}, a.b.c, …."
    , "The compiled module's default export is `function (data, rt)`; pair it with"
    , "the runtime at packages/compile/runtime/flatbars-runtime.mjs."
    ]

data Mode
  = Help
  | Invalid String
  | Run Options

type Options =
  { template :: String
  , dataFile :: Maybe String
  , validateOnly :: Boolean
  , compileOnly :: Boolean
  , surface :: Boolean
  , mustache :: Boolean -- --mustache: render via the MinBars (Mustache) engine
  , mustacheJs :: Boolean -- --mustache-js: MinBars under mustache.js truthiness (0/"" falsy)
  , trim :: Maybe Boolean -- --trim override; Nothing ⇒ config/default decides
  , delimiters :: Maybe { open :: String, close :: String } -- --delimiters override
  }

main :: Effect Unit
main = do
  args <- Array.drop 2 <$> argv
  case Array.uncons args of
    -- `flatbars examples …` — the vendored example/conformance corpus subcommand.
    Just { head: "examples", tail } -> runExamples tail
    -- `flatbars analyse <template> <data.json> [--emit-jsonata]` — ADR-022 Part B.
    Just { head: "analyse", tail } -> runAnalyse tail
    -- `flatbars lint <template> [--surface]` — on-demand canonicalization lints.
    Just { head: "lint", tail } -> runLint tail
    _ -> case parseArgs args of
      Help -> writeStdout (usage <> "\n")
      Invalid msg -> die ("flatbars: " <> msg <> "\n\n" <> usage)
      Run opts -> run opts

-- | Parse argv into a mode. The first non-flag argument is the template path.
parseArgs :: Array String -> Mode
parseArgs =
  go
    { template: Nothing
    , dataFile: Nothing
    , validateOnly: false
    , compileOnly: false
    , surface: false
    , mustache: false
    , mustacheJs: false
    , trim: Nothing
    , delimiters: Nothing
    }
  where
  go acc args = case Array.uncons args of
    Nothing -> case acc.template of
      Just template -> Run
        { template
        , dataFile: acc.dataFile
        , validateOnly: acc.validateOnly
        , compileOnly: acc.compileOnly
        , surface: acc.surface
        , mustache: acc.mustache
        , mustacheJs: acc.mustacheJs
        , trim: acc.trim
        , delimiters: acc.delimiters
        }
      Nothing -> Help
    Just { head, tail } -> case head of
      "-h" -> Help
      "--help" -> Help
      "--validate" -> go (acc { validateOnly = true }) tail
      flag | flag == "-c" || flag == "--compile" -> go (acc { compileOnly = true }) tail
      flag | flag == "-s" || flag == "--surface" -> go (acc { surface = true }) tail
      flag | flag == "-m" || flag == "--mustache" -> go (acc { mustache = true }) tail
      -- --mustache-js implies --mustache; it only swaps the truthiness rule.
      "--mustache-js" -> go (acc { mustache = true, mustacheJs = true }) tail
      "--trim" -> case Array.uncons tail of
        Just { head: "standalone", tail: rest } -> go (acc { trim = Just true }) rest
        Just { head: "none", tail: rest } -> go (acc { trim = Just false }) rest
        Just _ -> Invalid "--trim expects 'standalone' or 'none'"
        Nothing -> Invalid "--trim requires a value ('standalone' or 'none')"
      "--delimiters" -> case Array.uncons tail of
        Just { head: v, tail: rest } -> case parseDelimArg v of
          Right d -> go (acc { delimiters = Just d }) rest
          Left e -> Invalid e
        Nothing -> Invalid "--delimiters requires a value, e.g. --delimiters '<% %>'"
      flag | flag == "-d" || flag == "--data" -> case Array.uncons tail of
        Just { head: file, tail: rest } -> go (acc { dataFile = Just file }) rest
        Nothing -> Invalid (flag <> " requires a file argument")
      other -> case acc.template of
        Nothing -> go (acc { template = Just other }) tail
        Just _ -> Invalid ("unexpected argument '" <> other <> "'")

run :: Options -> Effect Unit
run opts = do
  tplE <- readFileSafe opts.template
  case tplE of
    Left err -> die ("flatbars: cannot read template '" <> opts.template <> "': " <> err)
    Right tpl -> do
      -- precedence (both keys): flag > flatbars.json > built-in default.
      configTrim <- loadConfigTrim
      configDelims <- loadConfigDelimiters
      let
        delims = firstJust opts.delimiters configDelims
        popts = defaultParseOptions
          { trimStandalone = fromMaybe true (firstJust opts.trim configTrim)
          , lexConfig = maybe defaultLexConfig
              (\d -> defaultLexConfig { open = d.open, close = d.close, mustacheDelims = true })
              delims
          }
      if isJust delims && opts.surface then
        die
          "flatbars: --delimiters/config delimiters apply to core syntax only, not --surface (ClassicBars, the Handlebars-faithful dialect, has no set delimiters)"
      else if opts.mustache && (opts.compileOnly || opts.validateOnly || opts.surface) then
        die
          "flatbars: --mustache renders the Mustache (MinBars) engine; it cannot combine with --surface, --compile, or --validate"
      else if opts.compileOnly then runCompile popts opts tpl
      else if opts.validateOnly then runValidate popts tpl
      else do
        datE <- loadData opts.dataFile
        case datE of
          Left err -> die ("flatbars: " <> err)
          Right value
            | opts.mustache ->
                -- --delimiters sets MinBars' INITIAL pair (Mustache {{=…=}}
                -- switching still applies, relative to it); else the default {{ }}.
                -- --mustache-js swaps the spec rule for mustache.js' (0/"" falsy).
                let
                  plain = if opts.mustacheJs then MinBars.renderMinCompat else MinBars.renderMinDiag
                  withDelims =
                    if opts.mustacheJs then MinBars.renderMinDelimsCompatDiag
                    else MinBars.renderMinDelimsDiag
                in
                  case maybe (plain tpl value) (\d -> withDelims d tpl value) delims of
                    Left err -> die ("flatbars: " <> opts.template <> ": " <> err)
                    Right out -> writeStdout out
            | opts.surface ->
                case renderSurfaceDiagWith true noLoopVars popts handlebars tpl value of
                  Left err -> die ("flatbars: " <> opts.template <> ": " <> err)
                  Right out -> writeStdout out
            | otherwise -> case compileWith popts tpl of
                Left pe -> die ("flatbars: " <> opts.template <> ":" <> renderParseErrorAt tpl pe)
                Right render -> case render value of
                  Left err -> die ("flatbars: " <> show err)
                  Right out -> writeStdout out

-- | Compile a template to a JS ES module and print it to stdout (surface or core).
runCompile :: ParseOptions -> Options -> String -> Effect Unit
runCompile popts opts tpl =
  case
    ( if opts.surface
      -- surface = ClassicBars (Handlebars rule); core = RawBars (nonEmpty rule).
      then Compile.compileSurfaceWith true noLoopVars popts "rt.truthyHandlebars" tpl
      else compileJsWith popts tpl
    )
    of
    Left pe -> die ("flatbars: " <> opts.template <> ":" <> renderParseErrorAt tpl pe)
    Right js -> writeStdout js

-- | Run the skeleton-AST validation pass + directive lints and report issues.
runValidate :: ParseOptions -> String -> Effect Unit
runValidate popts tpl = case parseWith popts tpl of
  Left errs -> die ("flatbars: parse error at " <> renderParseErrorsAt tpl errs)
  Right { directives, nodes: template } ->
    case directiveLints directives <> validate preludeSchema template of
      [] -> writeStdout "ok: no issues\n"
      issues -> do
        writeStderr (joinWith "\n" (map fmt issues) <> "\n")
        setExitCode 1
  where
  fmt issue = show issue.severity <> ": " <> issue.message

-- | Load and parse the optional JSON data file; absent file ⇒ null context.
loadData :: Maybe String -> Effect (Either String Value)
loadData = case _ of
  Nothing -> pure (Right VNull)
  Just file -> do
    contentE <- readFileSafe file
    pure case contentE of
      Left err -> Left ("cannot read data '" <> file <> "': " <> err)
      Right content -> case parseValue content of
        Left err -> Left ("invalid JSON in '" <> file <> "': " <> err)
        Right value -> Right value

-- | Read the standalone-trim setting from `flatbars.json` in the working
-- | directory, if present: `{ "trim": "standalone" | "none" }`. A missing/
-- | unreadable/malformed file or absent key yields `Nothing` (use the default).
loadConfigTrim :: Effect (Maybe Boolean)
loadConfigTrim = do
  e <- readFileSafe "flatbars.json"
  pure case e of
    Left _ -> Nothing
    Right content -> case parseValue content of
      Right (VObject m) -> case Map.lookup "trim" m of
        Just (VString "standalone") -> Just true
        Just (VString "none") -> Just false
        _ -> Nothing
      _ -> Nothing

-- | Read the initial delimiter pair from `flatbars.json`: `{ "delimiters":
-- | ["<%", "%>"] }`. A missing/unreadable/malformed file, absent key, wrong
-- | shape, or a delimiter containing `=` yields `Nothing` (use the default pair).
loadConfigDelimiters :: Effect (Maybe { open :: String, close :: String })
loadConfigDelimiters = do
  e <- readFileSafe "flatbars.json"
  pure case e of
    Left _ -> Nothing
    Right content -> case parseValue content of
      Right (VObject m) -> case Map.lookup "delimiters" m of
        Just (VArray [ VString o, VString c ]) | validDelim o && validDelim c ->
          Just { open: o, close: c }
        _ -> Nothing
      _ -> Nothing

-- | Parse a `--delimiters` value: two space-separated, non-empty, `=`-free
-- | delimiters (per the Mustache manual), e.g. `<% %>`.
parseDelimArg :: String -> Either String { open :: String, close :: String }
parseDelimArg s = case Array.filter (_ /= "") (split (Pattern " ") s) of
  [ o, c ] | validDelim o && validDelim c -> Right { open: o, close: c }
  _ -> Left "--delimiters expects two space-separated delimiters with no '=', e.g. '<% %>'"

validDelim :: String -> Boolean
validDelim d = d /= "" && not (contains (Pattern "=") d)

firstJust :: forall a. Maybe a -> Maybe a -> Maybe a
firstJust (Just a) _ = Just a
firstJust Nothing b = b

readFileSafe :: String -> Effect (Either String String)
readFileSafe path = do
  result <- try (readTextFile UTF8 path)
  pure case result of
    Left e -> Left (message e)
    Right s -> Right s

die :: String -> Effect Unit
die msg = do
  writeStderr (msg <> "\n")
  setExitCode 1

--------------------------------------------------------------------------------
-- `flatbars examples` — the vendored example/conformance corpus
--
-- See `example-loader-spec.md`. v1 implements the headless `verify` gate for the
-- `mustache` provider: re-render each vendored fixture through MinBars and assert
-- `actual == expected` (a divergence is a conformance failure). The corpus is
-- vendored offline by `scripts/vendor-mustache.mjs`; this command never fetches.
--------------------------------------------------------------------------------

examplesUsage :: String
examplesUsage =
  joinWith "\n"
    [ "flatbars examples — vendored example/conformance corpus"
    , ""
    , "Usage:"
    , "  flatbars examples verify [--provider mustache]   re-render each fixture; assert"
    , ""
    , "verify (mustache): render template+data+partials via MinBars and assert"
    , "  actual == expected — a divergence is a conformance failure. Exit ≠ 0 on any miss."
    , "Vendor/refresh the corpus with: node scripts/vendor-mustache.mjs"
    ]

analyseUsage :: String
analyseUsage =
  joinWith "\n"
    [ "flatbars analyse — trace a render, report truthiness portability (ADR-022)"
    , ""
    , "Usage:"
    , "  flatbars analyse <template> <data.json> [--emit-jsonata]"
    , ""
    , "Renders the ClassicBars template against the data and reports every condition"
    , "whose branch would differ on another engine (Mustache, presence, …),"
    , "with a concrete fix each — and a `✓` line per portable condition."
    , "  --emit-jsonata   emit a reviewable JSONata data-cleanup scaffold instead"
    , "                   of the markdown report."
    ]

-- | `flatbars analyse <template> <data.json> [--emit-jsonata]` (ADR-022 Part B):
-- | render the ClassicBars template against the data and print a markdown report of
-- | every truthiness decision that would branch differently on another engine
-- | (with a fix each), or `--emit-jsonata` for the reviewable cleanup scaffold.
runAnalyse :: Array String -> Effect Unit
runAnalyse args
  | Array.elem "-h" args || Array.elem "--help" args = writeStdout (analyseUsage <> "\n")
  | otherwise =
      let
        emitJsonata = Array.elem "--emit-jsonata" args
        positional = Array.filter (\a -> not (isJust (stripPrefix (Pattern "--") a))) args
      in
        case positional of
          [ tplPath, dataPath ] -> do
            tplE <- readFileSafe tplPath
            case tplE of
              Left err -> die
                ("flatbars analyse: cannot read template '" <> tplPath <> "': " <> err)
              Right tpl -> do
                datE <- loadData (Just dataPath)
                case datE of
                  Left err -> die ("flatbars analyse: " <> err)
                  Right value -> case analyseSurface tpl value of
                    Left e -> die ("flatbars analyse: " <> tplPath <> ": " <> e)
                    Right r -> writeStdout ((if emitJsonata then r.jsonata else r.report) <> "\n")
          _ -> die ("flatbars analyse: expected <template> <data.json>\n\n" <> analyseUsage)

lintUsage :: String
lintUsage =
  joinWith "\n"
    [ "flatbars lint — on-demand canonicalization lints (never blocks rendering)"
    , ""
    , "Usage:"
    , "  flatbars lint <template> [--surface | --maxbars] [--max-warnings <n>]"
    , ""
    , "Reports, one warning per use:"
    , "  • deprecated aliases    e.g. `plus` → `add`, `downcase` → `lowercase`"
    , "  • scoped-variable spelling (core/MaxBars)  `index` → `index0`, `partial-block` → `yield`"
    , ""
    , "Dialect (default core/RawBars):"
    , "  -s, --surface   lint the ClassicBars surface — aliases only (the scoped-variable lint"
    , "                  is the native RawBars/MaxBars spelling, not Handlebars @index)."
    , "      --maxbars   lint MaxBars source (infix operators, pipes) — aliases + scoped,"
    , "                  plus the dialect lints: label shadow, and a boolean || / &&"
    , "                  in output position (use ?? or ?: for a value)."
    , ""
    , "Exit code:"
    , "      --max-warnings <n>   exit non-zero only if findings exceed n (default 0: any"
    , "                           finding fails, for CI gating). Use -1 for no limit"
    , "                           (report but never fail). Findings always print to stderr."
    , ""
    , "The lift/migrate assist is what rewrites these; this command only reports."
    ]

type LintArgs =
  { surface :: Boolean, maxbars :: Boolean, maxWarnings :: Int, positional :: Array String }

-- | Parse the `lint` flags: dialect (`--surface`/`--maxbars`) and `--max-warnings <n>`
-- | (default 0; `-1` = no limit). The value after `--max-warnings` is consumed here
-- | so it is not mistaken for the template path.
parseLintArgs :: Array String -> LintArgs
parseLintArgs = go { surface: false, maxbars: false, maxWarnings: 0, positional: [] }
  where
  go acc as = case Array.uncons as of
    Nothing -> acc
    Just { head, tail } -> case head of
      flag | flag == "-s" || flag == "--surface" -> go (acc { surface = true }) tail
      "--maxbars" -> go (acc { maxbars = true }) tail
      "--max-warnings" -> case Array.uncons tail of
        Just { head: v, tail: rest } -> go (acc { maxWarnings = fromMaybe 0 (Int.fromString v) })
          rest
        Nothing -> go acc tail
      other
        | isJust (stripPrefix (Pattern "-") other) -> go acc tail -- ignore unknown flags
        | otherwise -> go (acc { positional = Array.snoc acc.positional other }) tail

-- | `flatbars lint <template> [--surface | --maxbars] [--max-warnings <n>]`: run
-- | the on-demand canonicalization lints (`Linter.Aliases`) and report them. Core/
-- | RawBars by default — alias + scoped-variable (`index`→`index0`,
-- | `partial-block`→`yield`) warnings; `--surface` lints the ClassicBars surface for
-- | aliases only (the scoped-variable spelling is RawBars/MaxBars-native, not
-- | Handlebars); `--maxbars` lints MaxBars source. Findings print to stderr; the
-- | exit code is governed by `--max-warnings` (default 0 ⇒ any finding fails).
runLint :: Array String -> Effect Unit
runLint args
  | Array.elem "-h" args || Array.elem "--help" args = writeStdout (lintUsage <> "\n")
  | otherwise =
      let
        a = parseLintArgs args
      in
        if a.surface && a.maxbars then
          die "flatbars lint: choose at most one of --surface / --maxbars"
        else case a.positional of
          [ tplPath ] -> do
            tplE <- readFileSafe tplPath
            case tplE of
              Left err -> die ("flatbars lint: cannot read template '" <> tplPath <> "': " <> err)
              Right tpl ->
                let
                  popts =
                    if a.surface then defaultParseOptions
                    else if a.maxbars then maxOptions
                    else coreOptions
                in
                  case parseWith popts tpl of
                    Left pes -> die
                      ("flatbars lint: " <> tplPath <> ":" <> renderParseErrorsAt tpl pes)
                    Right { nodes } ->
                      -- The scoped-variable lint is for the native (core/MaxBars)
                      -- spelling; on the ClassicBars surface `@index`/`@partial-block`
                      -- are canonical, so run aliases only there. `--maxbars` adds
                      -- the MaxBars dialect lints (stray head bar, label shadow, and
                      -- a boolean `||`/`&&` in output position — use ?? / ?:).
                      let
                        aliasIssues =
                          aliasWarnings nodes
                            <> (if a.surface then [] else scopedCanonWarnings nodes)
                        -- MaxBars dialect lints carry no span, so format both
                        -- sources to lines and combine the strings, not the arrays.
                        maxLints =
                          if a.maxbars then case maxbarsWarnings tpl of
                            Right is -> is
                            Left _ -> []
                          else []
                        lines = map fmt aliasIssues <> map fmt maxLints
                        count = Array.length aliasIssues + Array.length maxLints
                      in
                        if count == 0 then writeStdout "ok: no lint findings\n"
                        else do
                          writeStderr (joinWith "\n" lines <> "\n")
                          -- Exit non-zero only past the threshold (-1 ⇒ never).
                          when (a.maxWarnings >= 0 && count > a.maxWarnings)
                            (setExitCode 1)
          _ -> die ("flatbars lint: expected <template>\n\n" <> lintUsage)
      where
      fmt :: forall r. { severity :: Severity, message :: String | r } -> String
      fmt issue = show issue.severity <> ": " <> issue.message

runExamples :: Array String -> Effect Unit
runExamples args = case Array.uncons args of
  Just { head: "verify", tail } -> verifyProvider (providerOf tail)
  Just { head: "-h" } -> writeStdout (examplesUsage <> "\n")
  Just { head: "--help" } -> writeStdout (examplesUsage <> "\n")
  Nothing -> writeStdout (examplesUsage <> "\n")
  Just { head: sub } -> die
    ("flatbars examples: unknown subcommand '" <> sub <> "'\n\n" <> examplesUsage)

-- | Read `--provider <id>` from the flags; default `mustache`.
providerOf :: Array String -> String
providerOf args = case Array.elemIndex "--provider" args of
  Just i -> fromMaybe "mustache" (Array.index args (i + 1))
  Nothing -> "mustache"

-- | The `verify` gate for one provider. v1 supports `mustache` (authoritative
-- | `expected`, rendered through MinBars).
verifyProvider :: String -> Effect Unit
verifyProvider provider
  | provider /= "mustache" =
      die ("flatbars examples: unsupported provider '" <> provider <> "' (only 'mustache' in v1)")
  | otherwise = do
      let base = "lab/examples/vendored/" <> provider
      files <- listFixtures base
      case files of
        [] -> die
          ( "flatbars examples: no fixtures under " <> base
              <> " — run: node scripts/vendor-mustache.mjs"
          )
        _ -> do
          results <- traverse verifyOne files
          let
            fails = Array.filter (\r -> not r.ok) results
            n = Array.length results
            passed = n - Array.length fails
          writeStderr (joinWith "" (map _.detail fails))
          writeStdout (show passed <> "/" <> show n <> " " <> provider <> " fixtures conform\n")
          when (not (Array.null fails)) (setExitCode 1)

-- | Collect every `*.json` fixture two levels down (`<base>/<category>/<name>.json`).
listFixtures :: String -> Effect (Array String)
listFixtures base = do
  catsE <- try (readdir base)
  case catsE of
    Left _ -> pure []
    Right cats -> do
      nested <- traverse (\cat -> jsonIn (base <> "/" <> cat)) cats
      pure (Array.concat nested)
  where
  jsonIn dir = do
    filesE <- try (readdir dir)
    pure case filesE of
      Left _ -> [] -- not a directory (or unreadable) — skip
      Right files ->
        map (\f -> dir <> "/" <> f)
          (Array.filter (\f -> stripSuffix (Pattern ".json") f /= Nothing) files)

type FxResult = { id :: String, ok :: Boolean, detail :: String }

-- | Verify one fixture file: read it, decode the shared fixture shape, render via
-- | MinBars, and compare against the authoritative `expected`.
verifyOne :: String -> Effect FxResult
verifyOne path = do
  txtE <- readFileSafe path
  pure case txtE of
    Left e -> fxFail path ("read error: " <> e)
    Right txt -> case parseValue txt of
      Left e -> fxFail path ("fixture JSON: " <> e)
      Right v -> case decodeFixture v of
        Nothing -> fxFail path "fixture missing template/expected"
        Just fx -> case MinBars.renderMinWith fx.partials fx.template fx.dat of
          Left err ->
            { id: fx.id
            , ok: false
            , detail: "  FAIL " <> fx.id <> "\n    render error: " <> err <> "\n"
            }
          Right out
            | out == fx.expected -> { id: fx.id, ok: true, detail: "" }
            | otherwise ->
                { id: fx.id
                , ok: false
                , detail: "  FAIL " <> fx.id <> "\n    expected " <> show fx.expected
                    <> "\n    actual   "
                    <> show out
                    <> "\n"
                }

fxFail :: String -> String -> FxResult
fxFail path msg = { id: path, ok: false, detail: "  FAIL " <> path <> "\n    " <> msg <> "\n" }

-- | Decode the fields `verify` needs from a vendored fixture `Value`.
decodeFixture
  :: Value
  -> Maybe
       { id :: String
       , template :: String
       , dat :: Value
       , partials :: Array (Tuple String String)
       , expected :: String
       }
decodeFixture v = do
  obj <- asObject v
  ident <- asString =<< Map.lookup "id" obj
  template <- asString =<< Map.lookup "template" obj
  expected <- asString =<< Map.lookup "expected" obj
  let
    dat = fromMaybe VNull (Map.lookup "data" obj)
    partials = case Map.lookup "partials" obj of
      Just (VObject pm) -> stringPairs pm
      _ -> []
  pure { id: ident, template, dat, partials, expected }

asObject :: Value -> Maybe (Map String Value)
asObject = case _ of
  VObject m -> Just m
  _ -> Nothing

asString :: Value -> Maybe String
asString = case _ of
  VString s -> Just s
  _ -> Nothing

-- | The string-valued entries of a `Value` object, as (name, source) pairs.
stringPairs :: Map String Value -> Array (Tuple String String)
stringPairs m = Array.mapMaybe pair (Map.toUnfoldable m :: Array (Tuple String Value))
  where
  pair (Tuple k val) = case val of
    VString s -> Just (Tuple k s)
    _ -> Nothing
