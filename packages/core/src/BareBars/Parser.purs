-- | The syntactic grammar. See `docs/modules/ROOT/pages/grammar.adoc`.
-- |
-- | `parse` turns source text into a core `Template`. It runs the template
-- | scanner (`Lexer.tokenizeTemplate`), then builds the tree from the flat token
-- | stream, parsing each tag's *interior* text into `Expr`s with `BareBars.Expr`
-- | (a `purescript-parsing` grammar). There is no separate expression token
-- | stream: a tag carries its interior text and the scanner's job ends at
-- | delimiting it.
module BareBars.Parser
  ( parse
  , parseWith
  , ParseOptions
  , ExprParser
  , defaultParseOptions
  ) where

import Prelude

import BareBars.Error (ParseError(..))
import BareBars.Expr as Expr
import BareBars.Lexer (RawTok(..), tokenizeTemplate, trimStandalone)
import BareBars.Span (Span)
import BareBars.Syntax (Directive, Expr(..), Node(..), Sigil(..), Template)
import Data.Array as Array
import Data.Either (Either(..))
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..), maybe)
import Data.String (trim)
import Data.String.CodeUnits as SCU

-- | A tag-interior expression parser: `offset -> interior -> Expr`. The core
-- | grammar (`BareBars.Expr`) is the default; a *dialect* (e.g. MaxBars, with
-- | infix operators and pipes) plugs in its own — the structural tree-builder
-- | below is grammar-agnostic.
type ExprParser = Int -> String -> Either ParseError Expr

-- | Knobs the *front-end* (CLI/host) sets; per-file `@`-directives may override
-- | them. `trimStandalone` toggles Handlebars-style standalone whitespace
-- | removal (default on; a `@trim: standalone | none` directive wins over it).
-- | `parseExpr` is the interior expression grammar (dialect seam). `extras`
-- | allows the Handlebars-only tag shapes — raw blocks `{{{{…}}}}`, the inverse
-- | block `{{^…}}`/`{{{^…}}}`, and unescaped `{{&…}}`. The core *lexer* always
-- | recognizes them (meaning-free); a dialect that doesn't accept them (CoreBars,
-- | MaxBars) sets `extras = false` and the parser rejects them.
type ParseOptions = { trimStandalone :: Boolean, parseExpr :: ExprParser, extras :: Boolean }

-- | Standalone trimming on (Handlebars parity), the core expression grammar, and
-- | Handlebars-extras allowed (the engine + FullBars use this; CoreBars/MaxBars
-- | override `extras = false`).
defaultParseOptions :: ParseOptions
defaultParseOptions = { trimStandalone: true, parseExpr: Expr.parseExpr, extras: true }

-- | Parse source text into the core template *plus* its header directives, with
-- | the default options. The directives are a meaning-free list the engine
-- | interprets later (see `BareBars.Syntax.Directive`); the `Template` is the
-- | node tree (comments stripped). See `docs/.../grammar.adoc`.
parse :: String -> Either ParseError { directives :: Array Directive, nodes :: Template }
parse = parseWith defaultParseOptions

-- | `parse` with explicit front-end options (the CLI/config path). Whitespace is
-- | the one concern the core owns by `@`-directive: `@trim` overrides the
-- | supplied `trimStandalone`.
parseWith
  :: ParseOptions
  -> String
  -> Either ParseError { directives :: Array Directive, nodes :: Template }
parseWith opts src = do
  toks <- tokenizeTemplate src
  directives <- collectDirectives toks
  standalone <- effectiveTrim opts directives
  let toks' = if standalone then trimStandalone toks else toks
  -- comments carry no output; drop them before the tree builder, which then
  -- never has to know about `RComment` (the standalone pass needs them, so it
  -- runs first).
  res <- parseSeq opts.parseExpr opts.extras (Array.filter (not <<< isComment) toks') 0
  case res.stop of
    StopEOF -> Right { directives, nodes: res.nodes }
    StopClose name _ -> Left (MismatchedBlock "<none>" name 0)
  where
  isComment = case _ of
    RComment _ _ _ -> true
    _ -> false

-- | The effective standalone-trim setting: a `@trim` header directive overrides
-- | the front-end option. `@trim: standalone` ⇒ on, `@trim: none` ⇒ off; any
-- | other value is a parse error (it is a core-acted, *syntactic* directive,
-- | unlike the engine's semantic `@truthiness`).
effectiveTrim :: ParseOptions -> Array Directive -> Either ParseError Boolean
effectiveTrim opts directives = case Array.find (\d -> d.key == "trim") directives of
  Nothing -> Right opts.trimStandalone
  Just d -> case d.value of
    "standalone" -> Right true
    "none" -> Right false
    other -> Left
      ( BadDirective ("invalid @trim value '" <> other <> "'; expected 'standalone' or 'none'")
          d.span.start
      )

--------------------------------------------------------------------------------
-- Header directives
--------------------------------------------------------------------------------

-- | Lift `@key[: value]` directives from short-comment interiors, enforcing
-- | *header-only* placement: directives are valid only before the first
-- | non-comment tag. Leading content/whitespace does not close the header — only
-- | a real tag (output/block/close/separator/raw) does. A directive-bearing
-- | comment after that point is a `DirectiveAfterHeader` error. Plain comments
-- | (no `@key` head) are ignored wherever they sit.
collectDirectives :: Array RawTok -> Either ParseError (Array Directive)
collectDirectives toks = go 0 true []
  where
  go :: Int -> Boolean -> Array Directive -> Either ParseError (Array Directive)
  go i headerOpen acc = case Array.index toks i of
    Nothing -> Right acc
    Just (RComment _ base interior) ->
      let
        dirs = parseDirectives base interior
      in
        if headerOpen then go (i + 1) true (acc <> dirs)
        else case Array.head dirs of
          Just d -> Left (DirectiveAfterHeader d.span.start)
          Nothing -> go (i + 1) false acc
    Just (RContent _) -> go (i + 1) headerOpen acc -- content does not close the header
    Just _ -> go (i + 1) false acc -- a real tag closes the header

-- | Parse the `@key[: value]` directives out of one comment interior. The parser
-- | keys on `@<key>` heads (a letter-led identifier with hyphens allowed); a
-- | value runs from the colon to the next head or the interior end, trimmed; a
-- | bare `@key` (no colon) is a flag normalised to `value = "true"`. `base` is
-- | the interior's source offset, so spans point into the original template.
parseDirectives :: Int -> String -> Array Directive
parseDirectives base interior = go 0 []
  where
  cs = SCU.toCharArray interior
  len = Array.length cs
  at k = Array.index cs k
  slc a b = SCU.fromCharArray (Array.slice a b cs)

  isHead k = at k == Just '@' && maybe false isLetter (at (k + 1))
  readKey k = if maybe false isKeyChar (at k) then readKey (k + 1) else k
  skipWs k = if maybe false isSpace (at k) then skipWs (k + 1) else k
  valueEnd k
    | k >= len = len
    | isHead k = k
    | otherwise = valueEnd (k + 1)

  go :: Int -> Array Directive -> Array Directive
  go j acc
    | j >= len = acc
    | isHead j =
        let
          keyEnd = readKey (j + 1)
          key = slc (j + 1) keyEnd
          afterKey = skipWs keyEnd
        in
          case at afterKey of
            Just ':' ->
              let
                vStart = skipWs (afterKey + 1)
                vEnd = valueEnd vStart
                dir =
                  { key
                  , value: trim (slc vStart vEnd)
                  , span: { start: base + j, end: base + vEnd }
                  }
              in
                go vEnd (Array.snoc acc dir)
            _ ->
              let
                dir = { key, value: "true", span: { start: base + j, end: base + keyEnd } }
              in
                go keyEnd (Array.snoc acc dir)
    | otherwise = go (j + 1) acc

isLetter :: Char -> Boolean
isLetter c = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')

isKeyChar :: Char -> Boolean
isKeyChar c = isLetter c || (c >= '0' && c <= '9') || c == '_' || c == '-'

isSpace :: Char -> Boolean
isSpace c = c == ' ' || c == '\t' || c == '\n' || c == '\r'

--------------------------------------------------------------------------------
-- Tag-interior expression parsing
--------------------------------------------------------------------------------

-- | The single `Expr` filling an output tag. A blank interior is `EmptyOutput`
-- | at the tag's offset (not the interior's), matching the diagnostics tests.
outputExpr :: ExprParser -> Span -> Int -> String -> Either ParseError Expr
outputExpr pe span base s
  | trim s == "" = Left (EmptyOutput span.start)
  | otherwise = pe base s

-- | A *headed* tag (`{{# name args}}`, `{{name args}}`, `{{/name}}`, raw): its
-- | interior is one application whose head names the helper/block/separator.
headed
  :: ExprParser -> Span -> Int -> String -> Either ParseError { name :: String, args :: Array Expr }
headed pe span base s
  | trim s == "" = Left (HeadNotIdent span.start)
  | otherwise = case pe base s of
      Left e -> Left e
      Right (App name args) -> Right { name, args }
      Right _ -> Left (HeadNotIdent span.start)

--------------------------------------------------------------------------------
-- Tree building over the flat RawTok stream
--------------------------------------------------------------------------------

data Stop
  = StopEOF
  | StopClose String Int -- closed name, index after {{/name}}

type SeqResult = { nodes :: Template, stop :: Stop }

-- | Parse a run of nodes starting at index `i`, stopping at end of input or at
-- | a close `{{/name}}`. A block captures a single body; multi-branch control
-- | flow is expressed as nested clause blocks the engine interprets.
parseSeq :: ExprParser -> Boolean -> Array RawTok -> Int -> Either ParseError SeqResult
parseSeq pe extras toks = go Nil
  where
  -- Siblings accumulate in a *reversed* `List` (O(1) prepend); the finished
  -- run is reversed into an `Array` once. Building the `Template` with
  -- `Array.snoc` per node would be O(n²).
  done :: List Node -> Stop -> SeqResult
  done acc stop = { nodes: Array.fromFoldable (List.reverse acc), stop }

  -- The linear sibling scan. Every recursive `go` call is kept in *tail*
  -- position (explicit `case`, never `do`) so PureScript loops it — otherwise a
  -- bind-wrapped recursive call defeats the tail-call optimization for the whole
  -- function and a long node sequence overflows the stack. (Block *nesting* still
  -- recurses through `parseSeq`, but that depth is bounded by how deep blocks
  -- nest, not by sequence length.)
  go :: List Node -> Int -> Either ParseError SeqResult
  go acc i = case Array.index toks i of
    Nothing -> Right (done acc StopEOF)
    Just t -> case t of
      RContent s -> go (Content s : acc) (i + 1)
      RComment _ _ _ -> go acc (i + 1) -- filtered upstream; skip defensively
      ROutput span base s -> case outputExpr pe span base s of
        Left e -> Left e
        Right e -> go (Output span e : acc) (i + 1)
      -- `{{&x}}` is unescaped output (= `{{{x}}}`); a Handlebars-extra, gated.
      RAmp span base s
        | not extras -> Left (DisallowedShape "{{& }} (unescaped output)" span.start)
        | otherwise -> case outputExpr pe span base s of
            Left e -> Left e
            Right e -> go (Output span e : acc) (i + 1)
      RRaw span base s body
        | not extras -> Left (DisallowedShape "{{{{ }}}} (raw block)" span.start)
        | otherwise -> case headed pe span base s of
            Left e -> Left e
            Right h -> go (RawBlock span h.name h.args body : acc) (i + 1)
      RSep span base s -> case headed pe span base s of
        Left e -> Left e
        Right h -> go (Sep span h.name h.args : acc) (i + 1)
      RClose _ base s -> case headed pe { start: base, end: base } base s of
        Left e -> Left e
        Right h -> Right (done acc (StopClose h.name (i + 1)))
      -- `{{^x}}` (Inverse) is a Handlebars-extra, gated; `{{#x}}` (Section) is core.
      ROpen span sigil base s
        | sigil == Inverse && not extras -> Left
            (DisallowedShape "{{^ }} (inverse block)" span.start)
        | otherwise -> buildBlock acc span sigil base s (i + 1)

  buildBlock :: List Node -> Span -> Sigil -> Int -> String -> Int -> Either ParseError SeqResult
  buildBlock acc span sigil base s i = case headed pe span base s of
    Left e -> Left e
    Right h -> case parseSeq pe extras toks i of
      Left e -> Left e
      Right inner -> case inner.stop of
        -- point the diagnostic at the *opener* (its span start), not offset 0.
        StopEOF -> Left (MismatchedBlock h.name "<eof>" span.start)
        StopClose closed pos
          | closed == h.name -> go (Block span sigil h.name h.args inner.nodes : acc) pos
          | otherwise -> Left (MismatchedBlock h.name closed span.start)
