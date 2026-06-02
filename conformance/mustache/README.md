# MinBars vs Mustache — full-spec conformance

**MinBars passes 100% (136/136) of the *required* Mustache spec, and 95.4% (185/194) of the
full spec including the optional `~` modules.**

Unlike Handlebars, Mustache *ships a declarative spec*: every fixture in
[`spec/`](spec/) carries its own `expected` output, so the spec itself is the oracle — the
harness ([`scripts/mustache-conformance.mjs`](../../scripts/mustache-conformance.mjs)) renders
each template through MinBars (the shipped Lab bundle, `lab/minbars.mjs`) and asserts
`actual === expected`. This measures MinBars against the **whole** official suite — optional
modules included — so it cannot over-claim. (Contrast `packages/minbars/test/spec/`, the curated
subset of modules MinBars targets, which is 100% by construction.)

```sh
npm run gen:mustache-conformance     # measure + write report.json
npm run check:mustache-conformance   # CI gate (in `npm test`): fail if report.json is stale
node scripts/mustache-conformance.mjs --verbose   # show every mismatch
```

## Scoreboard

| Module | Result | |
|---|---|---|
| Interpolation | 42/42 | required |
| Sections | 34/34 | required |
| Inverted sections | 22/22 | required |
| Comments | 12/12 | required |
| Partials | 12/12 | required |
| Set delimiters | 14/14 | required (ADR-015) |
| Dynamic names | 21/21 | optional |
| Inheritance | 27/27 | optional |
| **Lambdas** | **1/10** | optional |
| **Required** | **136/136 (100%)** | |
| **Full spec** | **185/194 (95.4%)** | |

## The only gap: Lambdas

All 9 misses are the `~lambdas` module. A Mustache lambda is a *function* supplied in the data
(`{{lambda}}` where `lambda` is code). FlatBars `Value` is pure data with **no function variant**
(`docs/.../concepts.adoc`), so MinBars cannot execute a lambda — it either throws (interpolation)
or renders the section body untransformed (sections). This is the *same irreducible limit* as
Handlebars' functions-in-context (see `conformance/handlebars/`): adding a function to `Value` is
the one change that would stop FlatBars being FlatBars. It is the FlatBars thesis, not a MinBars bug.

Files: [`spec/`](spec/) — the vendored official suite (see `spec/PROVENANCE.txt` for the pinned
commit); `report.json` — the generated scoreboard, committed so the gate can detect drift.
