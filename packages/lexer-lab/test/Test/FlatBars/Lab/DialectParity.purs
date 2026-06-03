-- | Per-surface parser parity: `FlatBars.Lab.RawTok.parse opts` must equal the
-- | engine's `FlatBars.parseWith opts` for each dialect's own `ParseOptions`
-- | (FullBars `defaultParseOptions`, RawBars `coreOptions`, MaxBars `maxOptions`)
-- | — proving all four surfaces that route through `parseWith` parse through the
-- | swapped lexer too. (MinBars is excluded: it uses its own standalone pipeline,
-- | not `parseWith`.) Equality holds by construction — both paths share the
-- | engine's `buildFromTokens`; only the lexer differs, and RawTok parity makes
-- | the streams identical — so this gate catches any drift.
module Test.FlatBars.Lab.DialectParity (tests) where

import Prelude

import Data.Either (Either(..))
import Data.Foldable (for_)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Lab.RawTok (parse) as Lab
import FlatBars.Parser (defaultParseOptions, parseWith)
import FlatBars.Syntax (Node(..))
import MaxBars (maxOptions)
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
