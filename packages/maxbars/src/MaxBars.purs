-- | **MaxBars** — the top tier of the dialect ladder (RawBars ⊂ FullBars ⊂
-- | MaxBars). It is FullBars plus a richer *surface*: infix operators and pipes
-- | (`MaxBars.Expr`). Because that surface desugars to the same core `Expr` that
-- | FullBars already understands, MaxBars reuses FullBars wholesale by
-- | dependency — the engine, prelude, value policy, surface desugar, and the
-- | compiler — swapping only the interior expression grammar through the
-- | `ParseOptions.parseExpr` seam. (A shared semantic *kernel* is extracted
-- | lazily, only for proven overlaps; see the project notes.)
module MaxBars
  ( maxOptions
  , maxLoopVars
  , renderMax
  , renderWithOperations
  , compileMaxJs
  , maxbarsWarnings
  ) where

import Prelude

import Data.Either (Either)
import Data.Tuple (Tuple)
import FlatBars.Error (Error, ParseError)
import FlatBars.Parser (ParseOptions, defaultParseOptions, parseWith)
import FlatBars.Token (infixOperatorChars)
import FlatBars.Value (Value)
import FullBars (LoopVars, desugarSurfaceWith, nonEmpty, renderSurfaceDiagWith, renderSurfaceWithHelpersWith)
import FullBars.Compile (compileSurfaceWith)
import FullBars.Surface (noLoopVars, reservedScope)
import Kernel.Engine (Operation)
import Kernel.Env (RefEnv)
import Kernel.Walk (Issue)
import MaxBars.Expr (parseMaxExpr, parseMaxHead)
import MaxBars.Lint (booleanInOutputWarnings, labelShadowWarnings, strayHeadBarWarnings)

-- | Parse options for the MaxBars dialect: the default front-end knobs
-- | (standalone trimming, …) with the interior grammar swapped for
-- | `MaxBars.Expr` (infix operators + pipes), and the Handlebars-only tag shapes
-- | (`{{{{…}}}}`, `{{^…}}`, `{{&…}}`) rejected (`extras` off) — MaxBars is not the
-- | Handlebars-compatibility dialect.
maxOptions :: ParseOptions
maxOptions =
  defaultParseOptions
    { parseExpr = parseMaxExpr
    , parseHead = parseMaxHead
    , extras = false
    -- inline partials in MaxBars use the bare `{{#inline}}` form (the old model);
    -- the `{{#*}}` decorator and `{{#>}}` partial block stay gated off.
    , decorators = false
    , partialBlocks = false
    -- like RawBars, MaxBars uses the FlatBars `{{{{#name}}}}` raw-block spelling,
    -- not the Handlebars bare `{{{{name}}}}` form.
    , rawBlockHbs = false
    , rawBlockHash = true
    , lexOptions = { operatorChars: infixOperatorChars }
    -- Set delimiters are NOT enabled (per ADR-015 amendment): `{{=<% %>=}}` is
    -- a Mustache feature reserved for MinBars. RawBars / MaxBars / FullBars all
    -- reject it so the dialect ladder has one consistent answer to "does
    -- delimiter switching work here?" — yes only on the Mustache surface.
    }

-- | MaxBars' surface variable resolver (ADR-021). There are *no bare loop
-- | variables*: a bare `{{first}}`/`{{index0}}` is an ordinary data field. Loop
-- | state is read through the `loop` object (`{{loop.first}}`, `{{loop.index0}}`),
-- | the enclosing context through `parent`/`parent.parent`, and the root through
-- | `root` — all turned on by wrapping `noLoopVars` with `reservedScope`, which
-- | makes the desugar treat `loop`/`root`/`parent` as scope-declared reserved
-- | names. (Superseded ADR-006's bare-variable vocabulary and its shadow footgun.)
maxLoopVars :: LoopVars
maxLoopVars = reservedScope noLoopVars

-- | Render MaxBars surface source against data, reusing FullBars' surface
-- | pipeline (desugar → hoist → engine) with located errors and MaxBars' bare
-- | loop variables.
renderMax :: String -> Value -> Either String String
renderMax = renderSurfaceDiagWith false maxLoopVars maxOptions nonEmpty

-- | Render MaxBars source with host-registered *operations* (ADR-019 addendum) —
-- | the same `renderSurfaceWithHelpersWith` path FullBars uses, over MaxBars' own
-- | surface (`maxLoopVars` / `maxOptions`). A block operation gets the full surface:
-- | `options.hash`, `options.fn(ctx, { data, blockParams })`, and `options.inverse`.
-- | Block params (`as |a b|`) parse because the MaxBars head grammar omits the pipe
-- | rung (a bar in head position is the block-param delimiter); pipe a block
-- | argument by parenthesising it (`{{#each (xs | f) as |x|}}`).
-- | "operation" is the native boundary word; FullBars' twin is `renderWith` (helper).
renderWithOperations
  :: Array (Tuple String (Operation (Either Error) (RefEnv (Either Error))))
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String String
renderWithOperations = renderSurfaceWithHelpersWith false maxLoopVars maxOptions nonEmpty

-- | Compile MaxBars surface source to a JS ES module, reusing the FullBars
-- | compiler (`FlatBars.Compile`) — infix/pipe and loop vars desugar to the same
-- | core helpers the emit rules already handle.
compileMaxJs :: String -> Either ParseError String
compileMaxJs = compileSurfaceWith false maxLoopVars maxOptions "rt.truthyNonEmpty"

-- | The MaxBars source warnings (schema-less *warn-always* tier). Parses `src`,
-- | desugars, then runs the dialect lints (see `MaxBars.Lint`); a parse error
-- | short-circuits. Two warnings:
-- |
-- |  * *label shadow* (ADR-021): a loop `label NAME` whose name is a reserved root
-- |    (`this`/`loop`/`root`/`parent`).
-- |  * *stray head bar* (ADR-019): an unparenthesised top-level `|` in a block
-- |    head, parsed as structure rather than the pipe operator — the fix is to
-- |    parenthesise the pipe, `{{#x (a | f)}}`.
maxbarsWarnings :: String -> Either ParseError (Array Issue)
maxbarsWarnings src = do
  { nodes } <- parseWith maxOptions src
  -- label shadows read the *desugared* tree (a label survives as the `@label`
  -- marker); the stray-bar lint reads the *parsed* tree (the desugar rewrites a
  -- bare bar into a `lookup`, erasing the signal).
  let desugared = desugarSurfaceWith maxLoopVars nodes
  pure
    ( labelShadowWarnings desugared
        <> strayHeadBarWarnings nodes
        <> booleanInOutputWarnings desugared
    )
