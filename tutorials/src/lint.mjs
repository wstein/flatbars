// SPDX-License-Identifier: Apache-2.0
//
// Runnable examples for the "Linting & migration" reference. ONE source, imported
// by both the page and the CI gate (scripts/check-tutorial-tooling.mjs), which runs
// each through the real engine bundle:
//   • lintExamples    → lint(template, dialect): finding count + report substrings,
//                       or `report` for the clean "ok: no lint findings" case.
//   • migrateExamples → migrate(template): the migrated MaxBars source must contain
//                       each `containsSource` string; `residualKind` (if set) must
//                       appear among the residuals.
// So the page can never show a finding or rewrite the tools do not produce. The
// normative text lives in docs/ (adr-0019-operation-vocabulary, adr-0021-maxbars-
// variable-model); the page only annotates these.

// `flatbars lint` findings: deprecated aliases and non-canonical scoped variables.
// Both are warn-only (never block rendering) — a host/CI hygiene check.
export const lintExamples = {
  // A deprecated alias: `plus` renders identically to `add`, but the canonical name
  // is `add`. Flagged in every dialect.
  alias: {
    engine: "maxbars",
    template: "{{ plus a b }}",
    findings: 1,
    expect: ["`plus` is a deprecated alias of `add`", "prefer `add`", "warning:"],
  },
  // A non-canonical scoped variable: the loop index is `index0` in RawBars/MaxBars
  // (the bare `index` is the legacy spelling). Flagged in RawBars/MaxBars only —
  // FullBars keeps Handlebars' `@index`, so it is canonical there.
  scopedVariable: {
    engine: "maxbars",
    template: "{{#each items}}{{index}}. {{this}}{{/each}}",
    findings: 1,
    expect: ["non-canonical scoped variable", "prefer `index0`"],
  },
  // A clean template reports the CLI's no-findings line (exit 0 under any
  // `--max-warnings`).
  clean: {
    engine: "rawbars",
    template: "{{{ name }}}",
    report: "ok: no lint findings",
  },
};

// `migrate` rewrites Handlebars source to MaxBars source, with a residual report
// for the constructs it cannot rewrite mechanically.
export const migrateExamples = {
  // `@`-data loop variables migrate to the MaxBars `loop` object (ADR-021).
  loopVars: {
    template: "{{#each items}}{{@index}}. {{this}}\n{{/each}}",
    containsSource: ["loop.index0"],
  },
  // An inverted section `{{^x}}` becomes `{{#unless x}}` (its close pairs too).
  inverted: {
    template: "{{^items}}nothing here{{/items}}",
    containsSource: ["{{#unless items}}", "{{/unless}}"],
  },
  // The block-partial reference `{{> @partial-block}}` becomes `{{yield}}` (the
  // MaxBars spelling — a direct yield, not a partial named `@partial-block`).
  partialBlock: {
    template: "{{> @partial-block}}",
    containsSource: ["{{yield}}"],
  },
  // What migration CANNOT do: a bare Mustache section `{{#name}}` whose name is not
  // a known block helper is ambiguous (`{{#if}}` vs `{{#each}}`?) — reported as a
  // residual for a human to resolve, never guessed.
  ambiguousSection: {
    template: "{{#widget}}{{title}}{{/widget}}",
    containsSource: ["{{#widget}}"],
    residualKind: "ambiguous-section",
  },
};
