-- | Lexical structure. See `docs/modules/ROOT/pages/lexical.adoc`.
-- |
-- | Two jobs live here:
-- |
-- |  * `tokenizeTemplate` scans the raw source into a flat stream of `RawTok`
-- |    (content runs and tag tokens), handling comment stripping, raw-block
-- |    capture, backslash escaping, and `~` whitespace control.
-- |  * `lexExpr` tokenizes the interior of a tag into expression `Token`s.
-- |
-- | The grammar in `Parser` consumes both.
module BareBars.Lexer
  ( Token(..)
  , RawTok(..)
  , lexExpr
  , tokenizeTemplate
  ) where

import Prelude

import BareBars.Error (ParseError(..))
import BareBars.Span (Span)
import Data.Array as Array
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), maybe)
import Data.Number as Number
import Data.String.CodeUnits as SCU

-- | Tokens that appear inside a tag.
data Token
  = TIdent String
  | TString String
  | TNumber Number
  | TLParen
  | TRParen

derive instance eqToken :: Eq Token

instance showToken :: Show Token where
  show = case _ of
    TIdent s -> "TIdent " <> show s
    TString s -> "TString " <> show s
    TNumber n -> "TNumber " <> show n
    TLParen -> "TLParen"
    TRParen -> "TRParen"

-- | A flat template token. Comments never appear (they are dropped). `~`
-- | whitespace control has already been applied to the `Content` runs.
data RawTok
  = RContent String
  | ROutput Span (Array Token) -- {{{ expr }}}
  | ROpen Span String (Array Token) -- {{# name args }}
  | RClose String -- {{/ name }}
  | RSep Span String (Array Token) -- {{ name args }} — a name-agnostic separator
  | RRaw Span String (Array Token) String -- {{{{# name args }}}} body {{{{/ name }}}}

derive instance eqRawTok :: Eq RawTok

instance showRawTok :: Show RawTok where
  show = case _ of
    RContent s -> "RContent " <> show s
    ROutput _ t -> "ROutput " <> show t
    ROpen _ n t -> "ROpen " <> show n <> " " <> show t
    RClose n -> "RClose " <> show n
    RSep _ n t -> "RSep " <> show n <> " " <> show t
    RRaw _ n t b -> "RRaw " <> show n <> " " <> show t <> " " <> show b

--------------------------------------------------------------------------------
-- Character helpers
--------------------------------------------------------------------------------

isSpace :: Char -> Boolean
isSpace c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

isDigit :: Char -> Boolean
isDigit c = c >= '0' && c <= '9'

isAlpha :: Char -> Boolean
isAlpha c = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')

-- | The permissive IDENT character set (lexical.adoc §1.5). Note `.` is a legal
-- | ident character: `a.b` lexes as a single identifier in the core.
isIdentChar :: Char -> Boolean
isIdentChar c =
  isAlpha c || isDigit c
    || c == '_'
    || c == '-'
    || c == '+'
    || c == '*'
    || c == '?'
    || c == '!'
    || c == '/'
    || c == '.'
    || c == '<'
    || c == '>'
    || c == '='

-- | Does `cs` contain the literal `pat` starting at index `i`?
matchAt :: Array Char -> Int -> String -> Boolean
matchAt cs i pat =
  let
    pcs = SCU.toCharArray pat
  in
    Array.slice i (i + Array.length pcs) cs == pcs

-- | First index `>= from` at which `pat` occurs, if any.
findFrom :: Array Char -> Int -> String -> Maybe Int
findFrom cs from pat = go from
  where
  len = Array.length cs
  go i
    | i > len = Nothing
    | matchAt cs i pat = Just i
    | otherwise = go (i + 1)

slice :: Array Char -> Int -> Int -> String
slice cs i j = SCU.fromCharArray (Array.slice i j cs)

trimStartWs :: String -> String
trimStartWs s = SCU.fromCharArray (Array.dropWhile isSpace (SCU.toCharArray s))

trimEndWs :: String -> String
trimEndWs s =
  SCU.fromCharArray (Array.reverse (Array.dropWhile isSpace (Array.reverse (SCU.toCharArray s))))

--------------------------------------------------------------------------------
-- Expression tokenizer (tag interior)
--------------------------------------------------------------------------------

-- | Tokenize the interior of a tag. `base` is the source offset of the interior
-- | start, used only for error reporting.
lexExpr :: Int -> String -> Either ParseError (Array Token)
lexExpr base src = go 0 []
  where
  cs = SCU.toCharArray src
  len = Array.length cs

  go :: Int -> Array Token -> Either ParseError (Array Token)
  go i acc = case Array.index cs i of
    Nothing -> Right acc
    Just c
      | isSpace c -> go (i + 1) acc
      | c == '(' -> go (i + 1) (Array.snoc acc TLParen)
      | c == ')' -> go (i + 1) (Array.snoc acc TRParen)
      | c == '"' -> lexString '"' (i + 1) acc
      | c == '\'' -> lexString '\'' (i + 1) acc
      | isDigit c || (c == '-' && peekDigit (i + 1)) -> lexNumber i acc
      | isIdentChar c -> lexIdent i acc
      | otherwise -> Left (LexError ("unexpected character '" <> SCU.singleton c <> "'") (base + i))

  peekDigit :: Int -> Boolean
  peekDigit i = case Array.index cs i of
    Just d -> isDigit d
    Nothing -> false

  lexIdent :: Int -> Array Token -> Either ParseError (Array Token)
  lexIdent start acc =
    let
      end = scanWhile isIdentChar start
    in
      go end (Array.snoc acc (TIdent (slice cs start end)))

  lexNumber :: Int -> Array Token -> Either ParseError (Array Token)
  lexNumber start acc =
    let
      end = scanWhile isNumChar (start + 1) -- consume sign/first digit then rest
      raw = slice cs start end
    in
      case Number.fromString raw of
        Just n -> go end (Array.snoc acc (TNumber n))
        Nothing -> Left (LexError ("malformed number '" <> raw <> "'") (base + start))

  isNumChar :: Char -> Boolean
  isNumChar c = isDigit c || c == '.'

  lexString :: Char -> Int -> Array Token -> Either ParseError (Array Token)
  lexString quote start acc = collect start []
    where
    collect :: Int -> Array Char -> Either ParseError (Array Token)
    collect i buf = case Array.index cs i of
      Nothing -> Left (UnterminatedTag (base + start))
      Just c
        | c == quote -> go (i + 1) (Array.snoc acc (TString (SCU.fromCharArray buf)))
        | c == '\\' -> case Array.index cs (i + 1) of
            Just e -> case unescape e of
              Just ch -> collect (i + 2) (Array.snoc buf ch)
              Nothing -> Left (BadEscape (base + i))
            Nothing -> Left (BadEscape (base + i))
        | otherwise -> collect (i + 1) (Array.snoc buf c)

  unescape :: Char -> Maybe Char
  unescape = case _ of
    '\\' -> Just '\\'
    '"' -> Just '"'
    '\'' -> Just '\''
    'n' -> Just '\n'
    't' -> Just '\t'
    'r' -> Just '\r'
    _ -> Nothing

  scanWhile :: (Char -> Boolean) -> Int -> Int
  scanWhile p i
    | i >= len = len
    | otherwise = case Array.index cs i of
        Just c | p c -> scanWhile p (i + 1)
        _ -> i

--------------------------------------------------------------------------------
-- Template tokenizer
--------------------------------------------------------------------------------

-- | The openers we recognize, longest first (lexical.adoc §1.2).
type TagResult = { mtok :: Maybe RawTok, next :: Int, trimL :: Boolean, trimR :: Boolean }

tokenizeTemplate :: String -> Either ParseError (Array RawTok)
tokenizeTemplate src = go 0 [] [] false
  where
  cs = SCU.toCharArray src
  len = Array.length cs

  -- i: cursor; buf: pending content chars; acc: emitted tokens; pend: trim
  -- leading whitespace of the next flushed content run.
  go :: Int -> Array Char -> Array RawTok -> Boolean -> Either ParseError (Array RawTok)
  go i buf acc pend
    | i >= len = Right (flush buf acc pend false)
    | otherwise = case Array.index cs i of
        Nothing -> Right (flush buf acc pend false)
        Just c
          -- backslash escaping of an opener
          | c == '\\' ->
              if matchAt cs (i + 1) "\\" then go (i + 2) (Array.snoc buf '\\') acc pend
              else case escapedOpenerAt (i + 1) of
                Just lit -> go (i + 1 + SCU.length lit) (buf <> SCU.toCharArray lit) acc pend
                Nothing -> go (i + 1) (Array.snoc buf '\\') acc pend
          | isOpenerAt i -> do
              res <- readTag i
              let
                acc1 = flush buf acc pend res.trimL
                acc2 = maybe acc1 (Array.snoc acc1) res.mtok
              go res.next [] acc2 res.trimR
          | otherwise -> go (i + 1) (Array.snoc buf c) acc pend

  -- Flush the content buffer, applying a pending leading trim and an optional
  -- trailing trim (from the tag that follows).
  flush :: Array Char -> Array RawTok -> Boolean -> Boolean -> Array RawTok
  flush buf acc pend trimR =
    let
      s0 = SCU.fromCharArray buf
      s1 = if pend then trimStartWs s0 else s0
      s2 = if trimR then trimEndWs s1 else s1
    in
      if s2 == "" then acc else Array.snoc acc (RContent s2)

  -- The brace-prefixed openers, longest first. The `~` whitespace-control
  -- variants (`{{~#`, `{{~/`, …) are recognized so a left-trim tilde may sit
  -- between the braces and the sigil. `{{#` is the only block *opener*; the bare
  -- double-stash `{{ … }}` is a name-agnostic *separator* (handled separately).
  openerLiteralAt :: Int -> Maybe String
  openerLiteralAt i
    | matchAt cs i "{{{{#" = Just "{{{{#"
    | matchAt cs i "{{~!--" = Just "{{~!--"
    | matchAt cs i "{{!--" = Just "{{!--"
    | matchAt cs i "{{{" = Just "{{{"
    | matchAt cs i "{{~!" = Just "{{~!"
    | matchAt cs i "{{!" = Just "{{!"
    | matchAt cs i "{{~#" = Just "{{~#"
    | matchAt cs i "{{#" = Just "{{#"
    | matchAt cs i "{{~/" = Just "{{~/"
    | matchAt cs i "{{/" = Just "{{/"
    | otherwise = Nothing

  -- A separator is any `{{` that is not `{{{` and not one of the bracketed
  -- openers above — a bare double-stash whose head is an identifier. The lexer
  -- recognizes the *shape*, never the name.
  isSeparatorAt :: Int -> Boolean
  isSeparatorAt i = matchAt cs i "{{" && not (matchAt cs i "{{{") && case openerLiteralAt i of
    Just _ -> false
    Nothing -> true

  isOpenerAt :: Int -> Boolean
  isOpenerAt i = case openerLiteralAt i of
    Just _ -> true
    Nothing -> isSeparatorAt i

  -- The literal text emitted for a backslash-escaped opener.
  escapedOpenerAt :: Int -> Maybe String
  escapedOpenerAt i = case openerLiteralAt i of
    Just s -> Just s
    Nothing -> if isSeparatorAt i then Just "{{" else Nothing

  readTag :: Int -> Either ParseError TagResult
  readTag i
    | matchAt cs i "{{{{#" = readRaw i
    | matchAt cs i "{{~!--" = readLongComment i "{{~!--"
    | matchAt cs i "{{!--" = readLongComment i "{{!--"
    | matchAt cs i "{{{" = readOutput i
    | matchAt cs i "{{~!" = readShortComment i "{{~!"
    | matchAt cs i "{{!" = readShortComment i "{{!"
    | matchAt cs i "{{~#" = readBlockOpen i "{{~#"
    | matchAt cs i "{{#" = readBlockOpen i "{{#"
    | matchAt cs i "{{~/" = readClose i "{{~/"
    | matchAt cs i "{{/" = readClose i "{{/"
    | matchAt cs i "{{" = readSeparator i
    | otherwise = Left (LexError "internal: no opener" i)

  -- A left-trim tilde may sit immediately after the braces, before the sigil.
  leadTrimAt :: Int -> Boolean
  leadTrimAt i = matchAt cs (i + 2) "~"

  -- Split a tag interior on leading/trailing `~`, returning (trimL, trimR, core)
  splitTrims :: String -> { trimL :: Boolean, trimR :: Boolean, core :: String }
  splitTrims raw =
    let
      trimL = SCU.take 1 raw == "~"
      r1 = if trimL then SCU.drop 1 raw else raw
      trimR = SCU.takeRight 1 r1 == "~"
      core = if trimR then SCU.dropRight 1 r1 else r1
    in
      { trimL, trimR, core }

  readOutput :: Int -> Either ParseError TagResult
  readOutput i =
    let
      start = i + 3
    in
      case findFrom cs start "}}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q ->
          let
            t = splitTrims (slice cs start q)
          in
            do
              toks <- lexExpr start t.core
              if Array.null toks then Left (EmptyOutput i)
              else Right
                { mtok: Just (ROutput { start: i, end: q + 3 } toks)
                , next: q + 3
                , trimL: t.trimL
                , trimR: t.trimR
                }

  readBlockOpen :: Int -> String -> Either ParseError TagResult
  readBlockOpen i opener =
    let
      start = i + SCU.length opener
    in
      case findFrom cs start "}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q -> do
          let t = splitTrims (slice cs start q)
          toks <- lexExpr start t.core
          { name, rest } <- splitHead i toks
          Right
            { mtok: Just (ROpen { start: i, end: q + 2 } name rest)
            , next: q + 2
            , trimL: leadTrimAt i || t.trimL
            , trimR: t.trimR
            }

  readClose :: Int -> String -> Either ParseError TagResult
  readClose i opener =
    let
      start = i + SCU.length opener
    in
      case findFrom cs start "}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q -> do
          let t = splitTrims (slice cs start q)
          toks <- lexExpr start t.core
          { name } <- splitHead i toks
          Right
            { mtok: Just (RClose name)
            , next: q + 2
            , trimL: leadTrimAt i || t.trimL
            , trimR: t.trimR
            }

  -- A bare double-stash separator `{{ [~] name args [~] }}`. The leading `~`
  -- (if any) sits before the interior; the head is an identifier the lexer does
  -- not interpret.
  readSeparator :: Int -> Either ParseError TagResult
  readSeparator i =
    let
      start = if leadTrimAt i then i + 3 else i + 2
    in
      case findFrom cs start "}}" of
        Nothing -> Left (UnterminatedTag i)
        Just q -> do
          let t = splitTrims (slice cs start q)
          toks <- lexExpr start t.core
          { name, rest } <- splitHead i toks
          Right
            { mtok: Just (RSep { start: i, end: q + 2 } name rest)
            , next: q + 2
            , trimL: leadTrimAt i || t.trimL
            , trimR: t.trimR
            }

  readShortComment :: Int -> String -> Either ParseError TagResult
  readShortComment i opener = case findFrom cs (i + SCU.length opener) "}}" of
    Nothing -> Left (UnterminatedComment i)
    Just q -> Right
      { mtok: Nothing, next: q + 2, trimL: leadTrimAt i, trimR: matchAt cs (q - 1) "~" }

  readLongComment :: Int -> String -> Either ParseError TagResult
  readLongComment i opener = case findFrom cs (i + SCU.length opener) "--}}" of
    Nothing -> Left (UnterminatedComment i)
    Just q -> Right
      { mtok: Nothing, next: q + 4, trimL: leadTrimAt i, trimR: matchAt cs (q - 1) "~" }

  readRaw :: Int -> Either ParseError TagResult
  readRaw i =
    let
      start = i + 5
    in
      case findFrom cs start "}}}}" of
        Nothing -> Left (UnterminatedRaw i)
        Just qh -> do
          toks <- lexExpr start (slice cs start qh)
          { name, rest } <- splitHead i toks
          let
            bodyStart = qh + 4
            closePat = "{{{{/" <> name <> "}}}}"
          case findFrom cs bodyStart closePat of
            Nothing -> Left (UnterminatedRaw i)
            Just qc ->
              let
                end = qc + SCU.length closePat
              in
                Right
                  { mtok: Just (RRaw { start: i, end } name rest (slice cs bodyStart qc))
                  , next: end
                  , trimL: false
                  , trimR: false
                  }

  splitHead :: Int -> Array Token -> Either ParseError { name :: String, rest :: Array Token }
  splitHead i toks = case Array.uncons toks of
    Just { head: TIdent name, tail } -> Right { name, rest: tail }
    _ -> Left (HeadNotIdent i)
