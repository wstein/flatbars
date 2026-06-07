-- | Per-surface parser parity — all four surfaces parse through the swapped
-- | lexer. The three that route through `parseWith` (FullBars
-- | `defaultParseOptions`, RawBars `coreOptions`, MaxBars `maxOptions`) are
-- | checked as `Lab.parse opts == parseWith opts`; MinBars, which runs its own
-- | `mustacheStandalone` pipeline instead, is driven the same way over the lab
-- | lexer and compared to that pipeline over the incumbent lexer. Equality holds
-- | by construction — every path shares the engine's `buildFromTokens`; only the
-- | lexer differs, and RawTok parity makes the streams identical — so this gate
-- | catches any drift.
module Test.FlatBars.Lab.DialectParity (tests) where

import Prelude

import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.Foldable (for_)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Lab.Lexer.Types (defaultLexConfig) as LT
import FlatBars.Lab.RawTok (parse, toRawToks) as Lab
import FlatBars.Lexer (defaultLexConfig, tokenizeTemplate) as E
import FlatBars.Parser (buildFromTokens, collectDirectives, defaultParseOptions, parseWith)
import FlatBars.Syntax (Node(..))
import MaxBars (maxOptions)
import MinBars (minOptions)
import MinBars.Standalone (mustacheStandalone)
import RawBars (coreOptions)
import Test.Assert (assertTrue')

norm :: Node -> Node
norm = case _ of
  Content s -> Content s
  Output _ e -> Output z e
  Block _ sig n a body -> Block z sig n a (map norm body)
  RawBlock _ n a r -> RawBlock z n a r
  Sep _ n a -> Sep z n a
  NodeError _ m -> NodeError z m
  where
  z = { start: 0, end: 0 }

-- A mixed corpus: valid and dialect-disallowed shapes, multiline/standalone,
-- raw blocks (both spellings), set-delimiters, infix/pipe. Each dialect accepts
-- or rejects per its options; the lab parse must agree with the engine either way.
corpus :: Array String
corpus =
  [ "{{x}}"
  , "{{{x}}}"
  , "{{&x}}"
  , "x {{y}} z"
  , "{{a.b.c}}"
  , "{{#each items}}{{this}}{{/each}}"
  , "{{#if c}}a{{else}}b{{/if}}"
  , "{{^e}}n{{/e}}"
  , "{{> p}}"
  , "{{{{raw}}}}body {{x}}{{{{/raw}}}}"
  , "{{{{#raw}}}}body{{{{/raw}}}}"
  , "{{=<% %>=}}<% y %> tail"
  , "{{ a + b }}"
  , "{{ x | upper }}"
  , "{{ a && b }}"
  , "line1\n{{#x}}\n  body\n{{/x}}\nline2\n"
  ]

tests :: Effect Unit
tests = do
  log "FlatBars.Lab.RawTok — per-dialect parse parity vs parseWith"
  for_
    [ Tuple "FullBars" defaultParseOptions
    , Tuple "RawBars" coreOptions
    , Tuple "MaxBars" maxOptions
    ]
    \(Tuple name opts) ->
      for_ corpus \src ->
        case Lab.parse opts src, parseWith opts src of
          Right lab, Right eng ->
            assertTrue'
              ( name <> " parse mismatch on " <> show src <> "\n  lab:  "
                  <> show (map norm lab.nodes)
                  <> "\n  eng: "
                  <> show (map norm eng.nodes)
              )
              (map norm lab.nodes == map norm eng.nodes)
          Left _, Left _ -> pure unit
          _, _ -> assertTrue' (name <> ": exactly one parser errored on " <> show src) false
  log "  per-dialect parse parity assertions passed"

  -- MinBars routes through its OWN pipeline (mustacheStandalone, not
  -- trimStandalone), so drive that with the lab lexer and compare to the same
  -- pipeline over the incumbent lexer — the migration claim for the 4th surface.
  let
    -- = MinBars.minLexConfig (unexported): the default pair with set-delimiters on.
    minLab = LT.defaultLexConfig { mustacheDelims = true }
    minEng = E.defaultLexConfig { mustacheDelims = true }
    labMin src = do
      raw <- Lab.toRawToks minLab src
      _ <- collectDirectives raw
      lmap NEA.head (buildFromTokens minOptions (mustacheStandalone minOptions.lexOptions raw))
    engMin src = do
      toks <- E.tokenizeTemplate minEng minOptions.lexOptions src
      _ <- collectDirectives toks
      lmap NEA.head (buildFromTokens minOptions (mustacheStandalone minOptions.lexOptions toks))
  for_ minbarsCorpus \src ->
    case labMin src, engMin src of
      Right lab, Right eng ->
        assertTrue'
          ( "MinBars parse mismatch on " <> show src <> "\n  lab:  " <> show (map norm lab)
              <> "\n  eng: "
              <> show (map norm eng)
          )
          (map norm lab == map norm eng)
      Left _, Left _ -> pure unit
      _, _ -> assertTrue' ("MinBars: exactly one parser errored on " <> show src) false
  log "  MinBars parse parity (mustacheStandalone) assertions passed"

minbarsCorpus :: Array String
minbarsCorpus =
  [ "{{x}}"
  , "{{{x}}}"
  , "{{&x}}"
  , "Hello {{name}}!"
  , "{{#person}}{{name}}{{/person}}"
  , "{{^empty}}none{{/empty}}"
  , "{{> partial}}"
  , "{{< base}}{{$body}}hi{{/body}}{{/base}}"
  , "{{=<% %>=}}<% y %> tail"
  , "{{! a comment }}"
  , "begin\n{{#section}}\n  {{item}}\n{{/section}}\nend\n"
  , "  {{! standalone comment }}\nbody\n"
  ]
