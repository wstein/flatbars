-- | The syntactic grammar. See `docs/modules/ROOT/pages/grammar.adoc`.
-- |
-- | `parse` turns source text into a core `Template`. It runs the template
-- | scanner (`Lexer.tokenizeTemplate`) to delimit tags, builds the tree from the
-- | flat token stream, and parses each tag's *interior* by first lexing it into
-- | an interior token stream (`FlatBars.Token.tokenizeInterior`) and then handing
-- | those tokens to the dialect grammar (`ParseOptions.parseExpr`; the default is
-- | the prefix grammar `FlatBars.Expr`). Tokenizing is meaning-free and shared;
-- | the grammar (prefix vs. MaxBars infix) is the dialect seam.
module FlatBars.Parser
  ( parse
  , parseWith
  , ParseOptions
  , ExprParser
  , defaultParseOptions
  , buildFromTokens
  , collectDirectives
  ) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..), maybe)
import Data.String (trim)
import Data.String.CodeUnits as SCU
import FlatBars.Error (ParseError(..))
import FlatBars.Expr as Expr
import FlatBars.Lexer (LexConfig, RawTok(..), defaultLexConfig, tokenizeTemplate, trimStandalone)
import FlatBars.Span (Span)
import FlatBars.Syntax (Directive, Expr(..), Node(..), Sigil(..), Template)
import FlatBars.Token (LexOptions, PosToken, Token(..), defaultLexOptions, tokenizeInterior)

-- | A tag-interior expression parser: it consumes the interior **token stream**
-- | (the core tokenizes interiors via `FlatBars.Token.tokenizeInterior`; this
-- | parses those tokens into an `Expr`). The core grammar (`FlatBars.Expr`) is
-- | the default; a *dialect* (e.g. MaxBars, with infix operators and pipes)
-- | plugs in its own — the structural tree-builder below is grammar-agnostic.
type ExprParser = Array PosToken -> Either ParseError Expr

-- | Knobs the *front-end* (CLI/host) sets; per-file `@`-directives may override
-- | them. `trimStandalone` toggles Handlebars-style standalone whitespace
-- | removal (default on; a `@trim: standalone | none` directive wins over it).
-- | `parseExpr` is the interior expression grammar (dialect seam). `extras`
-- | allows the Handlebars-only tag shapes — raw blocks `{{{{…}}}}`, the inverse
-- | block `{{^…}}`/`{{{^…}}}`, and unescaped `{{&…}}`. The core *lexer* always
-- | recognizes them (meaning-free); a dialect that doesn't accept them (RawBars,
-- | MaxBars) sets `extras = false` and the parser rejects them.
-- | `parseHead` parses a *block-open* tag's head (`{{# … }}`); it defaults to
-- | `parseExpr` (so the head reads exactly like any other interior), but a
-- | dialect may override it to parse the head specially — MaxBars uses this to
-- | read `{{#if a && b}}` as `if (a && b)` (the helper name then a single infix
-- | condition), which the uniform expression grammar cannot, since application
-- | binds tighter than the operators. Only block opens consult it; output,
-- | separators, closes, and raw blocks keep `parseExpr`.
-- | `inheritance` gates the Mustache-inheritance block shapes — the parent tag
-- | `{{<name}}…{{/name}}` (`Parent`) and the override-block tag
-- | `{{$name}}…{{/name}}` (`BlockDef`), each with a dynamic `*`-headed spelling.
-- | The core *lexer* always recognizes them (meaning-free shapes); a dialect that
-- | doesn't accept them sets `inheritance = false` (the default) and the parser
-- | rejects them with `DisallowedShape`, exactly as `extras` gates `{{^}}`/`{{&}}`.
-- | `standaloneSeps` are the separator head-names whose *standalone* lines the
-- | whitespace pass strips (the engine's clause markers `["else", "elif"]`) — so
-- | a lone `{{else}}`/`{{elif …}}` leaves no blank line, while an arbitrary
-- | `{{ x }}` separator (indistinguishable from output) is left alone.
type ParseOptions =
  { trimStandalone :: Boolean
  , parseExpr :: ExprParser
  , parseHead :: ExprParser
  , extras :: Boolean
  , inheritance :: Boolean
  -- opt-in for the Handlebars block sigils the core now lexes structurally:
  -- `decorators` accepts `{{#*name}}` (inline-partial decorator), `partialBlocks`
  -- accepts `{{#>name}}` (partial block). Off ⇒ a located `DisallowedShape`.
  , decorators :: Boolean
  , partialBlocks :: Boolean
  , standaloneSeps :: Array String
  , lexOptions :: LexOptions
  , lexConfig :: LexConfig
  }

-- | Standalone trimming on (Handlebars parity), the core expression grammar, and
-- | Handlebars-extras allowed (the engine + FullBars use this; RawBars/MaxBars
-- | override `extras = false`).
defaultParseOptions :: ParseOptions
defaultParseOptions =
  { trimStandalone: true
  , parseExpr: Expr.parseExpr
  , parseHead: Expr.parseExpr
  , extras: true
  , inheritance: false
  -- the FullBars surface accepts both Handlebars block sigils; austere dialects
  -- (RawBars/MinBars/MaxBars) turn these off in their own options.
  , decorators: true
  , partialBlocks: true
  , standaloneSeps: [ "else", "elif" ]
  , lexOptions: defaultLexOptions
  , lexConfig: defaultLexConfig
  }

-- | Parse source text into the core template *plus* its header directives, with
-- | the default options. The directives are a meaning-free list the engine
-- | interprets later (see `FlatBars.Syntax.Directive`); the `Template` is the
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
  toks <- tokenizeTemplate opts.lexConfig src
  directives <- collectDirectives toks
  standalone <- effectiveTrim opts directives
  let toks' = if standalone then trimStandalone opts.standaloneSeps toks else toks
  -- comments carry no output; drop them before the tree builder, which then
  -- never has to know about `RComment` (the standalone pass needs them, so it
  -- runs first).
  res <- parseSeq opts.parseExpr opts.parseHead (gatesOf opts) opts.lexOptions
    (Array.filter (not <<< isComment) toks')
    0
  case res.stop of
    StopEOF -> Right { directives, nodes: res.nodes }
    StopClose name _ -> Left (MismatchedBlock "<none>" name 0)

-- | Build the node tree from an *already tokenized* (and, where a dialect wants
-- | it, already whitespace-trimmed) `RawTok` stream. This is the same tree
-- | builder `parseWith` uses internally, exposed so a dialect can interpose its
-- | own token-stream pass — e.g. MinBars' Mustache standalone-whitespace +
-- | partial-indentation pass — between tokenizing and building, without the core
-- | committing to that pass. Comments are dropped here (they carry no output);
-- | any standalone pass that needs them must therefore run *before* this. The
-- | core's own `parseWith` path is unchanged, so other engines are unaffected.
buildFromTokens :: ParseOptions -> Array RawTok -> Either ParseError Template
buildFromTokens opts toks = do
  res <- parseSeq opts.parseExpr opts.parseHead (gatesOf opts) opts.lexOptions
    (Array.filter (not <<< isComment) toks)
    0
  case res.stop of
    StopEOF -> Right res.nodes
    StopClose name _ -> Left (MismatchedBlock "<none>" name 0)

isComment :: RawTok -> Boolean
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
outputExpr :: LexOptions -> ExprParser -> Span -> Int -> String -> Either ParseError Expr
outputExpr lx pe span base s
  | trim s == "" = Left (EmptyOutput span.start)
  | otherwise = tokenizeInterior lx base s >>= pe

-- | A *headed* tag (`{{# name args}}`, `{{name args}}`, `{{/name}}`, raw): its
-- | interior is one application whose head names the helper/block/separator.
headed
  :: LexOptions
  -> ExprParser
  -> Span
  -> Int
  -> String
  -> Either ParseError { name :: String, args :: Array Expr }
headed lx pe span base s
  | trim s == "" = Left (HeadNotIdent span.start)
  | otherwise = case partialHead <$> tokenizeInterior lx base s >>= pe of
      Left e -> Left e
      Right (App name args) -> Right { name, args }
      Right _ -> Left (HeadNotIdent span.start)

-- | A *leading* `>` is the Handlebars partial tag sigil, not the `gt` operator,
-- | so remap it to a `>` head identifier — `{{> name …}}` then reads as an
-- | application headed by `>` (the rest are its flat arguments, so the
-- | name/context/hash split survives). Meaning-free: the core attaches nothing
-- | to a `>`-named head; FullBars' surface desugar is what reads it as a partial
-- | (other dialects simply see an undefined helper named `>`).
partialHead :: Array PosToken -> Array PosToken
partialHead toks = case Array.uncons toks of
  Just { head: pt, tail } | pt.tok == TOp ">" -> Array.cons (pt { tok = TIdent ">" }) tail
  _ -> toks

-- | Project a `ParseOptions` onto the block-sigil opt-in `Gates` the tree
-- | builder threads through nested blocks.
gatesOf :: ParseOptions -> Gates
gatesOf opts =
  { extras: opts.extras
  , inheritance: opts.inheritance
  , decorators: opts.decorators
  , partialBlocks: opts.partialBlocks
  }

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
-- | The per-block-sigil opt-in gates, carried as one record so the recursive
-- | block descent threads a single value rather than four loose booleans.
type Gates =
  { extras :: Boolean
  , inheritance :: Boolean
  , decorators :: Boolean
  , partialBlocks :: Boolean
  }

parseSeq
  :: ExprParser
  -> ExprParser
  -> Gates
  -> LexOptions
  -> Array RawTok
  -> Int
  -> Either ParseError SeqResult
parseSeq pe ph gates lx toks = go Nil
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
      RLongComment _ -> go acc (i + 1) -- highlight-only token (keepLongComments); never reaches the parser
      RSetDelim _ -> go acc (i + 1) -- renders nothing; the delimiter swap already happened in the lexer
      ROutput span base s -> case outputExpr lx pe span base s of
        Left e -> Left e
        Right e -> go (Output span e : acc) (i + 1)
      -- `{{&x}}` is unescaped output (= `{{{x}}}`); a Handlebars-extra, gated.
      RAmp span base s
        | not gates.extras -> Left (DisallowedShape "{{& }} (unescaped output)" span.start)
        | otherwise -> case outputExpr lx pe span base s of
            Left e -> Left e
            Right e -> go (Output span e : acc) (i + 1)
      RRaw span base s body
        | not gates.extras -> Left (DisallowedShape "{{{{ }}}} (raw block)" span.start)
        | otherwise -> case headed lx pe span base s of
            Left e -> Left e
            Right h -> go (RawBlock span h.name h.args body : acc) (i + 1)
      RSep span base s -> case headed lx pe span base s of
        Right h -> go (Sep span h.name h.args : acc) (i + 1)
        -- A non-empty interior that is a bare literal (`{{42}}`, `{{"x"}}`) is not
        -- an application head, but it is still a valid value — emit it as output,
        -- the same node the triple-stash (`{{{42}}}`) produces. Blocks and closes
        -- still go through `headed`, so `{{#42}}` / `{{/42}}` stay errors. An empty
        -- `{{}}` keeps its HeadNotIdent error (the guard excludes it).
        Left (HeadNotIdent _)
          | trim s /= "" -> case outputExpr lx pe span base s of
              Left e -> Left e
              Right e -> go (Output span e : acc) (i + 1)
        Left e -> Left e
      RClose _ base s -> case headed lx pe { start: base, end: base } base s of
        Left e -> Left e
        Right h -> Right (done acc (StopClose h.name (i + 1)))
      -- `{{^x}}` (Inverse) is a Handlebars-extra, gated; `{{#x}}` (Section) is core.
      -- `{{<x}}` (Parent) / `{{$x}}` (BlockDef) are the Mustache-inheritance shapes,
      -- gated by `inheritance`; the dynamic `*`-headed spelling lexes as the same
      -- sigil with a `*`-led head, so it is matched here too.
      ROpen span sigil base s
        | sigil == Inverse && not gates.extras -> Left
            (DisallowedShape "{{^ }} (inverse block)" span.start)
        | sigil == Parent && not gates.inheritance -> Left
            (DisallowedShape "{{< }} (parent block)" span.start)
        | sigil == BlockDef && not gates.inheritance -> Left
            (DisallowedShape "{{$ }} (override block)" span.start)
        | sigil == Decorator && not gates.decorators -> Left
            (DisallowedShape "{{#* }} (inline-partial decorator)" span.start)
        | sigil == PartialBlock && not gates.partialBlocks -> Left
            (DisallowedShape "{{#> }} (partial block)" span.start)
        | otherwise -> buildBlock acc span sigil base s (i + 1)

  buildBlock :: List Node -> Span -> Sigil -> Int -> String -> Int -> Either ParseError SeqResult
  buildBlock acc span sigil base s i = case headed lx ph span base s of
    Left e -> Left e
    Right h ->
      let
        -- every sigil now carries a clean head (the `>`/`*` markers are consumed by
        -- the lexer into the opener), so the `{{/…}}` close simply repeats the head.
        expected = h.name
      in
        case parseSeq pe ph gates lx toks i of
          Left e -> Left e
          Right inner -> case inner.stop of
            -- point the diagnostic at the *opener* (its span start), not offset 0.
            StopEOF -> Left (MismatchedBlock expected "<eof>" span.start)
            StopClose closed pos
              | closed == expected -> go (Block span sigil h.name h.args inner.nodes : acc) pos
              | otherwise -> Left (MismatchedBlock expected closed span.start)
