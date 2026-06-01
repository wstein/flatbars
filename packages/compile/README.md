# flatbars-compile

A **dialect-agnostic** template→JavaScript compiler for FlatBars — the fourth
instance of the inversion-of-control pattern (interpret / desugar / validate /
**compile**). It turns a template into a small JS ES module that runs against a
hand-written runtime over **plain JS values** (not the `Value` ADT), the way
Handlebars precompiles.

## Layout

- [`FlatBars.Compile`](src/FlatBars/Compile.purs) — the meaning-free **emit
  driver**: walks the structural `Template` and assembles a JS function source.
  `Content`/`Output`/`Sep`/`RawBlock` are universal; `Block`/`Expr` defer to a
  dialect's `Emit` rules. Reserves no names.
- [`FlatBars.Compile.FullBars`](src/FlatBars/Compile/FullBars.purs) — the
  **FullBars** `Emit` binding: native JS control flow for `if`/`unless`/`each`/
  `with` (the optimiser), hot helpers (`this`/`lookup`/`escapeHtml`/`safe`)
  inlined, everything else through `rt.call`/`rt.block` (the baseline). A Core or
  Max dialect would add its own binding to the same seam.
- [`runtime/flatbars-runtime.mjs`](runtime/flatbars-runtime.mjs) — the JS runtime
  the compiled code calls. It re-implements the FullBars value semantics —
  including the deliberate divergences (content-based `VSafe` truthiness, explicit
  escaping, sorted object iteration, `@../` parent-data).

## Conformance harness — the gate

The one real risk of a compiler is the compiled path drifting from the
interpreter. [`conformance.mjs`](conformance.mjs) renders every case with **both**
paths and asserts byte-identical output:

- *spec* = the interpreter (`FullBars.renderWith`, imported from `output/` so it
  is always current source);
- *compiled* = `FlatBars.Compile` → JS, executed against the runtime.

Cases come from the inline corpus ([`conformance/cases.mjs`](conformance/cases.mjs)
— constructs + divergence edge cases) plus every `examples/*/` golden template.

```sh
npm run test:compile      # spago build && node packages/compile/conformance.mjs
```

It is part of `npm test`. Expanding the corpus is the ongoing cost (and the point
— the broader corpus already caught object-key ordering, `@../` parent-data, and
`json` drift during bring-up).

## Scope (v0)

Sync-only, **core syntax**. Surface-dialect compilation (`desugarSurface` first),
partials/inline, and the generic `rt.block` fallback for exotic block helpers are
follow-ups; the interpreter remains their path for now.
