-- | A thin, JS/TS-friendly facade over the FlatBars engine (review P6).
-- |
-- | The library is written in PureScript and renders against the core `Value`
-- | type, but a JavaScript or TypeScript host should not have to know that —
-- | curried calling conventions, `Either`, and `Data.Map`-based values are all
-- | internal. This module is the public boundary: *uncurried* functions that
-- | take a template string and *plain JS data* (any JSON-shaped value) and
-- | return a plain `{ ok, value, error }` object.
-- |
-- | ```js
-- | import { render, renderSurface } from "barebars-js";
-- | const r = renderSurface("<h1>{{ name }}</h1>", { name: "Ada" });
-- | if (r.ok) document.body.innerHTML = r.value; else console.error(r.error);
-- | ```
-- |
-- | `data` is taken as an Argonaut `Json`, which *is* an ordinary JS value, so a
-- | JS caller just passes an object/array/string/number/boolean/null directly;
-- | it is converted to `Value` via `BareBars.Json.fromJson`.
module FlatBars.JS
  ( Result
  , render
  , renderSurface
  ) where

import BareBars.Json (fromJson)
import Data.Argonaut.Core (Json)
import Data.Either (Either, either)
import Data.Function.Uncurried (Fn2, mkFn2)
import FlatBars as FlatBars

-- | A render outcome as a plain JS object: `ok` says which of `value`/`error`
-- | is meaningful (the other is `""`).
type Result = { ok :: Boolean, value :: String, error :: String }

result :: Either String String -> Result
result = either (\e -> { ok: false, value: "", error: e }) (\v -> { ok: true, value: v, error: "" })

-- | Render a *core-syntax* template against JS data. `render(template, data)`.
-- | Parse failures are reported as `line:column: message`.
render :: Fn2 String Json Result
render = mkFn2 \tpl json -> result (FlatBars.renderWithDiag tpl (fromJson json))

-- | Render a *surface-dialect* template (paths, `{{ }}` auto-escape, …) against
-- | JS data. `renderSurface(template, data)`. Parse failures are reported as
-- | `line:column: message`.
renderSurface :: Fn2 String Json Result
renderSurface = mkFn2 \tpl json -> result (FlatBars.renderSurfaceDiag tpl (fromJson json))
