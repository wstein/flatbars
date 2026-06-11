-- | The **MaxBars syntactic grammar** — forked from the shared `FlatBars.Parser`
-- | (ADR-041) so the MaxBars surface *owns* its front-end: a change to the shared
-- | parser (for RawBars/ClassicBars/MinBars) can no longer reach MaxBars, and the
-- | MaxBars grammar can be frozen independently for production.
-- |
-- | `parse` turns MaxBars source into a core `Template`. It runs the MaxBars
-- | template scanner (`MaxBars.Lexer.tokenize`) to delimit tags, builds the tree
-- | from the flat token stream, and parses each tag's *interior* (already lexed by
-- | the scanner) through the MaxBars expression grammar (`MaxBars.Expr` — infix
-- | operators + pipes). The shared `ParseOptions`/`Gates` knobs are **gone**: the
-- | MaxBars config is baked in (no `extras`/`inheritance`/`decorators`/… seam, the
-- | interior grammar is fixed), so `parse` is an argument-free `String → Template`.
-- |
-- | The fork is front-end only — it emits the same `Syntax` AST (`Content` /
-- | `Output` / `Block` / `Sep` / `RawBlock`) the shared back-end (desugar /
-- | engine / compile) reads. The Handlebars/Mustache shapes MaxBars rejects
-- | (`{{&}}` unescaped output, the `{{^}}` inverse block, the `{{<`/`{{$`
-- | inheritance sigils, the `{{#*}}`/`{{#>}}` decorators, and the bare
-- | `{{{{name}}}}` raw block) are *unconditionally* rejected here with a located
-- | `DisallowedShape` — no gate boolean, the rejection is the grammar.
module MaxBars.Parser
  ( parse
  , parseRecovering
  , ParseResult
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
import FlatBars.Span (Span)
import FlatBars.Syntax (Directive, Expr(..), Node(..), Sigil(..), Template)
import FlatBars.Token (Interior, PosToken, Token(..))
import MaxBars.Expr (parseMaxExpr, parseMaxHead)
import MaxBars.Lexer (RawTok(..), tokenize, trimStandalone)

-- | A tag-interior expression parser: it consumes the interior **token stream**
-- | (the scanner pre-lexes interiors via `FlatBars.Token.tokenizeInterior`; this
-- | parses those tokens into an `Expr`). MaxBars plugs in two — `parseMaxExpr`
-- | (the output/value grammar) and `parseMaxHead` (the `name arg*` head grammar);
-- | the structural tree-builder below is grammar-agnostic.
type ExprParser = Array PosToken -> Either ParseError Expr

-- | MaxBars' clause-separator head names. A bare `{{ name args }}` tag whose head
-- | is one of these is a *clause marker* parsed through `parseMaxHead` (`name
-- | arg*`, so `{{elif a < b}}` reads `elif (lt a b)`); any other bare tag is an
-- | output expression parsed through `parseMaxExpr` (so `{{ a && b }}` stays
-- | `and(a,b)`). `{{when}}` is the clause of `{% case %}` (docs/12), `else`/`elif`
-- | of `{% if %}`. The same list governs standalone-line trimming.
maxClauseSeps :: Array String
maxClauseSeps = [ "else", "elif", "when" ]

-- | Parse MaxBars source text into the core template *plus* its header directives.
-- | The directives are a meaning-free list the engine interprets later (see
-- | `FlatBars.Syntax.Directive`); the `Template` is the node tree (comments
-- | stripped). The fail-fast projection over `parseRecovering`.
parse
  :: String
  -> Either (NonEmptyArray ParseError) { directives :: Array Directive, nodes :: Template }
parse src =
  let
    r = parseRecovering src
  in
    case NEA.fromArray r.errors of
      Just es -> Left es
      Nothing -> Right { directives: r.directives, nodes: r.nodes }

-- | A *recovering* parse (ADR-023). It never bails on the first error: it keeps
-- | scanning, dropping `NodeError` markers and recording every parse error in
-- | source order, so it returns a best-effort tree plus ALL errors. Editor
-- | tooling (`flatbars-lsp` diagnostics) consumes this; `parse` is its fail-fast
-- | projection. There is one parser — fail-fast is a policy over it.
type ParseResult = { directives :: Array Directive, nodes :: Template, errors :: Array ParseError }

parseRecovering :: String -> ParseResult
parseRecovering src = case tokenize src of
  -- a lex error breaks the token stream itself, so nothing downstream can run.
  Left e -> { directives: [], nodes: [], errors: [ e ] }
  Right toks ->
    let
      dirRes = collectDirectives toks
      directives = either (const []) identity dirRes
      dirErrs = either Array.singleton (const []) dirRes
      trimRes = effectiveTrim directives
      standalone = either (const false) identity trimRes
      trimErrs = either Array.singleton (const []) trimRes
      toks' = if standalone then trimStandalone maxClauseSeps toks else toks
      -- comments carry no output; drop them before the tree builder. Each tag
      -- already carries its pre-lexed interior (from `tokenize`). The recovering
      -- lexer's `RError` markers survive: `parseSeq` records each one's structural
      -- error (in source order) and drops a `NodeError` in its place.
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
      r = parseSeq toks idx
      nodes' = accNodes <> r.nodes
      errs' = accErrs <> r.errors
    in
      case r.stop of
        StopEOF -> { nodes: nodes', errors: errs' }
        StopClose name pos -> runSeq toks pos nodes'
          (Array.snoc errs' (MismatchedBlock "<none>" name 0))

isComment :: RawTok -> Boolean
isComment = case _ of
  RComment _ _ _ -> true
  _ -> false

-- | The effective standalone-trim setting: a `@trim` header directive overrides
-- | the MaxBars default (on). `@trim: standalone` ⇒ on, `@trim: none` ⇒ off; any
-- | other value is a parse error. `@trim` is the one *syntactic* directive the
-- | core itself acts on; every other directive is carried meaning-free for an
-- | engine (or, like `@truthiness`, is inert — ADR-022).
effectiveTrim :: Array Directive -> Either ParseError Boolean
effectiveTrim directives = case Array.find (\d -> d.key == "trim") directives of
  Nothing -> Right true
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
-- | (`tokenize` already ran `tokenizeInterior`). An empty interior (`Right []`,
-- | i.e. blank or whitespace-only) is `EmptyOutput` at the tag's offset (not the
-- | interior's), matching the diagnostics tests; an interior lex error rides
-- | through as `Left`.
outputExpr :: ExprParser -> Span -> Interior -> Either ParseError Expr
outputExpr pe span = case _ of
  Left e -> Left e
  Right toks
    | Array.null toks -> Left (EmptyOutput span.start)
    | otherwise -> pe toks

-- | A *headed* tag (`{{# name args}}`, `{{name args}}`, `{{/name}}`, raw): its
-- | interior is one application whose head names the helper/block/separator.
headed
  :: ExprParser
  -> Span
  -> Interior
  -> Either ParseError { name :: String, args :: Array Expr }
headed pe span = case _ of
  Left e -> Left e
  Right toks
    | Array.null toks -> Left (HeadNotIdent span.start)
    | otherwise -> case pe (partialHead toks) of
        Left e -> Left e
        Right (App name args) -> Right { name, args }
        Right _ -> Left (HeadNotIdent span.start)

-- | A *leading* `>` is the partial tag sigil, not the `gt` operator, so remap it
-- | to a `>` head identifier — `{{> name …}}` then reads as an application headed
-- | by `>` (the rest are its flat arguments, so the name/context/hash split
-- | survives). Meaning-free: the core attaches nothing to a `>`-named head; the
-- | surface desugar is what reads it as a partial.
partialHead :: Array PosToken -> Array PosToken
partialHead toks = case Array.uncons toks of
  Just { head: pt, tail } | pt.tok == TOp ">" -> Array.cons (pt { tok = TIdent ">" }) tail
  _ -> toks

-- | Is this bare-tag interior a *clause separator* — does it lead with one of the
-- | engine's clause-marker names (`else`/`elif`/`when`)? Such a tag (`{{elif a <
-- | b}}`) is a head and is parsed through `parseMaxHead` (`name arg*`), so its
-- | args read like a block head's: `elif (lt a b)`, not the `lt ((elif a)) b` the
-- | output grammar would fold. Every other bare tag (`{{ a && b }}`, `{{ x }}`,
-- | `{{42}}`) stays an output expression parsed through `parseMaxExpr`.
sepHeadIsClause :: Array String -> Interior -> Boolean
sepHeadIsClause seps = case _ of
  Right toks -> case _.tok <$> Array.head toks of
    Just (TIdent n) -> Array.elem n seps
    _ -> false
  Left _ -> false

-- | `headed`, but for the *recovering* parser: it never discards everything on a
-- | failure. When the interior won't parse it still salvages the head identifier
-- | (the leading token) so a block can keep nesting — `{{#if a == 1}}` yields name
-- | `"if"`, no args, and the args error. Only a genuinely head-less interior (no
-- | leading identifier) yields `name = Nothing`.
headedRecovering
  :: ExprParser
  -> Span
  -> Interior
  -> { name :: Maybe String, args :: Array Expr, error :: Maybe ParseError }
headedRecovering pe span = case _ of
  Left e -> { name: Nothing, args: [], error: Just e }
  Right toks
    | Array.null toks -> { name: Nothing, args: [], error: Just (HeadNotIdent span.start) }
    | otherwise -> case pe (partialHead toks) of
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

-- | Parse a run of nodes starting at index `i`, stopping at end of input or at a
-- | close `{{/name}}`. A block captures a single body; multi-branch control flow
-- | is expressed as nested clause blocks the engine interprets. MaxBars's
-- | interior grammar (`parseMaxExpr`/`parseMaxHead`) and clause-marker set
-- | (`maxClauseSeps`) are baked in — there is no `Gates`/options seam.
parseSeq
  :: Array RawTok
  -> Int
  -> SeqResult
parseSeq toks = go Nil []
  where
  -- Siblings accumulate in a *reversed* `List` (O(1) prepend); the finished run
  -- is reversed into an `Array` once. Building the `Template` with `Array.snoc`
  -- per node would be O(n²).
  done :: List Node -> Array ParseError -> Stop -> SeqResult
  done acc errs stop = { nodes: Array.fromFoldable (List.reverse acc), stop, errors: errs }

  -- A recovered error: drop a `NodeError` marker in place, record the error in
  -- source order, and carry on. Tail-recursive like every other arm.
  recover :: List Node -> Array ParseError -> Span -> ParseError -> Int -> SeqResult
  recover acc errs sp e next =
    go (NodeError sp (parseErrorMessage e) : acc) (Array.snoc errs e) next

  -- The linear sibling scan. Every recursive `go` call is kept in *tail* position
  -- (explicit `case`, never `do`) so PureScript loops it — otherwise a bind-
  -- wrapped recursive call defeats the tail-call optimization for the whole
  -- function and a long node sequence overflows the stack. (Block *nesting* still
  -- recurses through `parseSeq`, but that depth is bounded by how deep blocks
  -- nest, not by sequence length.) `go` always recovers and returns a tree;
  -- errors travel in the accumulator.
  go :: List Node -> Array ParseError -> Int -> SeqResult
  go acc errs i = case Array.index toks i of
    Nothing -> done acc errs StopEOF
    Just t -> case t of
      RContent sp s -> go (Content sp s : acc) errs (i + 1)
      RComment _ _ _ -> go acc errs (i + 1) -- filtered upstream; skip defensively
      RLongComment _ -> go acc errs (i + 1) -- highlight-only token (keepLongComments); never reaches the parser
      -- An unterminated construct from the recovering lexer (ADR-023): record its
      -- structural error in source order and drop a `NodeError` marker in place.
      RError sp e -> recover acc errs sp e (i + 1)
      ROutput span _ _ int -> case outputExpr parseMaxExpr span int of
        Left e -> recover acc errs span e (i + 1)
        Right e -> go (Output span e : acc) errs (i + 1)
      -- `{{&x}}` is Handlebars unescaped output — not a MaxBars shape, rejected.
      RAmp span _ _ _ -> recover acc errs span
        (DisallowedShape "{{& }} (unescaped output)" span.start)
        (i + 1)
      -- Raw blocks: MaxBars uses the `{{{{#name}}}}` spelling (`hash`); the bare
      -- Handlebars `{{{{name}}}}` form is rejected. `int` is the HEAD interior
      -- (the body stays verbatim).
      RRaw span hash _ _ int body
        | not hash -> recover acc errs span
            (DisallowedShape "{{{{ }}}} (raw block)" span.start)
            (i + 1)
        | otherwise -> case headed parseMaxExpr span int of
            Left e -> recover acc errs span e (i + 1)
            Right h -> go (RawBlock span h.name h.args body : acc) errs (i + 1)
      -- A bare `{{ … }}` tag. A *clause separator* (head ∈ `maxClauseSeps`, e.g.
      -- `{{elif …}}`/`{{else}}`) is a head, parsed through `parseMaxHead` so its
      -- infix args read like a block head's (`{{elif a < b}}` → `elif (lt a b)`).
      -- Every other bare tag is an output expression, parsed through `parseMaxExpr`
      -- (`{{ a && b }}` → `and(a,b)`).
      RSep span _ s int ->
        let
          hp = if sepHeadIsClause maxClauseSeps int then parseMaxHead else parseMaxExpr
        in
          case headed hp span int of
            Right h -> go (Sep span h.name h.args : acc) errs (i + 1)
            -- A non-empty interior that is a bare literal (`{{42}}`, `{{"x"}}`) is
            -- not an application head, but it is still a valid value — emit it as
            -- output, the same node `{{{42}}}` produces. An empty `{{}}` keeps its
            -- HeadNotIdent error (the guard excludes it).
            Left (HeadNotIdent _)
              | trim s /= "" -> case outputExpr parseMaxExpr span int of
                  Left e -> recover acc errs span e (i + 1)
                  Right e -> go (Output span e : acc) errs (i + 1)
            Left e -> recover acc errs span e (i + 1)
      RClose span base _ int -> case headed parseMaxExpr { start: base, end: base } int of
        -- A malformed close head can't name a block; flag it and keep scanning, so
        -- the enclosing block still reports its own missing close.
        Left e -> recover acc errs span e (i + 1)
        Right h -> done acc errs (StopClose h.name (i + 1))
      -- Block openers. `{{#x}}` (`Section`) is the only shape MaxBars accepts; the
      -- Handlebars `{{^}}` inverse, the `{{<`/`{{$` inheritance sigils, and the
      -- `{{#*}}`/`{{#>}}` decorators are rejected. A rejection is *recoverable*:
      -- the shape is structurally valid (so it still nests), it is just not part
      -- of the MaxBars grammar — recorded via `gateErr` on the block.
      ROpen span sigil _ _ int -> case sigil of
        Section -> buildBlock acc errs Nothing span sigil int (i + 1)
        Inverse -> buildBlock acc errs (Just (DisallowedShape "{{^ }} (inverse block)" span.start))
          span
          sigil
          int
          (i + 1)
        Parent -> buildBlock acc errs (Just (DisallowedShape "{{< }} (parent block)" span.start))
          span
          sigil
          int
          (i + 1)
        BlockDef ->
          buildBlock acc errs (Just (DisallowedShape "{{$ }} (override block)" span.start)) span
            sigil
            int
            (i + 1)
        Decorator ->
          buildBlock acc errs
            (Just (DisallowedShape "{{#* }} (inline-partial decorator)" span.start))
            span
            sigil
            int
            (i + 1)
        PartialBlock ->
          buildBlock acc errs (Just (DisallowedShape "{{#> }} (partial block)" span.start)) span
            sigil
            int
            (i + 1)

  -- A block opener, recovering. `gateErr` is a grammar rejection recorded
  -- alongside any head error. A *salvageable* head (a leading identifier, even if
  -- the args won't parse) still nests, so the body and close parse and only the
  -- bad args/shape are flagged; an unsalvageable head degrades to a `NodeError`
  -- and the scan resumes after the opener.
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
      hr = headedRecovering parseMaxHead span interior
      errs1 = errs <> Array.catMaybes [ gateErr, hr.error ]
    in
      case hr.name of
        Nothing -> go (NodeError span (maybe "parse error" parseErrorMessage hr.error) : acc) errs1
          i
        Just name ->
          let
            inner = parseSeq toks i
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
