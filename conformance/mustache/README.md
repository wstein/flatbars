# MinBars vs Mustache — full-spec conformance

**MinBars passes 100% (184/184) of every Mustache spec module it implements** — all six
required modules plus the optional `dynamic-names` and `inheritance`.

Unlike Handlebars, Mustache *ships a declarative spec*: every fixture in
[`spec/`](spec/) carries its own `expected` output, so the spec itself is the oracle — the
harness ([`scripts/mustache-conformance.mjs`](../../scripts/mustache-conformance.mjs)) renders
each template through MinBars (the shipped Lab bundle, `lab/renderer.mjs`) and asserts
`actual === expected`. The full official suite is vendored (every module, see
`spec/PROVENANCE.txt`), so the score is measured against the whole spec — it cannot over-claim.

```sh
npm run gen:mustache-conformance     # measure + write report.json
npm run check:mustache-conformance   # CI gate (in `npm test`): fail if report.json is stale
node scripts/mustache-conformance.mjs --verbose   # show every mismatch
```

## Scoreboard

| Module | Result | |
| --- | --- | --- |
| Interpolation | 42/42 | required |
| Sections | 34/34 | required |
| Inverted sections | 22/22 | required |
| Comments | 12/12 | required |
| Partials | 12/12 | required |
| Set delimiters | 14/14 | required (ADR-015) |
| Dynamic names | 21/21 | optional |
| Inheritance | 27/27 | optional |
| **Conformance** | **184/184 (100%)** | every module MinBars implements |

## Lambdas — out of the value, by design

The optional `~lambdas` module is not a target. A Mustache/Handlebars.js lambda is a *function
embedded in the data*, and a FlatBars `Value` is **pure data, never a function**
(`docs/.../concepts.adoc`). That is a deliberate core choice, not a shortfall — and the two jobs a
lambda actually does map to two places, neither inside the value:

- **A lambda that produces a value** (format a date, compute a total) → **precalculate it before
  rendering** and pass plain data. Any host-side computation works; in the Lab this is the JSONata
  transform (first-class functions and closures), but the engine, CLI and compiled output only ever
  receive plain data — they don't run JSONata.
- **A section lambda that rewrites its block body** (`{{#lambda}}…{{/lambda}}` wrapping/transforming
  the unrendered body) → a **helper / block helper**, where render-time behaviour belongs.
  Preprocessing can't reach this: it runs before rendering and never sees the template body.

The engine-level guarantee is narrow but real: **no arbitrary host code runs from template data, and
the rendered `Value` stays pure and JSON-serialisable.** (The preprocessing expression is still code
— review it like any code; JSONata is a constrained data-query language, not a security sandbox.)
This is the FlatBars split the family rests on: compute before rendering, render pure data, keep
behaviour out of values.

Files: [`spec/`](spec/) — the vendored official suite; `report.json` — the generated scoreboard,
committed so the gate can detect drift.
