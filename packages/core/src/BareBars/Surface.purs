-- | The surface dialect (sugar). See `docs/modules/ROOT/pages/surface.adoc`.
-- |
-- | Desugaring is *not* a separate front-end: the one (structural) parser is
-- | `BareBars.parse`, and the surface dialect is a *walk* over the structural
-- | AST that lowers it to the engine's real AST — `{{ }}` escaped output,
-- | dotted paths → `lookup`, `@data` variables, hash arguments → `dict`, block
-- | params, partials, `else if` chains. It is naturally a `BareBars.Walk`
-- | catamorphism (`foldTemplate`).
-- |
-- | NOTE: this is a scaffold. The structural core (`Lexer`/`Parser`) and the
-- | interpreting walk (`Engine`/`Prelude`) are complete; this desugaring walk is
-- | the next milestone. Until it lands, author templates in core syntax
-- | (`{{{ lookup this "x" }}}`, `{{#if c}}…{{else}}…{{/if}}`) and render directly.
module BareBars.Surface
  ( desugar
  ) where

import BareBars.Syntax (Template)
import Partial.Unsafe (unsafeCrashWith)

-- | Desugar a structural AST into the engine's real AST (a walk over the
-- | skeleton). Placeholder until the dialect lands.
desugar :: Template -> Template
desugar _ = unsafeCrashWith
  "BareBars.Surface.desugar: not yet implemented — see docs/modules/ROOT/pages/surface.adoc"
