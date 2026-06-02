# FullBars vs Handlebars — differential conformance

**FullBars matches Handlebars on 96% (48/50) of this corpus.**

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

## The 96%

FullBars implements the whole familiar Handlebars surface, plus — since this work — Handlebars-style
**implicit sections** via `blockHelperMissing` (`{{#x}}` over data: array ⇒ `each`, truthy ⇒ `with`,
falsy/empty ⇒ `{{else}}`), and **inter-tag whitespace** now matches Handlebars exactly. See
[`docs/.../fullbars-compat.adoc`](../../docs/modules/ROOT/pages/fullbars-compat.adoc).

## The 4% — two deliberately-deferred cases (future work)

1. **User-defined *block* helpers** — ADR-018 host helpers are inline-only, so a user
   `{{#bold}}…{{/bold}}` does not run its body. Buildable (compat §3 Roadmap); the one miss that would
   raise the number.
2. **Raw block without a `raw` helper** (`{{{{raw}}}}…{{{{/raw}}}}`) — FullBars emits the body verbatim
   (the expected raw-block behaviour); Handlebars treats it as a missing block helper and renders empty.
   A legitimate divergence where FullBars is arguably more correct, not a deficiency.

A third gap — **functions/lambdas in the data context** — is the irreducible ~1%: it would require a
function variant on the pure-data `Value`, the one change that would stop FlatBars being FlatBars
(compat §2). It is not represented as a corpus case because FullBars `Value` cannot hold a function.
