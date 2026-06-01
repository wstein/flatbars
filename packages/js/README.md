# flatbars-js

A thin, JS/TS-friendly facade over the [FullBars](../fullbars) reference engine
(design review item **P6**).

The library is written in PureScript and renders against the core `Value` type.
This package is the public boundary for JavaScript/TypeScript hosts: **uncurried**
functions that take a template string and **plain JS data** and return a plain
`{ ok, value, error }` object — no curried calling conventions, `Either`, or
`Data.Map`-shaped values leak across it.

```js
import { render, renderSurface } from "flatbars-js"; // FullBars.JS

// Surface dialect: paths, {{ }} auto-escapes.
const r = renderSurface("<h1>{{ name }}</h1>", { name: "Ada & <b>" });
r.ok;     // true
r.value;  // "<h1>Ada &amp; &lt;b&gt;</h1>"

// Core syntax: explicit helpers, {{{ }}} is output.
render("{{{ escapeHtml (lookup this \"x\") }}}", { x: "<i>" }).value; // "&lt;i&gt;"

// Errors come back located (line:column), never thrown.
renderSurface("line1\nline2 {{ oops", {}).error; // "2:7: UnterminatedTag: …"
```

`data` is read as an Argonaut `Json` value, which *is* an ordinary JS value, so a
caller just passes an object/array/string/number/boolean/null directly. See
[`index.d.ts`](index.d.ts) for the TypeScript surface and [`FullBars.JS`](src/FullBars/JS.purs)
for the implementation.
