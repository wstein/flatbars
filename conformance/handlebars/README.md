# FullBars vs Handlebars — differential conformance

**FullBars matches Handlebars on 98% (49/50) of this corpus.**

This is a *proof*, not a claim: the harness ([`scripts/hbs-conformance.mjs`](../../scripts/hbs-conformance.mjs))
renders every case through the **real `handlebars` npm package** (a dev-only oracle) *and* through
FullBars (the shipped Lab bundle, `lab/vendor/flatbars-engine.mjs`), then asserts the output is
byte-identical. The expected value is therefore whatever upstream Handlebars actually produces — never
a value we wrote down — so the number cannot be inflated.

```sh
npm run gen:hbs-conformance     # measure + write report.json
npm run check:hbs-conformance   # CI gate (in `npm test`): fail if report.json is stale
node scripts/hbs-conformance.mjs --verbose   # show every mismatch
```

## Files

- `corpus.json` — categorised cases (expressions, paths, `if`/`each`/`with`, helpers,
  subexpressions, block params, partials, comments, whitespace, Mustache-style sections).
- `report.json` — the generated scoreboard (per-category + overall), committed so the gate can detect
  drift.

## The 98%

FullBars implements the whole familiar Handlebars surface, plus — since this work — Handlebars-style
**implicit sections** via `blockHelperMissing` (`{{#x}}` over data: array ⇒ `each`, truthy ⇒ `with`,
falsy/empty ⇒ `{{else}}`), **inter-tag whitespace** matching Handlebars exactly, and **user-defined block
helpers** (`registerHelper` + `options.fn`/`inverse` — ADR-020), which flipped the former `{{#bold}}` miss
to a pass. See [`docs/.../fullbars-compat.adoc`](../../docs/modules/ROOT/pages/fullbars-compat.adoc).

## The 2% — one corpus divergence

**Raw block without a `raw` helper** (`{{{{raw}}}}…{{{{/raw}}}}`) — FullBars emits the body verbatim
(the expected raw-block behaviour); Handlebars treats it as a missing block helper and renders empty. A
legitimate divergence where FullBars is arguably more correct, not a deficiency.

Separately, **functions/lambdas in the data context** are the irreducible boundary: they would require a
function variant on the pure-data `Value`, the one change that would stop FlatBars being FlatBars (compat
§2). It is not a corpus case because `Value` cannot hold a function — value-lambdas are precomputed, and
body-aware sections are now block helpers (above).
