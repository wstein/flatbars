-- | The syntactic grammar. See `docs/modules/ROOT/pages/grammar.adoc`.
-- |
-- | `parse` turns source text into a core `Template`. It runs the template
-- | scanner (`Lexer.tokenizeTemplate`) to delimit tags, builds the tree from the
-- | flat token stream, and parses each tag's *interior* by first lexing it into
-- | an interior token stream (`FlatBars.Token.tokenizeInterior`) and then handing
-- | those tokens to the core prefix grammar (`FlatBars.Expr`). This serves
-- | RawBars/ClassicBars/MinBars, whose head and output grammars are identical;
-- | MaxBars, which needed a distinct infix head grammar, owns its own parser
-- | (`MaxBars.Parser`, ADR-041).
module FlatBars.Parser
  ( parse
  , parseWith
  , parseRecovering
  , ParseResult
  , ParseOptions
  , defaultParseOptions
  , buildFromTokens
  , collectDirectives
  ) where

import Prelude

import Data.Array as Array
import Data.Array.NonEmpty (NonEmptyArray)
import Data.Array.NonEmpty as NEA
import Data.Either (Either(..), either)
import Data.List (List(..), (:))
import Data.List as List
import Data.Maybe (Maybe(..), maybe)
import Data.String (trim)
import Data.String.CodeUnits as SCU
import FlatBars.Error (ParseError(..), parseErrorMessage)
import FlatBars.Expr as Expr
import FlatBars.Lexer (LexConfig, RawTok(..), defaultLexConfig, tokenizeTemplate, trimStandalone)
import FlatBars.Span (Span)
import FlatBars.Syntax (Directive, Expr(..), Node(..), Sigil(..), Template)
import FlatBars.Token (Interior, PosToken, Token(..))

-- | Knobs the *front-end* (CLI/host) sets; per-file `@`-directives may override
-- | them. `trimStandalone` toggles Handlebars-style standalone whitespace
-- | removal (default on; a `@trim: standalone | none` directive wins over it).
-- | The interior expression grammar is the core prefix grammar (`FlatBars.Expr`)
-- | for every dialect this parser serves (RawBars/ClassicBars/MinBars); their head
-- | and output grammars are identical, so there is no head/output seam. MaxBars,
-- | which needed a distinct infix head grammar, owns its own parser now (ADR-041).
-- | `extras` allows the Handlebars-only tag shapes — raw blocks `{{{{…}}}}`, the
-- | inverse block `{{^…}}`/`{{{^…}}}`, and unescaped `{{&…}}`. The core *lexer*
-- | always recognizes them (meaning-free); a dialect that doesn't accept them
-- | (RawBars) sets `extras = false` and the parser rejects them.
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
  , extras :: Boolean
  , inheritance :: Boolean
  -- opt-in for the Handlebars block sigils the core now lexes structurally:
  -- `decorators` accepts `{{#*name}}` (inline-partial decorator), `partialBlocks`
  -- accepts `{{#>name}}` (partial block). Off ⇒ a located `DisallowedShape`.
  , decorators :: Boolean
  , partialBlocks :: Boolean
  -- raw blocks have two spellings gated separately: `rawBlockHbs` accepts the bare
  -- `{{{{name}}}}` (the real Handlebars form — ClassicBars only), `rawBlockHash`
  -- accepts the FlatBars `{{{{#name}}}}` form (RawBars/MaxBars). Mustache has
  -- neither, so MinBars sets both off.
  , rawBlockHbs :: Boolean
  , rawBlockHash :: Boolean
  , standaloneSeps :: Array String
  , lexConfig :: LexConfig
  }

-- | Standalone trimming on (Handlebars parity) and Handlebars-extras allowed (the
-- | engine + ClassicBars use this; RawBars overrides `extras = false`).
defaultParseOptions :: ParseOptions
defaultParseOptions =
  { trimStandalone: true
  , extras: true
  , inheritance: false
  -- the ClassicBars surface accepts both Handlebars block sigils; austere dialects
  -- (RawBars/MinBars/MaxBars) turn these off in their own options.
  , decorators: true
  , partialBlocks: true
  -- the default is the ClassicBars stance: the Handlebars `{{{{name}}}}` raw block is
  -- accepted; the FlatBars `{{{{#name}}}}` spelling is not (Handlebars rejects it).
  , rawBlockHbs: true
  , rawBlockHash: false
  , standaloneSeps: [ "else", "elif" ]
  , lexConfig: defaultLexConfig
  }

-- | Parse source text into the core template *plus* its header directives, with
-- | the default options. The directives are a meaning-free list the engine
-- | interprets later (see `FlatBars.Syntax.Directive`); the `Template` is the
-- | node tree (comments stripped). See `docs/.../grammar.adoc`.
parse
  :: String
  -> Either (NonEmptyArray ParseError) { directives :: Array Directive, nodes :: Template }
parse = parseWith defaultParseOptions

-- | A *recovering* parse (ADR-023). It never bails on the first error: it keeps
-- | scanning, dropping `NodeError` markers and recording every parse error in
-- | source order, so it returns a best-effort tree plus ALL errors. Editor
-- | tooling (`flatbars-lsp` diagnostics) consumes this; `parse`/`parseWith` are
-- | its fail-fast projection. There is one parser — fail-fast is a policy over it.
type ParseResult = { directives :: Array Directive, nodes :: Template, errors :: Array ParseError }

parseRecovering :: ParseOptions -> String -> ParseResult
parseRecovering opts src = case tokenizeTemplate opts.lexConfig src of
  -- a lex error breaks the token stream itself, so nothing downstream can run.
  Left e -> { directives: [], nodes: [], errors: [ e ] }
  Right toks ->
    let
      dirRes = collectDirectives toks
      directives = either (const []) identity dirRes
      dirErrs = either Array.singleton (const []) dirRes
      trimRes = effectiveTrim opts directives
      standalone = either (const false) identity trimRes
      trimErrs = either Array.singleton (const []) trimRes
      toks' = if standalone then trimStandalone opts.standaloneSeps toks else toks
      -- comments carry no output; drop them before the tree builder. Each tag
      -- already carries its pre-lexed interior (from `tokenizeTemplate`). The
      -- recovering lexer's `RError` markers survive: `parseSeq` records each one's
      -- structural error (in source order) and drops a `NodeError` in its place.
      filtered = Array.filter (not <<< isComment) toks'
      seq = runSeq filtered 0 [] []
    in
      { directives, nodes: seq.nodes, errors: dirErrs <> trimErrs <> seq.errors }
  where
  -- The top-level loop: a `{{/x}}` with no open is a stray close — record it and
  -- recover past it so the rest of the document still parses.
  runSeq
    :: Array RawTok
    -> Int
    -> Template
    -> Array ParseError
    -> { nodes :: Template, errors :: Array ParseError }
  runSeq toks idx accNodes accErrs =
    let
      r = parseSeq (gatesOf opts) toks idx
      nodes' = accNodes <> r.nodes
      errs' = accErrs <> r.errors
    in
      case r.stop of
        StopEOF -> { nodes: nodes', errors: errs' }
        StopClose name pos -> runSeq toks pos nodes'
          (Array.snoc errs' (MismatchedBlock "<none>" name 0))

-- | `parse` with explicit front-end options (the CLI/config path). The fail-fast
-- | projection over `parseRecovering`: a well-formed template (no recovered
-- | errors) is `Right`; otherwise `Left` the first error in source order, exactly
-- | as the total parser always did. There is no second parser to drift.
parseWith
  :: ParseOptions
  -> String
  -> Either (NonEmptyArray ParseError) { directives :: Array Directive, nodes :: Template }
parseWith opts src =
  let
    r = parseRecovering opts src
  in
    case NEA.fromArray r.errors of
      Just es -> Left es
      Nothing -> Right { directives: r.directives, nodes: r.nodes }

-- | Build the node tree from an *already tokenized* (and, where a dialect wants
-- | it, already whitespace-trimmed) `RawTok` stream. This is the same tree
-- | builder `parseWith` uses internally, exposed so a dialect can interpose its
-- | own token-stream pass — e.g. MinBars' Mustache standalone-whitespace +
-- | partial-indentation pass — between tokenizing and building, without the core
-- | committing to that pass. Comments are dropped here (they carry no output);
-- | any standalone pass that needs them must therefore run *before* this. Fail-
-- | fast, like `parseWith` (it projects the recovering `parseSeq`).
buildFromTokens :: ParseOptions -> Array RawTok -> Either (NonEmptyArray ParseError) Template
buildFromTokens opts toks =
  let
    -- Each tag already carries its pre-lexed interior (`tokenizeTemplate`, or a
    -- dialect pass that re-tokenized after mutating it — see MinBars' Mustache
    -- standalone/partial-indent pass).
    r = parseSeq (gatesOf opts)
      (Array.filter (not <<< isComment) toks)
      0
  in
    case NEA.fromArray r.errors of
      Just es -> Left es
      Nothing -> case r.stop of
        StopEOF -> Right r.nodes
        StopClose name _ -> Left (NEA.singleton (MismatchedBlock "<none>" name 0))

isComment :: RawTok -> Boolean
isComment = case _ of
  RComment _ _ _ -> true
  _ -> false

-- | The effective standalone-trim setting: a `@trim` header directive overrides
-- | the front-end option. `@trim: standalone` ⇒ on, `@trim: none` ⇒ off; any
-- | other value is a parse error. `@trim` is the one *syntactic* directive the
-- | core itself acts on; every other directive is carried meaning-free for an
-- | engine (or, like `@truthiness`, is inert — ADR-022).
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
    Just (RContent _ _) -> go (i + 1) headerOpen acc -- content does not close the header
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

-- | The single `Expr` filling an output tag, over the tag's pre-lexed interior
-- | (`tokenizeTemplate` already ran `tokenizeInterior`). An empty interior
-- | (`Right []`, i.e. blank or whitespace-only) is `EmptyOutput` at the tag's
-- | offset (not the interior's), matching the diagnostics tests; an interior lex
-- | error rides through as `Left`.
outputExpr :: Span -> Interior -> Either ParseError Expr
outputExpr span = case _ of
  Left e -> Left e
  Right toks
    | Array.null toks -> Left (EmptyOutput span.start)
    | otherwise -> Expr.parseExpr toks

-- | A *headed* tag (`{{# name args}}`, `{{name args}}`, `{{/name}}`, raw): its
-- | interior is one application whose head names the helper/block/separator.
headed
  :: Span
  -> Interior
  -> Either ParseError { name :: String, args :: Array Expr }
headed span = case _ of
  Left e -> Left e
  Right toks
    | Array.null toks -> Left (HeadNotIdent span.start)
    | otherwise -> case Expr.parseExpr (partialHead toks) of
        Left e -> Left e
        Right (App name args) -> Right { name, args }
        Right _ -> Left (HeadNotIdent span.start)

-- | A *leading* `>` is the Handlebars partial tag sigil, not the `gt` operator,
-- | so remap it to a `>` head identifier — `{{> name …}}` then reads as an
-- | application headed by `>` (the rest are its flat arguments, so the
-- | name/context/hash split survives). Meaning-free: the core attaches nothing
-- | to a `>`-named head; ClassicBars' surface desugar is what reads it as a partial
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
  , rawBlockHbs: opts.rawBlockHbs
  , rawBlockHash: opts.rawBlockHash
  }

-- | `headed`, but for the *recovering* parser: it never discards everything on a
-- | failure. When the interior won't parse it still salvages the head identifier
-- | (the leading token) so a block can keep nesting — `{{#if a == 1}}` yields
-- | name `"if"`, no args, and the args error. Only a genuinely head-less interior
-- | (no leading identifier) yields `name = Nothing`.
headedRecovering
  :: Span
  -> Interior
  -> { name :: Maybe String, args :: Array Expr, error :: Maybe ParseError }
headedRecovering span = case _ of
  Left e -> { name: Nothing, args: [], error: Just e }
  Right toks
    | Array.null toks -> { name: Nothing, args: [], error: Just (HeadNotIdent span.start) }
    | otherwise -> case Expr.parseExpr (partialHead toks) of
        Right (App name args) -> { name: Just name, args, error: Nothing }
        Right _ -> { name: Nothing, args: [], error: Just (HeadNotIdent span.start) }
        Left e -> { name: salvageName (partialHead toks), args: [], error: Just e }

-- | The leading identifier of an interior token stream, if any — the head name a
-- | recovered block keeps even when its arguments don't parse.
salvageName :: Array PosToken -> Maybe String
salvageName toks = case Array.head toks of
  Just { tok: TIdent n } -> Just n
  _ -> Nothing

--------------------------------------------------------------------------------
-- Tree building over the flat RawTok stream
--------------------------------------------------------------------------------

data Stop
  = StopEOF
  | StopClose String Int -- closed name, index after {{/name}}

-- | The recovering tree builder's result: the (best-effort) nodes, the stop
-- | reason, and every error recovered, *in source order* (ADR-023). The total
-- | `parse` is a fail-fast projection over this — empty `errors` ⇒ the tree is
-- | well-formed; a non-empty `errors` ⇒ `Left (head errors)`. Errors are few, so
-- | they accumulate in a forward `Array` (`snoc`); nodes stay a reversed `List`.
type SeqResult = { nodes :: Template, stop :: Stop, errors :: Array ParseError }

-- | Parse a run of nodes starting at index `i`, stopping at end of input or at
-- | a close `{{/name}}`. A block captures a single body; multi-branch control
-- | flow is expressed as nested clause blocks the engine interprets.
-- | The per-block-sigil opt-in gates, carried as one record so the recursive
-- | block descent threads a single value rather than six loose booleans.
type Gates =
  { extras :: Boolean
  , inheritance :: Boolean
  , decorators :: Boolean
  , partialBlocks :: Boolean
  , rawBlockHbs :: Boolean
  , rawBlockHash :: Boolean
  }

parseSeq
  :: Gates
  -> Array RawTok
  -> Int
  -> SeqResult
parseSeq gates toks = go Nil []
  where
  -- Siblings accumulate in a *reversed* `List` (O(1) prepend); the finished
  -- run is reversed into an `Array` once. Building the `Template` with
  -- `Array.snoc` per node would be O(n²).
  done :: List Node -> Array ParseError -> Stop -> SeqResult
  done acc errs stop = { nodes: Array.fromFoldable (List.reverse acc), stop, errors: errs }

  -- A recovered error: drop a `NodeError` marker in place, record the error in
  -- source order, and carry on. Tail-recursive like every other arm.
  recover :: List Node -> Array ParseError -> Span -> ParseError -> Int -> SeqResult
  recover acc errs sp e next =
    go (NodeError sp (parseErrorMessage e) : acc) (Array.snoc errs e) next

  -- The linear sibling scan. Every recursive `go` call is kept in *tail*
  -- position (explicit `case`, never `do`) so PureScript loops it — otherwise a
  -- bind-wrapped recursive call defeats the tail-call optimization for the whole
  -- function and a long node sequence overflows the stack. (Block *nesting* still
  -- recurses through `parseSeq`, but that depth is bounded by how deep blocks
  -- nest, not by sequence length.) `go` no longer returns `Either` — it always
  -- recovers and returns a tree; errors travel in the accumulator.
  go :: List Node -> Array ParseError -> Int -> SeqResult
  go acc errs i = case Array.index toks i of
    Nothing -> done acc errs StopEOF
    Just t -> case t of
      RContent sp s -> go (Content sp s : acc) errs (i + 1)
      RComment _ _ _ -> go acc errs (i + 1) -- filtered upstream; skip defensively
      RLongComment _ -> go acc errs (i + 1) -- highlight-only token (keepLongComments); never reaches the parser
      RSetDelim _ -> go acc errs (i + 1) -- renders nothing; the delimiter swap already happened in the lexer
      -- An unterminated construct from the recovering lexer (ADR-023): record its
      -- structural error in source order and drop a `NodeError` marker in place.
      RError sp e -> recover acc errs sp e (i + 1)
      ROutput span _ _ int -> case outputExpr span int of
        Left e -> recover acc errs span e (i + 1)
        Right e -> go (Output span e : acc) errs (i + 1)
      -- `{{&x}}` is unescaped output (= `{{{x}}}`); a Handlebars-extra, gated.
      RAmp span _ _ int
        | not gates.extras -> recover acc errs span
            (DisallowedShape "{{& }} (unescaped output)" span.start)
            (i + 1)
        | otherwise -> case outputExpr span int of
            Left e -> recover acc errs span e (i + 1)
            Right e -> go (Output span e : acc) errs (i + 1)
      -- Two raw-block spellings, gated separately: `{{{{#name}}}}` (FlatBars,
      -- RawBars/MaxBars) vs the bare `{{{{name}}}}` (Handlebars, ClassicBars only).
      -- `int` is the raw block's HEAD interior (the body stays verbatim).
      RRaw span hash _ _ int body
        | hash && not gates.rawBlockHash -> recover acc errs span
            (DisallowedShape "{{{{# }}}} (raw block)" span.start)
            (i + 1)
        | not hash && not gates.rawBlockHbs -> recover acc errs span
            (DisallowedShape "{{{{ }}}} (raw block)" span.start)
            (i + 1)
        | otherwise -> case headed span int of
            Left e -> recover acc errs span e (i + 1)
            Right h -> go (RawBlock span h.name h.args body : acc) errs (i + 1)
      -- A bare `{{ … }}` tag. Its interior is read by the one core expression
      -- grammar (head and output are identical for the dialects this parser serves
      -- — MaxBars, which distinguished them, owns its own parser now, ADR-041).
      RSep span _ s int ->
        case headed span int of
          Right h -> go (Sep span h.name h.args : acc) errs (i + 1)
          -- A non-empty interior that is a bare literal (`{{42}}`, `{{"x"}}`) is
          -- not an application head, but it is still a valid value — emit it as
          -- output, the same node `{{{42}}}` produces. An empty `{{}}` keeps its
          -- HeadNotIdent error (the guard excludes it).
          Left (HeadNotIdent _)
            | trim s /= "" -> case outputExpr span int of
                Left e -> recover acc errs span e (i + 1)
                Right e -> go (Output span e : acc) errs (i + 1)
          Left e -> recover acc errs span e (i + 1)
      RClose span base _ int -> case headed { start: base, end: base } int of
        -- A malformed close head can't name a block; flag it and keep scanning,
        -- so the enclosing block still reports its own missing close.
        Left e -> recover acc errs span e (i + 1)
        Right h -> done acc errs (StopClose h.name (i + 1))
      -- `{{^x}}` (Inverse) is a Handlebars-extra, gated; `{{#x}}` (Section) is core.
      -- `{{<x}}` (Parent) / `{{$x}}` (BlockDef) are the Mustache-inheritance shapes,
      -- gated by `inheritance`; the dynamic `*`-headed spelling lexes as the same
      -- sigil with a `*`-led head, so it is matched here too. A gate rejection is a
      -- recoverable error: the shape is structurally valid (so it still nests), it
      -- is just disallowed in this dialect — recorded via `gateErr`.
      ROpen span sigil _ _ int
        | sigil == Inverse && not gates.extras ->
            buildBlock acc errs (Just (DisallowedShape "{{^ }} (inverse block)" span.start)) span
              sigil
              int
              (i + 1)
        | sigil == Parent && not gates.inheritance ->
            buildBlock acc errs (Just (DisallowedShape "{{< }} (parent block)" span.start)) span
              sigil
              int
              (i + 1)
        | sigil == BlockDef && not gates.inheritance ->
            buildBlock acc errs (Just (DisallowedShape "{{$ }} (override block)" span.start)) span
              sigil
              int
              (i + 1)
        | sigil == Decorator && not gates.decorators ->
            buildBlock acc errs
              (Just (DisallowedShape "{{#* }} (inline-partial decorator)" span.start))
              span
              sigil
              int
              (i + 1)
        | sigil == PartialBlock && not gates.partialBlocks ->
            buildBlock acc errs (Just (DisallowedShape "{{#> }} (partial block)" span.start)) span
              sigil
              int
              (i + 1)
        | otherwise -> buildBlock acc errs Nothing span sigil int (i + 1)

  -- A block opener, recovering. `gateErr` is a dialect-gate rejection recorded
  -- alongside any head error. A *salvageable* head (a leading identifier, even if
  -- the args won't parse — e.g. `{{#if a == 1}}` in ClassicBars) still nests, so the
  -- body and close parse and only the bad args/shape are flagged; an unsalvageable
  -- head degrades to a `NodeError` and the scan resumes after the opener.
  buildBlock
    :: List Node
    -> Array ParseError
    -> Maybe ParseError
    -> Span
    -> Sigil
    -> Interior
    -> Int
    -> SeqResult
  buildBlock acc errs gateErr span sigil interior i =
    let
      hr = headedRecovering span interior
      errs1 = errs <> Array.catMaybes [ gateErr, hr.error ]
    in
      case hr.name of
        Nothing -> go (NodeError span (maybe "parse error" parseErrorMessage hr.error) : acc) errs1
          i
        Just name ->
          let
            inner = parseSeq gates toks i
            errs2 = errs1 <> inner.errors
            node = Block span sigil name hr.args inner.nodes
          in
            case inner.stop of
              -- missing close: still build the block with the partial body, flag it.
              StopEOF -> go (node : acc)
                (Array.snoc errs2 (MismatchedBlock name "<eof>" span.start))
                (Array.length toks)
              StopClose closed pos
                | closed == name -> go (node : acc) errs2 pos
                -- mismatched close: close the block anyway, flag the mismatch.
                | otherwise -> go (node : acc)
                    (Array.snoc errs2 (MismatchedBlock name closed span.start))
                    pos
