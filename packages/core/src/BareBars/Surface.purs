-- | The surface dialect (sugar). See `docs/modules/ROOT/pages/surface.adoc`.
-- |
-- | Surface is a *front-end* that emits core `Template`: `{{ }}` escaped output,
-- | dotted paths, `@data` variables, hash arguments, block params, partials.
-- | Every rule is a pure syntactic rewrite to the core.
-- |
-- | NOTE: this is a scaffold. The working core (`Parser`/`Eval`/`Prelude`) is
-- | complete; the surface desugarer is the next milestone. Until it lands,
-- | author templates in core syntax (`{{{ lookup this "x" }}}`, etc.) and call
-- | `BareBars.parse` directly.
module BareBars.Surface
  ( SurfaceTemplate
  , parseSurface
  , desugar
  ) where

import BareBars.Error (ParseError)
import BareBars.Syntax (Template)
import Data.Either (Either)
import Partial.Unsafe (unsafeCrashWith)

-- | Placeholder: the real surface AST (with paths, hash args, block params)
-- | will replace this alias.
type SurfaceTemplate = Template

parseSurface :: String -> Either ParseError SurfaceTemplate
parseSurface _ = unsafeCrashWith
  "BareBars.Surface.parseSurface: not yet implemented — see docs/modules/ROOT/pages/surface.adoc"

desugar :: SurfaceTemplate -> Template
desugar _ = unsafeCrashWith
  "BareBars.Surface.desugar: not yet implemented — see docs/modules/ROOT/pages/surface.adoc"
