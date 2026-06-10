// SPDX-License-Identifier: Apache-2.0
//
// Runnable examples for the "Linting & migration" reference. ONE source, imported
// by both the page and the CI gate (scripts/check-tutorial-tooling.mjs), which runs
// each through the real engine bundle and asserts the EXACT output the page shows:
//   • lintExamples    → lint(template, dialect).report === report
//   • migrateExamples → migrate(template).source === source  (+ residualKind, if set)
// So the before/after shown on the page is byte-for-byte what the tools produce —
// never hand-written. The normative text lives in docs/ (adr-0019-operation-
// vocabulary, adr-0021-maxbars-variable-model).

// `flatbars lint` findings: deprecated aliases and non-canonical scoped variables.
// Both are warn-only (never block rendering) — a host/CI hygiene check. `report` is
// the exact CLI output (the `warning: …` line, or the clean no-findings line).
//
// `data` (optional) feeds the page's interactive example card (../components/
// OpenInLab.jsx): the template renders LIVE through the engine bundle next to the
// lint warning, so the page shows BOTH that the template renders AND what the
// linter says about it. The `clean` example has no `data` — it is a pure CLI/exit-
// code demo (terminal block on the page), not a render.
export const lintExamples = {
  // A deprecated alias: `plus` renders identically to `add`, but `add` is canonical.
  // Flagged in every dialect. Renders fine (2 + 3 = 5) — the warning is hygiene only.
  alias: {
    engine: "maxbars",
    template: "{{ plus a b }}",
    data: { a: 2, b: 3 },
    report: "warning: `plus` is a deprecated alias of `add` — prefer `add` (the lift/migrate assist rewrites it)",
  },
  // A non-canonical scoped variable: the loop index is `index0` in RawBars/MaxBars
  // (bare `index` is the legacy spelling). Flagged in RawBars/MaxBars only — ClassicBars
  // keeps Handlebars' `@index`, so it is canonical there. (Bare `index` does not
  // resolve to the position in the card — exactly why the linter steers you off it.)
  scopedVariable: {
    engine: "maxbars",
    template: "{% for items %}{{index}}. {{this}}{% endfor %}",
    data: { items: ["alpha", "beta", "gamma"] },
    report: "warning: `index` is the non-canonical scoped variable — prefer `index0` (the native RawBars/MaxBars spelling)",
  },
  // A clean template reports the CLI's no-findings line (exit 0 under any
  // `--max-warnings`). No `data`: this is the terminal/exit-code demo, not a render.
  clean: {
    engine: "rawbars",
    template: "{{{ name }}}",
    report: "ok: no lint findings",
  },
};

// `migrate` rewrites Handlebars source to MaxBars source (minimal-diff: untouched
// tags keep their exact spacing). `source` is the exact migrated output; an
// unrewritable construct carries a `residualKind` instead of a clean rewrite.
//
// `data` (and, for the yield example, `cardTemplate` — a self-contained scenario
// the bare `{{yield}}` fragment can't show standalone) feed the page's interactive
// card: it renders the MIGRATED MaxBars result LIVE, proving the rewrite produced a
// working template. The card runs `cardTemplate ?? source` under MaxBars. The
// `ambiguousSection` residual has no `data` — it is the can't-migrate case (left
// verbatim), shown as source-only, not rendered.
export const migrateExamples = {
  // `@`-data loop variables migrate to the MaxBars `loop` object (ADR-021).
  loopVars: {
    template: "{{#each items}}{{@index}}. {{this}}\n{{/each}}",
    source: "{% for items %}{{loop.index0}}. {{this}}\n{% endfor %}",
    data: { items: ["alpha", "beta", "gamma"] },
  },
  // An inverted section `{{^x}}` becomes `{{#unless x}}` (its close pairs too).
  inverted: {
    template: "{{^items}}nothing here{{/items}}",
    source: "{% unless items %}nothing here{% endunless %}",
    data: { items: [] },
  },
  // The block-partial reference `{{> @partial-block}}` becomes `{{yield}}` (a direct
  // yield, not a partial named `@partial-block`). The bare fragment can't render on
  // its own, so the card runs `{{yield}}` in a minimal inline-partial host.
  partialBlock: {
    template: "{{> @partial-block}}",
    source: "{{yield}}",
    cardTemplate: '{{#inline "card"}}<section>{{yield}}</section>{{/inline}}{{#partial "card"}}Hello, {{name}}!{{/partial}}',
    data: { name: "Ada" },
  },
  // What migration CANNOT do: a bare Mustache section `{{#name}}` whose name is not a
  // known block helper is ambiguous (`{{#if}}` guard vs `{{#each}}` iteration?) — left
  // verbatim and reported as a residual for a human to resolve, never guessed.
  ambiguousSection: {
    template: "{{#widget}}{{title}}{{/widget}}",
    source: "{% widget %}{{title}}{% endwidget %}",
    residualKind: "ambiguous-section",
  },
};

// The Open-in-Lab target for each kind of example — the single source the page's
// "Open in Lab" link and the CI gate (check-tutorial-tooling) both build the
// deep-link from, so the link can never target a view the example does not belong
// in. A lint example opens the Lab's **Lint dock panel** under its own dialect; a
// migrate example opens the **Migrated MaxBars output view**, loading the
// Handlebars source as the ClassicBars (Handlebars-faithful) engine. The shape is
// `{ engine, example }` — exactly the `labHref(engine, example)` arguments.
export function lintLabInput(ex) {
  return { engine: ex.engine, example: { template: ex.template, dock: "lint" } };
}
export function migrateLabInput(ex) {
  return { engine: "classicbars", example: { template: ex.template, view: "migrated" } };
}
