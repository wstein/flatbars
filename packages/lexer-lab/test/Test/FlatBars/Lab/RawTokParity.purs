-- | Phase 2/3 parity: the hand-lexer→RawTok adapter must reproduce the engine
-- | lexer's `tokenizeTemplate` output byte-for-byte (spans, bases, interiors, and
-- | `~` whitespace control). That's the migration proof: if the RawTok streams
-- | are identical, the existing `trimStandalone` + parser produce identical
-- | results — so whitespace, directives, raw blocks, and recovery are inherited.
module Test.FlatBars.Lab.RawTokParity (tests) where

import Prelude

import Data.Either (Either(..))
import Data.Foldable (for_)
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Lab.Lexer.Types (defaultLexConfig) as Lab
import FlatBars.Lab.RawTok (parse, toRawToks)
import FlatBars.Lexer (defaultLexConfig, tokenizeTemplate)
import FlatBars.Parser (defaultParseOptions, parse) as Core
import FlatBars.Syntax (Node(..))
import FlatBars.Token (defaultLexOptions)
import Test.Assert (assertTrue')

-- Erase spans so the end-to-end AST comparison is structural.
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

-- Standalone-whitespace templates: these exercise the reused `trimStandalone`
-- end-to-end (the adapter parse vs the engine parse must agree).
standaloneCorpus :: Array String
standaloneCorpus =
  [ "line1\n{{#x}}\n  body\n{{/x}}\nline2\n"
  , "{{! header }}\nbody\n"
  , "  {{#each xs}}\n    {{this}}\n  {{/each}}\n"
  , "a\n{{#if c}}\nyes\n{{else}}\nno\n{{/if}}\nb\n"
  ]

corpus :: Array String
corpus =
  [ "hello"
  , ""
  , "{{x}}"
  , "{{{x}}}"
  , "{{&x}}"
  , "a{{x}}b"
  , "before {{x}} mid {{y}} after"
  , "{{#each items}}{{this}}{{/each}}"
  , "{{^empty}}none{{/empty}}"
  , "{{#a}}{{#b}}deep{{/b}}{{/a}}"
  , "{{> partial}}"
  , "{{user.name}} and {{ items.[0] }}"
  , "{{! a short comment }}"
  , "x {{! c }} y"
  , "{{!-- a long\ncomment with }} inside --}}tail"
  -- under defaultLexConfig (mustacheDelims off) `{{=A B=}}` is a plain separator
  -- in BOTH the structural scanner and the incumbent — they agree.
  , "{{=<% %>=}}<% x %> done"
  , "{{{{raw}}}}verbatim {{x}} body{{{{/raw}}}}"
  , "x {{~ y ~}} z"
  , "a {{~#each xs}}{{this}}{{~/each}} b"
  , "p {{val~}}  trimmed-left"
  , "trimmed-right  {{~val}} q"
  , "line1\n{{#x}}\n  body\n{{/x}}\nline2"
  , "{{ greet \"hi\" 42 }}"
  , "\\{{escaped}} literal"
  ]

tests :: Effect Unit
tests = do
  log "FlatBars.Lab.RawTok — RawTok parity vs tokenizeTemplate"
  for_ corpus \src ->
    case
      toRawToks Lab.defaultLexConfig src,
      tokenizeTemplate defaultLexConfig defaultLexOptions src
      of
      Right lab, Right eng ->
        assertTrue'
          ("RawTok mismatch on " <> show src <> "\n  lab: " <> show lab <> "\n  eng: " <> show eng)
          (lab == eng)
      Left _, Left _ -> pure unit
      _, _ -> assertTrue' ("exactly one lexer errored on " <> show src) false
  log "  RawTok parity assertions passed"

  -- End-to-end: adapter parse (via trimStandalone + the engine tree builder)
  -- vs FlatBars.parse — proves standalone whitespace is handled (P2).
  for_ standaloneCorpus \src ->
    case parse Core.defaultParseOptions src, Core.parse src of
      Right lab, Right core ->
        assertTrue'
          ( "standalone AST mismatch on " <> show src <> "\n  lab:  " <> show (map norm lab.nodes)
              <> "\n  core: "
              <> show (map norm core.nodes)
          )
          (map norm lab.nodes == map norm core.nodes)
      Left _, Left _ -> pure unit
      _, _ -> assertTrue' ("exactly one parser errored on " <> show src) false
  log "  standalone end-to-end parity assertions passed"

  -- mustacheDelims ON: the structural scanner's set-delimiter + custom-delimiter
  -- path must match the incumbent with mustacheDelims on (MinBars surface).
  let
    labMustache = Lab.defaultLexConfig { mustacheDelims = true }
    engMustache = defaultLexConfig { mustacheDelims = true }
  for_ [ "{{=<% %>=}}<% x %> done", "{{=<% %>=}}<% a %>mid<% b %>", "a {{=[[ ]]=}}[[ y ]] b" ]
    \src ->
      case toRawToks labMustache src, tokenizeTemplate engMustache defaultLexOptions src of
        Right lab, Right eng ->
          assertTrue'
            ( "set-delim RawTok mismatch on " <> show src <> "\n  lab: " <> show lab <> "\n  eng: "
                <> show eng
            )
            (lab == eng)
        Left _, Left _ -> pure unit
        _, _ -> assertTrue' ("exactly one lexer errored on " <> show src) false
  log "  mustacheDelims RawTok parity assertions passed"
