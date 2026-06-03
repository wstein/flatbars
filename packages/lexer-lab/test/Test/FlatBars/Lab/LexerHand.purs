-- | Tests for the hand-written lexer (the second lab). A few direct
-- | lexeme-sequence smoke checks, then the main event: a **parity** battery
-- | asserting the hand lexer and the parsing spike agree token-for-token
-- | (lexeme, span with line/column, and leading trivia) on every input — or
-- | both reject it. That single `==` over `Array LexToken` is what lets the
-- | hand lexer borrow the parsing spike's 23-case correctness for free.
module Test.FlatBars.Lab.LexerHand (tests) where

import Prelude

import Data.Either (Either(..))
import Data.Foldable (for_)
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Lab.Lexer (Lexeme(..), Sigil(..), defaultLexConfig)
import FlatBars.Lab.Lexer as PL
import FlatBars.Lab.LexerHand as H
import Test.Assert (assertEqual, assertTrue')

cfg :: { close :: String, infixArith :: Boolean, open :: String }
cfg = defaultLexConfig

arith :: { close :: String, infixArith :: Boolean, open :: String }
arith = defaultLexConfig { infixArith = true }

seqH :: { close :: String, infixArith :: Boolean, open :: String } -> String -> Array Lexeme
seqH c s = case H.tokenize c s of
  Right t -> PL.lexemes t
  Left _ -> []

-- Assert the two lexers produce identical token streams, or both reject.
parity :: { close :: String, infixArith :: Boolean, open :: String } -> String -> Effect Unit
parity c input = case PL.tokenize c input, H.tokenize c input of
  Right a, Right b -> assertTrue' ("parity mismatch on " <> show input) (a == b)
  Left _, Left _ -> pure unit
  _, _ -> assertTrue' ("parity: exactly one lexer rejected " <> show input) false

-- A battery exercising every form, including multiline (span/line-column
-- parity) and inputs both lexers must reject.
battery :: Array String
battery =
  [ "{{name}}"
  , "{{{name}}}"
  , "{{#each items}}"
  , "{{> partial}}"
  , "{{#> block}}"
  , "{{ items.[0] }}"
  , "{{ (now) }}"
  , "{{ greet \"hi\\n\" }}"
  , "{{ n -3.5 }}"
  , "{{ ../x }}"
  , "{{! hi }}"
  , "{{!-- a }} b --}}"
  , "{{~ x ~}}"
  , "hi {{x}}!"
  , "{{   x   }}"
  , "{{=<% %>=}}<% x %>"
  , "\\{{x}}"
  , "{{{{raw}}}}{{x}}{{{{/raw}}}}"
  , ""
  , "{{}}"
  , "{{!}}"
  , "{{ 1.5 }}"
  , "a\n{{x}}"
  , "a\r\n{{x}}"
  , "{{=<%\t%>=}}"
  , "{{{{ raw }}}}B{{{{/raw}}}}"
  , "{{ key=value }}"
  , "line1\n{{a}}\nline2 {{b.c}}\t{{#x}}\n  {{y}}\n{{/x}} tail"
  , "{{ {x} }}" -- both reject
  , "{{ x" -- both reject
  , "{{!-- unterminated"
  ]

arithBattery :: Array String
arithBattery =
  [ "{{ a && b }}"
  , "{{ a || b }}"
  , "{{ a == b }}"
  , "{{ a != b }}"
  , "{{ a <= b }}"
  , "{{ x + y * z }}"
  , "{{ a ?? b }}"
  , "{{ a | upper }}"
  , "{{ -5 }}"
  ]

tests :: Effect Unit
tests = do
  log "FlatBars.Lab.LexerHand — hand-written lexer"

  -- Direct smoke (Lexeme has Show, so assertEqual works here).
  assertEqual
    { actual: seqH cfg "{{#each items}}"
    , expected: [ Open, Sigil Section, Ident "each", Ident "items", CloseTag ]
    }
  assertEqual
    { actual: seqH cfg "{{=<% %>=}}<% x %>"
    , expected: [ SetDelimiter "<%" "%>", Open, Ident "x", CloseTag ]
    }
  case H.tokenize cfg "hi {{x}}!" of
    Right toks -> assertEqual
      { actual: map _.lexeme toks, expected: [ Open, Ident "x", CloseTag, Eof ] }
    Left _ -> assertTrue' "hand lexer should lex case" false

  -- Parity: the hand lexer must match the parsing spike on everything.
  for_ battery (parity cfg)
  for_ arithBattery (parity arith)

  log "  hand lexer + parity assertions passed"
