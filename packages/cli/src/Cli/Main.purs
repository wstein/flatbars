-- | `barebars` — a command-line renderer for BareBars core templates.
-- |
-- | Usage:
-- |
-- | ```text
-- | barebars <template.bars> [--data <data.json>] [--validate | --compile] [--help]
-- | ```
-- |
-- | Renders a template against JSON data using the reference prelude, writing
-- | the result to stdout. Core syntax by default; `--surface` reads the
-- | Handlebars-flavoured surface dialect. With `--validate` it runs the
-- | skeleton-AST validation pass instead; with `--compile` it emits a JS module
-- | (`BareBars.Compile`, honouring `--surface`) to stdout — pair it with
-- | `barebars-runtime.mjs`.
module Cli.Main where

import Prelude

import BareBars (ParseOptions, defaultParseOptions, parseWith, renderParseErrorAt, validate)
import BareBars.Compile.FullBars (compileCoreWith, compileSurfaceWith) as Compile
import BareBars.Json (parseValue)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Either (Either(..))
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String (joinWith)
import Effect (Effect)
import Effect.Exception (message, try)
import FullBars (compileWith, directiveLints, preludeSchema, renderSurfaceDiagWith)
import Node.Encoding (Encoding(..))
import Node.FS.Sync (readTextFile)

foreign import argv :: Effect (Array String)
foreign import writeStdout :: String -> Effect Unit
foreign import writeStderr :: String -> Effect Unit
foreign import setExitCode :: Int -> Effect Unit

usage :: String
usage =
  joinWith "\n"
    [ "barebars — render a BareBars core template"
    , ""
    , "Usage:"
    , "  barebars <template> [--data <data.json>] [--validate | --compile]"
    , ""
    , "Options:"
    , "  -d, --data <file>   JSON data file (default: null context)"
    , "  -s, --surface       read the template in the surface dialect ({{ name }}, paths, @data,"
    , "                      as |x|) instead of core syntax — applies to render and --compile"
    , "      --validate      validate the template against the prelude schema; do not render"
    , "  -c, --compile       compile the template to a JS module (printed to stdout); do not render"
    , "      --trim <mode>   standalone whitespace: 'standalone' (default) strips a lone block/"
    , "                      comment line; 'none' keeps it. Overrides barebars.json; a @trim"
    , "                      directive in the template overrides both."
    , "  -h, --help          show this help"
    , ""
    , "Config: a barebars.json in the working directory may set { \"trim\": \"standalone\" | \"none\" }."
    , "Core syntax: {{{ lookup this \"x\" }}}, {{#each …}}, …. Surface (--surface): {{ x }}, a.b.c, …."
    , "The compiled module's default export is `function (data, rt)`; pair it with"
    , "the runtime at packages/compile/runtime/barebars-runtime.mjs."
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
  , trim :: Maybe Boolean -- --trim override; Nothing ⇒ config/default decides
  }

main :: Effect Unit
main = do
  args <- Array.drop 2 <$> argv
  case parseArgs args of
    Help -> writeStdout (usage <> "\n")
    Invalid msg -> die ("barebars: " <> msg <> "\n\n" <> usage)
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
    , trim: Nothing
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
        , trim: acc.trim
        }
      Nothing -> Help
    Just { head, tail } -> case head of
      "-h" -> Help
      "--help" -> Help
      "--validate" -> go (acc { validateOnly = true }) tail
      flag | flag == "-c" || flag == "--compile" -> go (acc { compileOnly = true }) tail
      flag | flag == "-s" || flag == "--surface" -> go (acc { surface = true }) tail
      "--trim" -> case Array.uncons tail of
        Just { head: "standalone", tail: rest } -> go (acc { trim = Just true }) rest
        Just { head: "none", tail: rest } -> go (acc { trim = Just false }) rest
        Just _ -> Invalid "--trim expects 'standalone' or 'none'"
        Nothing -> Invalid "--trim requires a value ('standalone' or 'none')"
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
    Left err -> die ("barebars: cannot read template '" <> opts.template <> "': " <> err)
    Right tpl -> do
      -- precedence: --trim flag > barebars.json > built-in default (on).
      configTrim <- loadConfigTrim
      let
        popts = defaultParseOptions
          { trimStandalone = fromMaybe true (firstJust opts.trim configTrim) }
      if opts.compileOnly then runCompile popts opts tpl
      else if opts.validateOnly then runValidate popts tpl
      else do
        datE <- loadData opts.dataFile
        case datE of
          Left err -> die ("barebars: " <> err)
          Right value
            | opts.surface -> case renderSurfaceDiagWith popts tpl value of
                Left err -> die ("barebars: " <> opts.template <> ": " <> err)
                Right out -> writeStdout out
            | otherwise -> case compileWith popts tpl of
                Left pe -> die ("barebars: " <> opts.template <> ":" <> renderParseErrorAt tpl pe)
                Right render -> case render value of
                  Left err -> die ("barebars: " <> show err)
                  Right out -> writeStdout out

-- | Compile a template to a JS ES module and print it to stdout (surface or core).
runCompile :: ParseOptions -> Options -> String -> Effect Unit
runCompile popts opts tpl =
  case (if opts.surface then Compile.compileSurfaceWith else Compile.compileCoreWith) popts tpl of
    Left pe -> die ("barebars: " <> opts.template <> ":" <> renderParseErrorAt tpl pe)
    Right js -> writeStdout js

-- | Run the skeleton-AST validation pass + directive lints and report issues.
runValidate :: ParseOptions -> String -> Effect Unit
runValidate popts tpl = case parseWith popts tpl of
  Left err -> die ("barebars: parse error at " <> renderParseErrorAt tpl err)
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

-- | Read the standalone-trim setting from `barebars.json` in the working
-- | directory, if present: `{ "trim": "standalone" | "none" }`. A missing/
-- | unreadable/malformed file or absent key yields `Nothing` (use the default).
loadConfigTrim :: Effect (Maybe Boolean)
loadConfigTrim = do
  e <- readFileSafe "barebars.json"
  pure case e of
    Left _ -> Nothing
    Right content -> case parseValue content of
      Right (VObject m) -> case Map.lookup "trim" m of
        Just (VString "standalone") -> Just true
        Just (VString "none") -> Just false
        _ -> Nothing
      _ -> Nothing

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
