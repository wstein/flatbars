-- | The unified tokenizer: one place that turns source into a stream carrying
-- | both the structural shape *and* each tag's pre-lexed interior tokens.
-- |
-- | The engine has two lexical primitives — `FlatBars.Lexer.tokenizeTemplate`
-- | (structural: delimits tags into `RawTok`, interiors left opaque) and
-- | `FlatBars.Token.tokenizeInterior` (lexes one tag interior into `PosToken`s).
-- | Historically the parser and the editor highlighter each *independently*
-- | composed the two — structural scan, then a per-tag interior re-lex — so the
-- | "interior tokenizer" ran twice over the same source for the same tags, once
-- | per consumer, with no shared guarantee they agreed.
-- |
-- | This module is that composition, written once. `attachInteriors` pairs every
-- | `RawTok` with its interior tokenization (an `ITok`); the parser and the
-- | highlighter both consume `ITok`, so they cannot drift on how an interior is
-- | lexed. The structural skeleton stays meaning-free (it is still exactly
-- | `tokenizeTemplate`); interior operator-carving stays `infixArith`-driven
-- | (it is still exactly `tokenizeInterior` with the dialect's `LexOptions`).
-- |
-- | The interior is kept as `Either ParseError (Array PosToken)` — the *deferred*
-- | result, not a flattened success — so a malformed interior in one tag rides
-- | inside that tag rather than aborting the whole scan; the recovering parser
-- | (ADR-023) handles the `Left` per tag exactly as it did when it called
-- | `tokenizeInterior` itself.
module FlatBars.Tokenizer
  ( Interior
  , ITok
  , attachInteriors
  , attach
  , tokenizeWithInteriors
  ) where

import Prelude

import Data.Either (Either(..))
import FlatBars.Error (ParseError)
import FlatBars.Lexer (LexConfig, RawTok(..), tokenizeTemplate)
import FlatBars.Token (LexOptions, PosToken, tokenizeInterior)

-- | A tag interior, pre-lexed: either its `PosToken` stream or the interior lex
-- | error (deferred to the tree builder, so it never breaks the structural scan).
-- | A token with no interior expression (`RContent`, `RComment`, `RSetDelim`,
-- | `RLongComment`) carries `Right []`.
type Interior = Either ParseError (Array PosToken)

-- | A `RawTok` paired with its pre-lexed interior. `raw` keeps the verbatim
-- | interior `String` (directive lifting, standalone head-words, and raw-block
-- | close-matching still read it); `interior` is what the expression grammars and
-- | the highlighter consume instead of re-lexing.
type ITok = { raw :: RawTok, interior :: Interior }

-- | Tokenize a template end to end: structural scan, then attach each tag's
-- | interior tokens. The single producer both the parser and highlighter use.
tokenizeWithInteriors
  :: LexConfig -> LexOptions -> String -> Either ParseError (Array ITok)
tokenizeWithInteriors cfg lx src = map (attachInteriors lx) (tokenizeTemplate cfg src)

-- | Attach interior tokens to an already-structurally-scanned stream. Kept
-- | separate so a dialect that interposes its own token-stream pass (e.g. MinBars'
-- | Mustache standalone/partial-indent rewrite, which *mutates* interiors) can run
-- | that pass first and have interiors computed from the final strings.
attachInteriors :: LexOptions -> Array RawTok -> Array ITok
attachInteriors lx = map (attach lx)

-- | Pair one `RawTok` with its interior. Expression-bearing tags tokenize their
-- | interior (raw blocks tokenize their *head*, matching what `headed` consumed);
-- | everything else carries `Right []`.
attach :: LexOptions -> RawTok -> ITok
attach lx raw = { raw, interior: interiorOf lx raw }

interiorOf :: LexOptions -> RawTok -> Interior
interiorOf lx = case _ of
  ROutput _ base s -> tokenizeInterior lx base s
  RAmp _ base s -> tokenizeInterior lx base s
  ROpen _ _ base s -> tokenizeInterior lx base s
  RClose _ base s -> tokenizeInterior lx base s
  RSep _ base s -> tokenizeInterior lx base s
  RRaw _ _ base head _ -> tokenizeInterior lx base head
  _ -> Right []
