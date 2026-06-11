-- | **MaxBars** — the top tier of the dialect ladder (RawBars ⊂ ClassicBars ⊂
-- | MaxBars). It is ClassicBars plus a richer *surface*: infix operators and pipes
-- | (`MaxBars.Expr`). MaxBars owns its front-end — `MaxBars.Lexer` + `MaxBars.Parser`
-- | (ADR-041) — but its surface desugars to the same core `Expr` ClassicBars already
-- | understands, so it reuses ClassicBars's *semantic* stack wholesale by dependency:
-- | the engine, prelude, value policy, surface desugar, and the compiler. The render/
-- | compile/inspect entry points pass `maxSurfaceParse` (the owned parser) into the
-- | shared surface orchestration. (A shared semantic *kernel* is extracted lazily,
-- | only for proven overlaps; see the project notes.)
module MaxBars
  ( maxLoopVars
  , renderMax
  , renderMaxWithPartials
  , renderMaxMapped
  , renderMaxMappedWith
  , inspectMax
  , inspectMaxWith
  , renderWithOperations
  , compileMaxJs
  , compileMaxJsWith
  , maxbarsWarnings
  , inferMax
  , inferMaxData
  ) where

import Prelude

import ClassicBars (LoopVars, SurfaceParse, desugarSurfaceWith, inspectSurfaceDiagWith, nonEmpty, renameSurfaceHeads, renderSurfaceDiagWith, renderSurfaceMappedDiagWith, renderSurfaceWithHelpersWith, resolveInheritance)
import ClassicBars.Compile (compileSurfaceWith, compileSurfaceWithPartials)
import ClassicBars.Surface (noLoopVars, reservedScope)
import Data.Array.NonEmpty as NEA
import Data.Bifunctor (lmap)
import Data.Either (Either)
import Data.Tuple (Tuple)
import FlatBars.Error (Error, ParseError)
import FlatBars.Value (Value)
import Kernel.Engine (Operation)
import Kernel.Env (RefEnv)
import Kernel.Inspect (Snapshot, Target)
import Kernel.Provenance (Segment)
import Kernel.Schema (InferResult, inferTemplate, inferTemplateData)
import Kernel.Walk (Issue)
import MaxBars.Lint (booleanInOutputWarnings, labelShadowWarnings)
import MaxBars.Parser as Parser

-- | MaxBars' surface variable resolver (ADR-021). There are *no bare loop
-- | variables*: a bare `{{first}}`/`{{index0}}` is an ordinary data field. Loop
-- | state is read through the `loop` object (`{{loop.first}}`, `{{loop.index0}}`),
-- | the enclosing context through `parent`/`parent.parent`, and the root through
-- | `root` — all turned on by wrapping `noLoopVars` with `reservedScope`, which
-- | makes the desugar treat `loop`/`root`/`parent` as scope-declared reserved
-- | names. (Superseded ADR-006's bare-variable vocabulary and its shadow footgun.)
maxLoopVars :: LoopVars
maxLoopVars = reservedScope noLoopVars

-- | MaxBars' front-end for the shared surface orchestration (ADR-041 Phase 3): the
-- | owned `MaxBars.Parser.parse` plus the two baked structural flags (statement tags
-- | on, Handlebars partial-blocks off). The render/compile/inspect entry points pass
-- | this so MaxBars no longer routes through the shared `FlatBars.Parser` at all.
maxSurfaceParse :: SurfaceParse
maxSurfaceParse = { parse: Parser.parse, statementTags: true, partialBlocks: false }

-- | Render MaxBars surface source against data, reusing ClassicBars' surface
-- | pipeline (desugar → hoist → engine) with located errors and MaxBars' bare
-- | loop variables.
renderMax :: String -> Value -> Either String String
renderMax = renderSurfaceDiagWith false maxLoopVars maxSurfaceParse nonEmpty

-- | Infer a candidate Rust context type from a MaxBars template (Trussbars
-- | docs/03, L1 template-symbolic). Parses + desugars to the core AST, then runs
-- | `Kernel.Schema.inferTemplate`: a static walk that collects each path's
-- | usage-implied type, unifies, and emits a Rust schema + a JSON data scaffold +
-- | a report. Data-observed refinement and enums (§5) are follow-on increments.
inferMax :: String -> Either String InferResult
inferMax src = do
  parsed <- lmap (show <<< NEA.head) (Parser.parse src)
  -- ADR-040: infer over the flattened template, so block bodies' fields are seen.
  inherited <- lmap show (resolveInheritance parsed.nodes)
  pure (inferTemplate (desugarSurfaceWith maxLoopVars (renameSurfaceHeads inherited)))

-- | `inferMax` refined by sample data (docs/03 §2): under-determined scalars
-- | (a bare `{{x}}` defaulted to `String`) are pinned to the type the samples
-- | observe. Many samples are unioned.
inferMaxData :: Array Value -> String -> Either String InferResult
inferMaxData samples src = do
  parsed <- lmap (show <<< NEA.head) (Parser.parse src)
  inherited <- lmap show (resolveInheritance parsed.nodes)
  pure
    (inferTemplateData samples (desugarSurfaceWith maxLoopVars (renameSurfaceHeads inherited)))

-- | Render MaxBars source with a set of named *external* (host-threaded) partials,
-- | each given as MaxBars surface source — the MaxBars twin of
-- | `ClassicBars.renderSurfaceWith`. `{{> name}}` renders a registered partial;
-- | template-local `{{#inline}}` definitions are hoisted into the same registry
-- | (and win on a clash). It is `renderWithOperations` with no host operations.
renderMaxWithPartials :: Array (Tuple String String) -> String -> Value -> Either String String
renderMaxWithPartials = renderWithOperations []

-- | Render MaxBars source and return a source map alongside the output (ADR-035) —
-- | the MaxBars twin of `renderSurfaceMapped`, reusing the surface mapped render
-- | with MaxBars' loop variables, parse options, and `nonEmpty` truthiness.
renderMaxMapped :: String -> Value -> Either String { output :: String, segments :: Array Segment }
renderMaxMapped = renderMaxMappedWith []

-- | `renderMaxMapped` with named external partials (each MaxBars source).
renderMaxMappedWith
  :: Array (Tuple String String)
  -> String
  -> Value
  -> Either String { output :: String, segments :: Array Segment }
renderMaxMappedWith = renderSurfaceMappedDiagWith false maxLoopVars maxSurfaceParse nonEmpty

-- | Context Inspector for MaxBars (ADR-035) — the MaxBars twin of
-- | `inspectSurfaceWith`, snapshotting the render context at a source span.
inspectMax :: Target -> String -> Value -> Either String (Array Snapshot)
inspectMax target = inspectMaxWith target []

-- | `inspectMax` with named external partials (each MaxBars source).
inspectMaxWith
  :: Target
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String (Array Snapshot)
inspectMaxWith = inspectSurfaceDiagWith false maxLoopVars maxSurfaceParse nonEmpty

-- | Render MaxBars source with host-registered *operations* (ADR-019 addendum) —
-- | the same `renderSurfaceWithHelpersWith` path ClassicBars uses, over MaxBars' own
-- | surface (`maxLoopVars` / `maxSurfaceParse`). A block operation gets the full surface:
-- | `options.hash`, `options.fn(ctx, { data, blockParams })`, and `options.inverse`.
-- | Block params (`as |a b|`) parse because the MaxBars head grammar omits the pipe
-- | rung (a bar in head position is the block-param delimiter); pipe a block
-- | argument by parenthesising it (`{{#each (xs | f) as |x|}}`).
-- | "operation" is the native boundary word; ClassicBars' twin is `renderWith` (helper).
renderWithOperations
  :: Array (Tuple String (Operation (Either Error) (RefEnv (Either Error))))
  -> Array (Tuple String String)
  -> String
  -> Value
  -> Either String String
renderWithOperations = renderSurfaceWithHelpersWith false maxLoopVars maxSurfaceParse nonEmpty

-- | Compile MaxBars surface source to a JS ES module, reusing the ClassicBars
-- | compiler (`FlatBars.Compile`) — infix/pipe and loop vars desugar to the same
-- | core helpers the emit rules already handle.
compileMaxJs :: String -> Either ParseError String
compileMaxJs = compileSurfaceWith false maxLoopVars maxSurfaceParse "rt.truthyNonEmpty"

-- | `compileMaxJs` with a set of named *external* partials (each MaxBars surface
-- | source), folded into the compiled module's partial registry alongside the
-- | template's hoisted `{{#inline}}` definitions — the compiled twin of
-- | `renderMaxWithPartials`, so the interpreter and the compiled output agree on
-- | `{{> name}}` (gated by `test:compile`).
compileMaxJsWith :: Array (Tuple String String) -> String -> Either ParseError String
compileMaxJsWith partials =
  compileSurfaceWithPartials false maxLoopVars maxSurfaceParse "rt.truthyNonEmpty" partials

-- | The MaxBars source warnings (schema-less *warn-always* tier). Parses `src`,
-- | desugars, then runs the dialect lints (see `MaxBars.Lint`); a parse error
-- | short-circuits. Two warnings:
-- |
-- |  * *label shadow* (ADR-021): a loop `label NAME` whose name is a reserved root
-- |    (`this`/`loop`/`root`/`parent`).
-- |  * *boolean in output* (ADR-021): a bare `||`/`&&` in output position, which
-- |    yields `true`/`false` rather than a value — the fix is `??`/`?:`.
maxbarsWarnings :: String -> Either ParseError (Array Issue)
maxbarsWarnings src = do
  { nodes } <- lmap NEA.head (Parser.parse src)
  -- both lints read the *desugared* tree (a label survives as the `@label` marker;
  -- the boolean operators surface as `or`/`and` applications). The stray-head-bar
  -- lint is gone — a head bar is now a parse error (block params drop the pipes),
  -- so a parsed tree can no longer carry one.
  let desugared = desugarSurfaceWith maxLoopVars (renameSurfaceHeads nodes)
  pure (labelShadowWarnings desugared <> booleanInOutputWarnings desugared)
