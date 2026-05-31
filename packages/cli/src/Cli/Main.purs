-- | `barebars` — a command-line renderer for BareBars core templates.
-- |
-- | Usage:
-- |
-- | ```text
-- | barebars <template.bars> [--data <data.json>] [--validate] [--help]
-- | ```
-- |
-- | Renders a *core-syntax* template against JSON data using the reference
-- | prelude, writing the result to stdout. With `--validate` it instead runs
-- | the skeleton-AST validation pass and reports any issues.
module Cli.Main where

import Prelude

import BareBars (parse, renderParseErrorAt, validate)
import BareBars.Json (parseValue)
import BareBars.Value (Value(..))
import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.String (joinWith)
import Effect (Effect)
import Effect.Exception (message, try)
import FlatBars (compile, preludeSchema)
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
    , "  barebars <template> [--data <data.json>] [--validate]"
    , ""
    , "Options:"
    , "  -d, --data <file>   JSON data file (default: null context)"
    , "      --validate      validate the template against the prelude schema; do not render"
    , "  -h, --help          show this help"
    , ""
    , "Templates use core syntax: {{{ lookup this \"x\" }}}, {{#each …}}, …."
    ]

data Mode
  = Help
  | Invalid String
  | Run Options

type Options =
  { template :: String
  , dataFile :: Maybe String
  , validateOnly :: Boolean
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
parseArgs = go { template: Nothing, dataFile: Nothing, validateOnly: false }
  where
  go acc args = case Array.uncons args of
    Nothing -> case acc.template of
      Just template -> Run { template, dataFile: acc.dataFile, validateOnly: acc.validateOnly }
      Nothing -> Help
    Just { head, tail } -> case head of
      "-h" -> Help
      "--help" -> Help
      "--validate" -> go (acc { validateOnly = true }) tail
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
    Right tpl ->
      if opts.validateOnly then runValidate tpl
      else do
        datE <- loadData opts.dataFile
        case datE of
          Left err -> die ("barebars: " <> err)
          Right value -> case compile tpl of
            Left pe -> die ("barebars: " <> opts.template <> ":" <> renderParseErrorAt tpl pe)
            Right render -> case render value of
              Left err -> die ("barebars: " <> show err)
              Right out -> writeStdout out

-- | Run the skeleton-AST validation pass and report issues.
runValidate :: String -> Effect Unit
runValidate tpl = case parse tpl of
  Left err -> die ("barebars: parse error at " <> renderParseErrorAt tpl err)
  Right template -> case validate preludeSchema template of
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
