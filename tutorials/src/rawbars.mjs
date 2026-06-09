// SPDX-License-Identifier: Apache-2.0
//
// The RawBars reference's runnable examples — ONE source, imported by both the
// reference page (live preview + Open-in-Lab + the compiled-JS pane) and the CI
// gate (scripts/check-tutorial-links.mjs), which renders every one through the
// real engine bundle and asserts it produces output. RawBars is the desugared
// core surface: no surface sugar, so every value is an explicit helper application.
//
// `engine` defaults to "rawbars"; the `sugar` example is FullBars on purpose —
// it's the left half of the "sugar → core" diptych (what `{{name}}` desugars
// to). `compiles: true` marks the flagship the page shows compiled to JS (and
// the gate asserts compileToJs succeeds for it).

export const examples = {
  // ── Output & escaping: the sugar → core diptych ──────────────────────────
  // FullBars writes {{name}}; that is exactly this RawBars application.
  sugar: {
    engine: "fullbars",
    template: "{{name}}",
    data: { name: "Ada <core>" },
  },
  core: {
    template: '{{{escapeHtml (lookup this "name")}}}',
    data: { name: "Ada <core>" },
  },

  // ── Application is juxtaposition; parens group ────────────────────────────
  // `uppercase (lookup this "name")` applies uppercase to ONE argument — the
  // parenthesised group. Without the parens it would be three arguments.
  application: {
    template: '{{{uppercase (lookup this "name")}}}',
    data: { name: "ada" },
  },

  // ── Reading data: lookup, explicitly, with no dot paths ───────────────────
  lookup: {
    template: '{{{escapeHtml (lookup this "user" "email")}}}',
    data: { user: { email: "ada@example.com" } },
  },

  // ── Blocks install scope; `this` and `index` are nullary helpers ──────────
  // Also the compile flagship: the page shows this template emitted as JS.
  // Block tags sit on their own lines; standalone-line trimming drops those
  // lines, so the output is one clean row per item.
  each: {
    template: `{{#each (lookup this "items")}}
{{{index}}}: {{{escapeHtml this}}}
{{/each}}`,
    data: { items: ["alpha", "beta"] },
    compiles: true,
  },

  // ── No keywords: {{else}} is a separator the `if` helper splits on ────────
  cond: {
    template: `{{#if (lookup this "admin")}}
admin
{{else}}
guest
{{/if}}`,
    data: { admin: false },
  },

  // ── Multi-arm {{#case}} — a nonEmpty-family control structure ──────────────
  caseBlock: {
    template: `{{#case (lookup this "status")}}
{{when "shipped"}}On its way
{{when "pending" "queued"}}Waiting
{{else}}Unknown
{{/case}}`,
    data: { status: "queued" },
  },

  // ── Comments are dropped by the lexer ─────────────────────────────────────
  comment: {
    template: "A{{! dropped }}B",
    data: {},
  },

  // ── Block partials: define with {{#inline}}, fill with {{{yield}}} ─────────
  // RawBars hoists {{#inline "name"}} definitions into the partial registry (the
  // shared Kernel.Hoist, same engine step as FullBars/MaxBars); {{#partial "name"
  // ctx}} then invokes it with the block body, dropped in at {{{yield}}}. Bare
  // core: triple-stash and an explicit context — no surface sugar.
  yield: {
    template: '{{#inline "frame"}}<main>{{{yield}}}</main>{{/inline}}{{#partial "frame" this}}{{{lookup this "name"}}}{{/partial}}',
    data: { name: "Ada" },
  },
};
