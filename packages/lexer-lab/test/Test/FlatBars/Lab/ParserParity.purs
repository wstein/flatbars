-- | Phase-1 parser parity: the lab parser (over the hand lexer) must produce the
-- | same `Syntax` AST as the engine's `FlatBars.parse` on a curated corpus.
-- | Spans are erased before comparing (the lab parser tracks line/column, the
-- | engine tracks offsets; structural parity is the phase-1 target). The corpus
-- | avoids standalone/`~` whitespace, header directives, raw blocks, and
-- | recovery — all tracked for phase 2.
module Test.FlatBars.Lab.ParserParity (tests) where

import Prelude

import Data.Either (Either(..))
import Data.Foldable (for_)
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Lab.Parser (parse) as Lab
import FlatBars.Parser (parse) as Core
import FlatBars.Syntax (Node(..))
import Test.Assert (assertTrue')

-- Erase spans so comparison is structural (Eq Node compares spans).
norm :: Node -> Node
norm = case _ of
  Content s -> Content s
  Output _ e -> Output zero e
  Block _ sig n a body -> Block zero sig n a (map norm body)
  RawBlock _ n a r -> RawBlock zero n a r
  Sep _ n a -> Sep zero n a
  NodeError _ m -> NodeError zero m
  where
  zero = { start: 0, end: 0 }

corpus :: Array String
corpus =
  [ "hello"
  , ""
  , "{{{x}}}"
  , "{{x}}"
  , "{{ a b c }}"
  , "{{user.name}}"
  , "{{ items.[0] }}"
  , "{{ ../x }}"
  , "{{& raw}}"
  , "{{42}}"
  , "{{ \"hi\" }}"
  , "a{{x}}b"
  , "before {{x}} middle {{y}} after"
  , "{{> partial}}"
  , "{{> nav x=1}}"
  , "{{#each items}}{{this}}{{/each}}"
  , "{{#if c}}yes{{/if}}"
  , "{{^empty}}none{{/empty}}"
  , "{{#with user}}{{name}}{{/with}}"
  , "x {{#each xs}}<{{this}}>{{/each}} y"
  , "{{#a}}{{#b}}deep{{/b}}{{/a}}"
  , "{{ greet \"hi\" 42 }}"
  , "{{ a.b.c }}"
  ]

tests :: Effect Unit
tests = do
  log "FlatBars.Lab.Parser — AST parity vs FlatBars.parse"
  for_ corpus \src ->
    case Lab.parse src, Core.parse src of
      Right labNodes, Right core ->
        let
          l = map norm labNodes
          c = map norm core.nodes
        in
          assertTrue'
            ("parity mismatch on " <> show src <> "\n  lab:  " <> show l <> "\n  core: " <> show c)
            (l == c)
      Left _, Left _ -> pure unit
      _, _ -> assertTrue' ("exactly one parser errored on " <> show src) false
  log "  parser parity assertions passed"
