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
  // ADR-030 PathSchema suppression (the interactive demo). The base (no schema) has
  // a potential (count could be 0) AND a miss (user.naem absent from a present
  // user); declaring both paths safe suppresses both. `pathSchema`/`expectSuppressed`
  // drive the gate's analyzeWith assertion (the headline interaction, CI-locked).
  suppress: {
    engine: "fullbars",
    template: "{{#if count}}{{count}} unread{{/if}} {{user.naem}}",
    data: { count: 5, user: { name: "Ada" } },
    finds: 2,
    expect: ["0 observed", "1 potential", "Possible data-access misses", "user.naem", "the number `0`"],
    pathSchema: ["count", "user.naem"],
    expectSuppressed: 2,
  },
  // The Mustache-portability story (the same ADR-022 machinery, narrowed). MinBars
  // renders on the language-agnostic `mustache-spec` rule (`0`/`""`/`{}` truthy), so
  // a section over `count: 0` shows the filled branch — but `mustache.js` (the
  // `handlebars` rule, `0`/`""` falsy) skips it. The analyser reports it against the
  // `mustache-spec` engine baseline, flipping under `handlebars` (= mustache.js),
  // and — because Mustache is logic-less — its fix is to reshape the data, not an
  // inline `(ne …)` test. This is the one example whose engine is `minbars`.
  mustache: {
    engine: "minbars",
    template: "{{#count}}{{count}} unread{{/count}}",
    data: { count: 0 },
    finds: 1,
    expect: [
      "Engine rule: `mustache-spec`",
      "1 observed",
      "the number `0`",
      "flips under `handlebars`",
      "mustache.js",
      "reshape the data",
      "data path: `count`",
    ],
  },
};

// "Portability at scale" gallery — realistic, multi-condition templates rather than
// the single-value teaching toys above, so the analyser is shown across the spread
// of finding kinds on templates that look like production. Each card runs through
// the real `analyze` (client-side, and CI-gated by check-tutorial-tooling, which
// asserts the per-kind counts below). FullBars templates: analyse is FullBars, and
// the Mustache conformance corpus doesn't exercise truthiness — so this is curated.
export const gallery = [
  {
    name: "Inbox badge",
    desc: "A zero count silently flips “0 unread” to “Inbox zero” on a spec-Mustache host.",
    engine: "fullbars",
    template: "{{#if unread}}{{unread}} unread{{else}}Inbox zero{{/if}}",
    data: { unread: 0 },
    expect: { observed: 1, potential: 0, miss: 0 },
  },
  {
    name: "Profile card",
    desc: "An empty bio is an observed divergence; a non-empty post count is a potential one.",
    engine: "fullbars",
    template: "{{name}}{{#if bio}} — {{bio}}{{/if}}{{#if posts}} · {{posts}} posts{{/if}}",
    data: { name: "Ada", bio: "", posts: 3 },
    expect: { observed: 1, potential: 1, miss: 0 },
  },
  {
    name: "Shopping cart",
    desc: "A non-empty cart is portable now, but the empty-cart branch rides on list falsiness.",
    engine: "fullbars",
    template: "{{#if items}}{{#each items}}{{this}} {{/each}}{{else}}Empty{{/if}}",
    data: { items: ["Book"] },
    expect: { observed: 0, potential: 1, miss: 0 },
  },
  {
    name: "Contact line",
    desc: "A misspelled field resolves to absent from a present object — the typo catcher.",
    engine: "fullbars",
    template: "{{user.name}} <{{user.emial}}>",
    data: { user: { name: "Ada", email: "a@x.io" } },
    expect: { observed: 0, potential: 0, miss: 1 },
  },
];
