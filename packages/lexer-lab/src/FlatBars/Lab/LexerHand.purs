-- | A *hand-written* counterpart to `FlatBars.Lab.Lexer` — the second lab.
-- |
-- | Same token model (it reuses `Lexeme`/`Trivia`/`Span`/`LexToken` from the
-- | parsing spike), same rules, same leading-only trivia + synthetic `Eof`,
-- | same stateful set-delimiters — but driven by a tail-recursive index scan
-- | over a `Char` array instead of `purescript-parsing`. The point is a head-to-
-- | head: does dropping the combinator machinery recover the throughput the
-- | benchmark showed the parsing spike giving up (~4× on tag-bearing input)?
-- |
-- | It mirrors `FlatBars.Lexer`'s technique (index slicing, `Array.unsafeIndex`
-- | on the hot path, a reversed-`List` accumulator) and reproduces `parsing`'s
-- | exact line/column rules, so a parity test can assert the two lexers agree
-- | token-for-token (lexemes, trivia, and spans) on ASCII input.
module FlatBars.Lab.LexerHand
  ( LexError(..)
  , tokenize
  , tokenizeRecovering
  ) where

import Prelude

import Data.Array as Array
import Data.Char (toCharCode)
import Data.Either (Either(..))
import Data.Foldable (foldl)
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..), maybe)
import Data.Number as Number
import Data.String.CodeUnits as SCU
import Data.Tuple (Tuple(..))
import FlatBars.Lab.Lexer.Types
  ( LexConfig
  , LexToken
  , Lexeme(..)
  , Piece(..)
  , Sigil(..)
  , SourcePos
  , Trivia(..)
  , assemble
  , firstWord
  , identChar
  , isDigit
  , isSpace
  , unescape
  , words
  )
import Partial.Unsafe (unsafePartial)

-- | A lexical error: a message and the source position it occurred at.
data LexError = LexError String SourcePos

lexErrorMsg :: LexError -> String
lexErrorMsg (LexError m _) = m

derive instance eqLexError :: Eq LexError

instance showLexError :: Show LexError where
  show (LexError m p) = "LexError " <> show m <> " @" <> show p.index

-- | Result of a reader: the pieces it produced (in order), the index/position
-- | just past it, and the (possibly changed) active delimiter pair.
type Step = { pieces :: Array Piece, i :: Int, pos :: SourcePos, open :: String, close :: String }

-- | Strict: a lexical error is fatal (`Left`). Used by the parity test.
tokenize :: LexConfig -> String -> Either LexError (Array LexToken)
tokenize cfg src = map toTokens (run false cfg src)

-- | Forgiving (ADR-023): never fails. A malformed tag becomes an `Invalid`
-- | lexeme spanning its opener, and lexing resyncs just past it — so an LSP
-- | still highlights everything around a half-typed `{{`. This is what the
-- | wiring in `lsp.mjs` consumes.
tokenizeRecovering :: LexConfig -> String -> Array LexToken
tokenizeRecovering cfg src = case run true cfg src of
  Right pieces -> toTokens pieces
  Left _ -> [] -- unreachable: recovery never returns Left

-- | `run` accumulates pieces reversed; reverse to source order, then fold to
-- | tokens with the shared `assemble`.
toTokens :: List Piece -> Array LexToken
toTokens = assemble <<< Array.fromFoldable <<< List.reverse

run :: Boolean -> LexConfig -> String -> Either LexError (List Piece)
run recover cfg src = go 0 origin cfg.open cfg.close Nil
  where
  cs = SCU.toCharArray src
  len = Array.length cs
  arith = cfg.infixArith
  mustache = cfg.mustacheDelims
  origin = { index: 0, line: 1, column: 1 }

  -- Unsafe read on the hot path; only called with `i < len` established.
  at :: Int -> Char
  at i = unsafePartial (Array.unsafeIndex cs i)

  -- Safe lookahead (may be past the end).
  peek :: Int -> Maybe Char
  peek = Array.index cs

  sliceStr :: Int -> Int -> String
  sliceStr a b = SCU.fromCharArray (Array.slice a b cs)

  -- Does `pat` occur at `i`? No slice allocation (unlike `Array.slice … == …`).
  matchAt :: Int -> Array Char -> Boolean
  matchAt i pat = chk 0
    where
    plen = Array.length pat
    chk j
      | j >= plen = true
      | otherwise = case peek (i + j) of
          Just c | c == unsafePartial (Array.unsafeIndex pat j) -> chk (j + 1)
          _ -> false

  -- Advance one source position over `cs[k]`, matching `parsing`'s rules.
  step1 :: SourcePos -> Int -> SourcePos
  step1 p k = case toCharCode (at k) of
    10 -> { index: p.index + 1, line: p.line + 1, column: 1 } -- \n
    13 -> case peek (k + 1) of -- \r
      Just c | toCharCode c == 10 -> { index: p.index + 1, line: p.line, column: p.column }
      _ -> { index: p.index + 1, line: p.line + 1, column: 1 }
    9 -> { index: p.index + 1, line: p.line, column: p.column + 8 - ((p.column - 1) `mod` 8) } -- \t
    _ -> { index: p.index + 1, line: p.line, column: p.column + 1 }

  advance :: SourcePos -> Int -> Int -> SourcePos
  advance p a b
    | a >= b = p
    | otherwise = advance (step1 p a) (a + 1) b

  --------------------------------------------------------------------------
  -- Main loop: tag or ocean, accumulating pieces in a reversed list.
  --------------------------------------------------------------------------
  go :: Int -> SourcePos -> String -> String -> List Piece -> Either LexError (List Piece)
  go i pos open close acc
    | i >= len = Right acc
    | matchAt i (SCU.toCharArray open) = case readTag i pos open close of
        Right s -> go s.i s.pos s.open s.close (prepend s.pieces acc)
        Left e
          | recover ->
              let
                inv = invalidStep i pos open (lexErrorMsg e)
              in
                go inv.i inv.pos open close (prepend inv.pieces acc)
          | otherwise -> Left e
    | otherwise =
        let
          s = readOcean i pos open
        in
          go s.i s.pos open close (prepend s.pieces acc)

  -- Recovery: emit the failed opener as one `Invalid` lexeme carrying the
  -- reader's diagnostic message, and resync just past it; the interior re-lexes
  -- as ocean (or the next tag). Advancing by the opener's length guarantees
  -- forward progress (no re-match loop).
  invalidStep
    :: Int -> SourcePos -> String -> String -> { pieces :: Array Piece, i :: Int, pos :: SourcePos }
  invalidStep i pos open message =
    let
      endI = min len (i + SCU.length open)
      pos1 = advance pos i endI
    in
      { pieces: [ Lex { value: Invalid message, span: { start: pos, end: pos1 } } ]
      , i: endI
      , pos: pos1
      }

  -- Push an in-order piece array onto a reversed accumulator.
  prepend :: Array Piece -> List Piece -> List Piece
  prepend ps acc = foldl (\a p -> p : a) acc ps

  --------------------------------------------------------------------------
  -- Ocean: a maximal host-text run → one leading `Text` trivia. A `\` before
  -- the active opener contributes the opener literally; a lone `\` is text.
  --------------------------------------------------------------------------
  readOcean :: Int -> SourcePos -> String -> Step
  readOcean start pos0 open =
    let
      openCh = SCU.toCharArray open
      olen = Array.length openCh
      fstOpen = unsafePartial (Array.unsafeIndex openCh 0)
      -- ONE fused pass: find the next opener-or-backslash AND track line/column
      -- as we go (no second `advance` traversal). We test the cheap `at k`
      -- first and only run `matchAt` when the char could begin the opener — so
      -- the per-character cost is one unsafe read, not a `Maybe`-allocating
      -- `matchAt`. Reaching an opener/EOF with no backslash is the common,
      -- escape-free case: the value is a single slice. A backslash hands off to
      -- the escape builder (rare; a second pass there is fine).
      scan k pos
        | k >= len = { endI: k, pos, escaped: false }
        | otherwise =
            let
              c = at k
            in
              if c == '\\' then { endI: k, pos, escaped: true }
              else if c == fstOpen && matchAt k openCh then { endI: k, pos, escaped: false }
              else scan (k + 1) (step1 pos k)
      collect i chars
        | i >= len = { endI: i, chars }
        | matchAt i openCh = { endI: i, chars }
        | at i == '\\' && matchAt (i + 1) openCh = collect (i + 1 + olen)
            (prependChars chars openCh)
        | at i == '\\' = collect (i + 1) ('\\' : chars)
        | otherwise = collect (i + 1) (at i : chars)
      s = scan start pos0
      result =
        if not s.escaped then { endI: s.endI, value: sliceStr start s.endI, pos: s.pos }
        else
          let
            r = collect start Nil
          in
            { endI: r.endI
            , value: SCU.fromCharArray (Array.fromFoldable (List.reverse r.chars))
            , pos: advance pos0 start r.endI
            }
    in
      { pieces: [ Triv { value: Text result.value, span: { start: pos0, end: result.pos } } ]
      , i: result.endI
      , pos: result.pos
      , open
      , close: ""
      }

  prependChars :: List Char -> Array Char -> List Char
  prependChars acc arr = foldl (\a c -> c : a) acc arr

  --------------------------------------------------------------------------
  -- Tag dispatch (mirrors the parsing spike's `tagChunk` ordering).
  --------------------------------------------------------------------------
  readTag :: Int -> SourcePos -> String -> String -> Either LexError Step
  readTag i pos open close = case (if mustache then trySetDelim i pos open close else Nothing) of
    Just r -> r
    Nothing ->
      let
        result =
          if open == "{{" && close == "}}" then
            if matchAt i (cu "{{{{") then readRaw i pos
            else if matchAt i (cu "{{!--") then readComment i pos "{{!--" "--}}"
            else if matchAt i (cu "{{!") then readComment i pos "{{!" "}}"
            else if matchAt i (cu "{{{") then readDelimited i pos "{{{" "}}}" OpenTriple CloseTriple
              false
            else readDelimited i pos "{{" "}}" Open CloseTag true
          else readDelimited i pos open close Open CloseTag false
      in
        -- Only a set-delimiter changes the active pair; every other tag leaves it
        -- as it was. (The readers return a placeholder pair, so reset it here —
        -- otherwise a custom pair was dropped after a single tag.)
        map (_ { open = open, close = close }) result

  -- {{=A B=}} — needs a well-formed `=close`; otherwise fall back (Nothing) to
  -- a plain tag, exactly as the parsing spike's `try setDelimTag` does.
  trySetDelim :: Int -> SourcePos -> String -> String -> Maybe (Either LexError Step)
  trySetDelim i pos open close =
    if not (matchAt i (cu (open <> "="))) then Nothing
    else
      let
        bodyStart = i + SCU.length open + 1
        endPat = cu ("=" <> close)
      in
        case findFrom bodyStart endPat of
          Nothing -> Nothing
          Just q -> case words (sliceStr bodyStart q) of
            [ o, c ] ->
              let
                next = q + SCU.length close + 1
                pos1 = advance pos i next
              in
                Just $ Right
                  { pieces: [ Lex { value: SetDelimiter o c, span: { start: pos, end: pos1 } } ]
                  , i: next
                  , pos: pos1
                  , open: o
                  , close: c
                  }
            _ -> Nothing

  -- {{! … }} / {{!-- … --}} → one `Comment` lexeme over the whole tag.
  readComment :: Int -> SourcePos -> String -> String -> Either LexError Step
  readComment i pos open close =
    let
      bodyStart = i + SCU.length open
    in
      case findFrom bodyStart (cu close) of
        Nothing -> Left (LexError "unterminated comment" pos)
        Just q ->
          let
            next = q + SCU.length close
            pos1 = advance pos i next
          in
            Right (single (Comment (sliceStr bodyStart q)) pos pos1 next open close)

  -- {{{{name}}}} body {{{{/name}}}} — coarse fences + verbatim body.
  readRaw :: Int -> SourcePos -> Either LexError Step
  readRaw i pos =
    let
      afterOpen = i + 4 + (if peek (i + 4) == Just '#' then 1 else 0)
    in
      case findFrom afterOpen (cu "}}}}") of
        Nothing -> Left (LexError "unterminated raw block" pos)
        Just qh ->
          let
            foe = qh + 4
            name = firstWord (sliceStr afterOpen qh)
            closeFence = cu ("{{{{/" <> name <> "}}}}")
          in
            case findFrom foe closeFence of
              Nothing -> Left (LexError "unterminated raw block" pos)
              Just qc ->
                let
                  fe = qc + Array.length closeFence
                  posOpen = advance pos i foe
                  posBody = advance posOpen foe qc
                  posEnd = advance posBody qc fe
                in
                  Right
                    { pieces:
                        [ Lex { value: OpenRaw, span: { start: pos, end: posOpen } }
                        , Lex
                            { value: RawBody (sliceStr foe qc)
                            , span: { start: posOpen, end: posBody }
                            }
                        , Lex { value: CloseRaw, span: { start: posBody, end: posEnd } }
                        ]
                    , i: fe
                    , pos: posEnd
                    , open: "{{"
                    , close: "}}"
                    }

  -- open [~] sigil? interior [~] close
  readDelimited
    :: Int -> SourcePos -> String -> String -> Lexeme -> Lexeme -> Boolean -> Either LexError Step
  readDelimited i pos open close openL closeL allowTrim =
    let
      i1 = i + SCU.length open
      pos1 = advance pos i i1
      openP = Lex { value: openL, span: { start: pos, end: pos1 } }
      tl = if allowTrim then readTrim i1 pos1 else { pieces: [], i: i1, pos: pos1 }
      sg = readSigil tl.i tl.pos
    in
      case readInterior sg.i sg.pos close of
        Left e -> Left e
        Right inr ->
          let
            tr =
              if allowTrim then readTrim inr.i inr.pos else { pieces: [], i: inr.i, pos: inr.pos }
            closeCh = cu close
            base = Array.concat [ [ openP ], tl.pieces, sg.pieces, inr.pieces, tr.pieces ]
          in
            if matchAt tr.i closeCh then
              let
                next = tr.i + SCU.length close
                posC = advance tr.pos tr.i next
                closeP = Lex { value: closeL, span: { start: tr.pos, end: posC } }
              in
                Right
                  { pieces: Array.snoc base closeP, i: next, pos: posC, open: "{{", close: "}}" }
            -- In-tag recovery: the interior tokens already lexed STAY; only the
            -- unparseable tail becomes Invalid. Resync at the next close (consume
            -- it) or the next opener (leave it for the main loop), whichever comes
            -- first — or EOF.
            else if recover then
              let
                j = tr.i
                openCh = cu open
                plan = case findFrom j closeCh of
                  Just c | maybe true (\o -> c < o) (findFrom j openCh) ->
                    { invEnd: c, withClose: true, next: c + SCU.length close }
                  _ -> case findFrom j openCh of
                    Just o -> { invEnd: o, withClose: false, next: o }
                    Nothing -> { invEnd: len, withClose: false, next: len }
                posInv = advance tr.pos j plan.invEnd
                message = if plan.withClose then "unexpected input in tag" else "unterminated tag"
                invPieces =
                  if plan.invEnd > j then
                    [ Lex { value: Invalid message, span: { start: tr.pos, end: posInv } } ]
                  else []
                closed =
                  if plan.withClose then
                    let
                      pc = advance posInv plan.invEnd plan.next
                    in
                      { pieces: [ Lex { value: closeL, span: { start: posInv, end: pc } } ]
                      , pos: pc
                      }
                  else { pieces: [], pos: posInv }
              in
                Right
                  { pieces: Array.concat [ base, invPieces, closed.pieces ]
                  , i: plan.next
                  , pos: closed.pos
                  , open: "{{"
                  , close: "}}"
                  }
            else Left (LexError "unterminated tag" pos)

  readTrim :: Int -> SourcePos -> { pieces :: Array Piece, i :: Int, pos :: SourcePos }
  readTrim i pos
    | i < len && at i == '~' =
        let
          pos1 = step1 pos i
        in
          { pieces: [ Lex { value: Trim, span: { start: pos, end: pos1 } } ], i: i + 1, pos: pos1 }
    | otherwise = { pieces: [], i, pos }

  readSigil :: Int -> SourcePos -> { pieces :: Array Piece, i :: Int, pos :: SourcePos }
  readSigil i pos = case maybeSigil of
    Just (Tuple sg n) ->
      let
        pos1 = advance pos i (i + n)
      in
        { pieces: [ Lex { value: Sigil sg, span: { start: pos, end: pos1 } } ]
        , i: i + n
        , pos: pos1
        }
    Nothing -> { pieces: [], i, pos }
    where
    maybeSigil
      | i >= len = Nothing
      | otherwise = case at i, peek (i + 1) of
          '#', Just '*' -> Just (Tuple Decorator 2)
          '#', Just '>' -> Just (Tuple PartialBlock 2)
          '#', _ -> Just (Tuple Section 1)
          '^', _ -> Just (Tuple Inverse 1)
          '/', _ -> Just (Tuple Close 1)
          '>', _ -> Just (Tuple Partial 1)
          '&', _ -> Just (Tuple Unescaped 1)
          '$', _ -> Just (Tuple BlockDef 1)
          '<', _ -> Just (Tuple Parent 1)
          _, _ -> Nothing

  --------------------------------------------------------------------------
  -- Interior: ws-trivia and lexemes until the close delimiter (or a char that
  -- cannot start a lexeme, e.g. `~` before close — the caller handles that).
  --------------------------------------------------------------------------
  readInterior
    :: Int
    -> SourcePos
    -> String
    -> Either LexError { pieces :: Array Piece, i :: Int, pos :: SourcePos }
  readInterior i0 pos0 close = loop i0 pos0 Nil
    where
    closeCh = cu close
    stop i pos acc = { pieces: Array.fromFoldable (List.reverse acc), i, pos }
    loop i pos acc
      | matchAt i closeCh = Right (stop i pos acc)
      -- EOF before the close: stop and keep what we have when recovering (the
      -- caller marks the rest Invalid); strict mode still fails.
      | i >= len =
          if recover then Right (stop i pos acc) else Left (LexError "unterminated tag" pos0)
      | isSpace (at i) =
          let
            e = runWhile isSpace i
            pos1 = advance pos i e
          in
            loop e pos1
              (Triv { value: Whitespace (sliceStr i e), span: { start: pos, end: pos1 } } : acc)
      | otherwise = case lexeme i pos of
          -- A malformed literal: in recovery, stop here (the bad span becomes
          -- part of the caller's Invalid tail); strict mode propagates the error.
          Left err -> if recover then Right (stop i pos acc) else Left err
          Right Nothing -> Right (stop i pos acc)
          Right (Just r) -> loop r.i r.pos (r.piece : acc)

  -- One interior lexeme, or `Nothing` if nothing can start here (stop).
  lexeme
    :: Int -> SourcePos -> Either LexError (Maybe { piece :: Piece, i :: Int, pos :: SourcePos })
  lexeme i pos =
    let
      c = at i
      one v = Right (Just (mk v pos (i + 1)))
    in
      if c == '[' then one LBracket
      else if c == ']' then one RBracket
      else if c == '(' then one LParen
      else if c == ')' then one RParen
      else if c == '"' || c == '\'' then readStr i pos c
      else if isDigit c || (c == '-' && maybe false isDigit (peek (i + 1))) then readNum i pos
      -- L3: `.` is always a path separator (numbers consumed their own `.` above).
      else if c == '.' then one Dot
      else case readOp i of
        Just op -> Right (Just (mk (Op op) pos (i + SCU.length op)))
        Nothing ->
          -- `/` is a path separator here; under infixArith `readOp` already took
          -- it as the division Op, so this branch is the non-arith case.
          if c == '/' then one Slash
          else if identChar arith c then
            let
              e = runWhile (identChar arith) i
            in
              Right (Just (mk (Ident (sliceStr i e)) pos e))
          else Right Nothing

  -- A number literal: optional `-`, digits, optional `.`digits.
  readNum
    :: Int -> SourcePos -> Either LexError (Maybe { piece :: Piece, i :: Int, pos :: SourcePos })
  readNum i pos =
    let
      j = if at i == '-' then i + 1 else i
      d1 = runWhile isDigit j
      e =
        if peek d1 == Just '.' && maybe false isDigit (peek (d1 + 1)) then runWhile isDigit (d1 + 1)
        else d1
      raw = sliceStr i e
    in
      case Number.fromString raw of
        Just n -> Right (Just (mk (Num n) pos e))
        Nothing -> Left (LexError ("malformed number '" <> raw <> "'") pos)

  -- A string literal with `\n \t \r \\ \" \'` escapes.
  readStr
    :: Int
    -> SourcePos
    -> Char
    -> Either LexError (Maybe { piece :: Piece, i :: Int, pos :: SourcePos })
  readStr start pos q = collect (start + 1) Nil
    where
    collect i chars
      | i >= len = Left (LexError "unterminated string" pos)
      | at i == q = Right
          ( Just
              (mk (Str (SCU.fromCharArray (Array.fromFoldable (List.reverse chars)))) pos (i + 1))
          )
      | at i == '\\' = case peek (i + 1) of
          Just e -> case unescape e of
            Just ch -> collect (i + 2) (ch : chars)
            Nothing -> Left (LexError "invalid string escape" pos)
          Nothing -> Left (LexError "unterminated string" pos)
      | otherwise = collect (i + 1) (at i : chars)

  -- Longest-match operator at `i`, or `Nothing`. A lone `=`/`&` is not an
  -- operator (`=` continues an ident; `&` alone is a downstream error).
  readOp :: Int -> Maybe String
  readOp i =
    let
      c1 = peek (i + 1)
    in
      case at i of
        '&' -> if c1 == Just '&' then Just "&&" else Nothing
        '|' -> if c1 == Just '|' then Just "||" else Just "|"
        '!' -> if c1 == Just '=' then Just "!=" else Just "!"
        '<' -> if c1 == Just '=' then Just "<=" else Just "<"
        '>' -> if c1 == Just '=' then Just ">=" else Just ">"
        '=' -> if c1 == Just '=' then Just "==" else Nothing
        '?' -> if arith && c1 == Just '?' then Just "??" else Nothing
        c ->
          if arith && (c == '+' || c == '-' || c == '*' || c == '/' || c == '%') then Just
            (SCU.singleton c)
          else Nothing

  -- Build a `Lex` piece spanning `[startI(of pos)…endI)`.
  mk :: Lexeme -> SourcePos -> Int -> { piece :: Piece, i :: Int, pos :: SourcePos }
  mk v pos endI =
    let
      startI = pos.index
      posEnd = advance pos startI endI
    in
      { piece: Lex { value: v, span: { start: pos, end: posEnd } }, i: endI, pos: posEnd }

  -- A single whole-tag lexeme step (comment).
  single :: Lexeme -> SourcePos -> SourcePos -> Int -> String -> String -> Step
  single v posStart posEnd next open close =
    { pieces: [ Lex { value: v, span: { start: posStart, end: posEnd } } ]
    , i: next
    , pos: posEnd
    , open
    , close
    }

  -- First index >= `from` at which `pat` occurs.
  findFrom :: Int -> Array Char -> Maybe Int
  findFrom from pat = scan from
    where
    scan k
      | k > len = Nothing
      | matchAt k pat = Just k
      | otherwise = scan (k + 1)

  -- End index of a maximal run (>= from) of `pred`.
  runWhile :: (Char -> Boolean) -> Int -> Int
  runWhile pred i
    | i < len && pred (at i) = runWhile pred (i + 1)
    | otherwise = i

  cu :: String -> Array Char
  cu = SCU.toCharArray

