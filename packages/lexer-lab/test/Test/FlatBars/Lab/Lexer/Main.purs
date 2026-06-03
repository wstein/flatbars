-- | Tests for the standalone lexer spike. Each case asserts the lexeme sequence
-- | and, where it is the point, the leading-trivia attachment, the EOF token,
-- | and the stateful set-delimiter switch.
module Test.FlatBars.Lab.Lexer.Main where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Lab.Lexer
  ( Lexeme(..)
  , Sigil(..)
  , Trivia(..)
  , defaultLexConfig
  , lexemes
  , lspEmits
  , semanticTokenType
  , tokenize
  )
import Test.Assert (assertEqual, assertTrue')
import Test.FlatBars.Lab.LexerHand as LexerHand

cfg :: { close :: String, infixArith :: Boolean, open :: String }
cfg = defaultLexConfig

arith :: { close :: String, infixArith :: Boolean, open :: String }
arith = defaultLexConfig { infixArith = true }

-- The lexeme sequence (trivia/EOF dropped) for a successful lex; `[]` on error.
seqOf :: { close :: String, infixArith :: Boolean, open :: String } -> String -> Array Lexeme
seqOf c src = case tokenize c src of
  Right toks -> lexemes toks
  Left _ -> []

main :: Effect Unit
main = do
  log "FlatBars.Lab.Lexer — standalone spike"

  -- 1. The headline tokens: {{ vs {{{ vs the close braces.
  assertEqual
    { actual: seqOf cfg "{{name}}"
    , expected: [ Open, Ident "name", CloseTag ]
    }
  assertEqual
    { actual: seqOf cfg "{{{name}}}"
    , expected: [ OpenTriple, Ident "name", CloseTriple ]
    }

  -- 2. Sigils are their own lexemes, distinct from the head ident.
  assertEqual
    { actual: seqOf cfg "{{#each items}}"
    , expected: [ Open, Sigil Section, Ident "each", Ident "items", CloseTag ]
    }
  assertEqual
    { actual: seqOf cfg "{{> partial}}"
    , expected: [ Open, Sigil Partial, Ident "partial", CloseTag ]
    }
  assertEqual
    { actual: seqOf cfg "{{#> block}}"
    , expected: [ Open, Sigil PartialBlock, Ident "block", CloseTag ]
    }

  -- 3. Brackets and parens break out of the path (a deliberate divergence).
  assertEqual
    { actual: seqOf cfg "{{ items.[0] }}"
    , expected: [ Open, Ident "items.", LBracket, Num 0.0, RBracket, CloseTag ]
    }
  assertEqual
    { actual: seqOf cfg "{{ (now) }}"
    , expected: [ Open, LParen, Ident "now", RParen, CloseTag ]
    }

  -- 4. Literals: strings (with escapes) and numbers (incl. negative).
  assertEqual
    { actual: seqOf cfg "{{ greet \"hi\\n\" }}"
    , expected: [ Open, Ident "greet", Str "hi\n", CloseTag ]
    }
  assertEqual
    { actual: seqOf cfg "{{ n -3.5 }}"
    , expected: [ Open, Ident "n", Num (-3.5), CloseTag ]
    }

  -- 5. Operators only under infixArith; otherwise `-`/`/` stay path chars.
  assertEqual
    { actual: seqOf arith "{{ a && b }}"
    , expected: [ Open, Ident "a", Op "&&", Ident "b", CloseTag ]
    }
  assertEqual
    { actual: seqOf cfg "{{ ../x }}"
    , expected: [ Open, Ident "../x", CloseTag ]
    }

  -- 6. Comments collapse to one lexeme; long vs short both work.
  assertEqual
    { actual: seqOf cfg "{{! hi }}"
    , expected: [ Comment " hi " ]
    }
  assertEqual
    { actual: seqOf cfg "{{!-- a }} b --}}"
    , expected: [ Comment " a }} b " ]
    }

  -- 7. Trim markers.
  assertEqual
    { actual: seqOf cfg "{{~ x ~}}"
    , expected: [ Open, Trim, Ident "x", Trim, CloseTag ]
    }

  -- 8. Ocean is leading `Text` trivia; inner gaps are `Whitespace` trivia.
  case tokenize cfg "hi {{x}}!" of
    Left _ -> assertTrue' "case 8 should lex" false
    Right toks -> do
      assertEqual { actual: map _.lexeme toks, expected: [ Open, Ident "x", CloseTag, Eof ] }
      -- the leading `Text "hi "` is attached to the first `{{`
      assertEqual
        { actual: (Array.head toks >>= \t -> Array.head t.leading) <#> _.value
        , expected: Just (Text "hi ")
        }
      -- the trailing ocean `"!"` rides on the EOF token
      assertEqual
        { actual: (Array.last toks >>= \t -> Array.head t.leading) <#> _.value
        , expected: Just (Text "!")
        }

  -- 9. Inner whitespace is trivia (so `{{ x }}` and `{{x}}` agree on lexemes).
  assertEqual
    { actual: seqOf cfg "{{   x   }}"
    , expected: [ Open, Ident "x", CloseTag ]
    }

  -- 10. Stateful set-delimiter: the switch changes how following tags lex.
  assertEqual
    { actual: seqOf cfg "{{=<% %>=}}<% x %>"
    , expected: [ SetDelimiter "<%" "%>", Open, Ident "x", CloseTag ]
    }

  -- 11. Backslash-escaped opener becomes literal ocean text (no tag).
  case tokenize cfg "\\{{x}}" of
    Left _ -> assertTrue' "case 11 should lex" false
    Right toks -> do
      assertEqual { actual: map _.lexeme toks, expected: [ Eof ] }
      assertEqual
        { actual: (Array.head toks >>= \t -> Array.head t.leading) <#> _.value
        , expected: Just (Text "{{x}}")
        }

  -- 12. Raw block: coarse fences + verbatim body.
  assertEqual
    { actual: seqOf cfg "{{{{raw}}}}{{x}}{{{{/raw}}}}"
    , expected: [ OpenRaw, RawBody "{{x}}", CloseRaw ]
    }

  -- 13. Empty input still yields the EOF token (with no leading trivia).
  case tokenize cfg "" of
    Left _ -> assertTrue' "case 13 should lex" false
    Right toks -> assertEqual { actual: map _.lexeme toks, expected: [ Eof ] }

  -- 14. The LSP feed: literals/operators/set-delimiters are emitted as
  -- corrections; structural braces are not. Idents map to `variable`.
  assertEqual { actual: semanticTokenType (Str "x"), expected: Just "string" }
  assertEqual { actual: semanticTokenType (Sigil Partial), expected: Just "macro" }
  assertEqual { actual: semanticTokenType Open, expected: Nothing }
  assertTrue' "operator is emitted" (lspEmits (Op "=="))
  assertTrue' "open brace is not emitted" (not (lspEmits Open))

  -- 15. An unterminated tag is a lexical error.
  case tokenize cfg "{{ x" of
    Left _ -> pure unit
    Right _ -> assertTrue' "case 15 should be an error" false

  -- ---- P4: adversarial / edge cases ----

  -- 16. Empty interior still pairs the delimiters.
  assertEqual { actual: seqOf cfg "{{}}", expected: [ Open, CloseTag ] }

  -- 17. A stray brace inside a tag is a lexical error (no token matches `{`).
  case tokenize cfg "{{ {x} }}" of
    Left _ -> pure unit
    Right _ -> assertTrue' "case 17 should be an error" false

  -- 18. CRLF survives intact inside the ocean trivia.
  case tokenize cfg "a\r\n{{x}}" of
    Left _ -> assertTrue' "case 18 should lex" false
    Right toks -> do
      assertEqual { actual: lexemes toks, expected: [ Open, Ident "x", CloseTag ] }
      assertEqual
        { actual: (Array.head toks >>= \t -> Array.head t.leading) <#> _.value
        , expected: Just (Text "a\r\n")
        }

  -- 19. A tab between set-delimiter words is normalised (not two empty words).
  assertEqual
    { actual: seqOf cfg "{{=<%\t%>=}}"
    , expected: [ SetDelimiter "<%" "%>" ]
    }

  -- 20. A raw-block head with surrounding spaces still name-matches its close.
  assertEqual
    { actual: seqOf cfg "{{{{ raw }}}}B{{{{/raw}}}}"
    , expected: [ OpenRaw, RawBody "B", CloseRaw ]
    }

  -- 21. An empty short comment.
  assertEqual { actual: seqOf cfg "{{!}}", expected: [ Comment "" ] }

  -- 22. A fractional literal.
  assertEqual { actual: seqOf cfg "{{ 1.5 }}", expected: [ Open, Num 1.5, CloseTag ] }

  -- 23. P3: spans carry line/column, not just an offset. After a newline the
  -- `{{` opener sits at index 2, line 2, column 1.
  case tokenize cfg "a\n{{x}}" of
    Left _ -> assertTrue' "case 23 should lex" false
    Right toks ->
      assertEqual
        { actual: (Array.head toks) <#> _.span.start
        , expected: Just { index: 2, line: 2, column: 1 }
        }

  log "  all lexer-lab assertions passed"

  -- The hand-written lexer's own suite + parity against this parsing spike.
  LexerHand.tests
