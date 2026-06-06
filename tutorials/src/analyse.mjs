// SPDX-License-Identifier: Apache-2.0
//
// Runnable examples for the "Truthiness portability" (analyse mode, ADR-022 Part B)
// reference. ONE source, imported by both the page (preview + "Open in Lab") and
// the CI gate (scripts/check-tutorial-tooling.mjs), which runs each through the
// real engine bundle's `analyze(template, data)` and asserts the finding count and
// the report substrings — so the page can never claim a finding the analyser does
// not produce. The normative text lives in docs/ (adr-0022-analyse-mode.adoc); the
// page only annotates these.
//
// All examples are FullBars surface (the analyser renders under the FullBars
// `handlebars` truthiness rule and replays the others). `finds` is the exact
// number of portability findings; `expect` are substrings the markdown report must
// contain (the located finding + its portable fix). The "ambiguous four" — `0`,
// `""`, `[]`, `{}` — are the values whose truthiness differs across engines.

export const examples = {
  // An empty string is falsy in Handlebars *and* mustache.js, but truthy under the
  // language-agnostic (spec/Ruby) Mustache rule and `minimal` — the classic "user
  // typed nothing, so we showed the empty branch on one engine and the filled
  // branch on another" bug. The report legend names mustache.js explicitly so a JS
  // reader isn't misled by the `mustache-spec` flip.
  emptyString: {
    engine: "fullbars",
    template: "{{#if bio}}{{bio}}{{else}}(no bio yet){{/if}}",
    data: { bio: "" },
    finds: 1,
    expect: ["1 observed", "empty string", "data path: `bio`", "(ne s", "mustache.js", "flips under `mustache-spec`"],
  },
  // Zero diverges between the two Mustache readings: falsy in Handlebars *and*
  // mustache.js, truthy under spec/Ruby Mustache, `minimal`, and `presence`.
  // `includeZero=true` keeps it truthy on Handlebars, but the portable fix is to
  // test explicitly.
  zero: {
    engine: "fullbars",
    template: "{{#if count}}{{count}} unread{{else}}all caught up{{/if}}",
    data: { count: 0 },
    finds: 1,
    expect: ["1 observed", "the number `0`", "includeZero=true", "data path: `count`", "flips under `mustache-spec`"],
  },
  // An empty array (falsy in Handlebars/Mustache, but the report still steers you
  // to the engine-agnostic spelling) — iterate with `{{#each}}…{{else}}` so the
  // empty branch fires the same way everywhere.
  emptyArray: {
    engine: "fullbars",
    template: "{{#if items}}{{#each items}}{{this}} {{/each}}{{else}}empty{{/if}}",
    data: { items: [] },
    finds: 1,
    expect: ["1 observed", "empty array", "{{#each"],
  },
  // An empty object is truthy in Handlebars, mustache.js, AND spec Mustache; it
  // flips only under the `presence` rule — the non-obvious case the report catches.
  emptyObject: {
    engine: "fullbars",
    template: "{{#if profile}}has profile{{else}}none{{/if}}",
    data: { profile: {} },
    finds: 1,
    expect: ["1 observed", "empty object", "flips under `presence`", "data path: `profile`"],
  },
  // `false` is portable — every rule agrees — so it is NOT a finding; it appears as
  // a `✓` line, positive evidence the condition is safe.
  portable: {
    engine: "fullbars",
    template: "{{#if active}}on{{else}}off{{/if}}",
    data: { active: false },
    finds: 0,
    expect: ["0 observed"],
  },
  // ADR-030 symbolic what-if: `count` is `5` here, so it is portable as OBSERVED —
  // but `5` is a number, and a number could be `0`, which DOES diverge. The analyser
  // derives that same-type ambiguous value and reports a POTENTIAL finding, so
  // coverage no longer depends on the sample happening to hold the edge value.
  potential: {
    engine: "fullbars",
    template: "{{#if count}}{{count}} unread{{else}}all caught up{{/if}}",
    data: { count: 5 },
    finds: 1,
    expect: ["0 observed", "1 potential", "would diverge if it held", "the number `0`", "data path: `count`"],
  },
};
