// SPDX-License-Identifier: Apache-2.0
//
// The Mustache reference's runnable examples — ONE source, consumed by THREE
// places, so they can never drift:
//   1. the /minbars reference page (live preview + "Open in Lab"),
//   2. the CI gate scripts/check-tutorial-links.mjs (renders each through the real
//      MinBars bundle and asserts it produces output), and
//   3. the FlatBars Lab's MinBars example dropdown — generated into
//      lab/examples/minbars/ by scripts/gen-examples.mjs, snapshot-gated by
//      check:examples (which asserts each renders to the SAME committed output).
//
// Brief (design-debate consensus): every example is MINBARS-valid Mustache, ONE
// concept each, and NON-HTML by default — Mustache's home turf is plain text,
// Markdown, config and email, and angle brackets only bury the idea. The two
// honest exceptions: `escaping` needs markup, but it lives in the DATA (rendered
// as text), and lambdas can't run (a static spec-only note on the page).
//
// Per-example metadata drives the Lab dropdown: `label` (its name), `group` (the
// concept heading), and an optional `view` (the output pane: "rendered" default,
// "text" for plain-text output). `inline: true` opts a single-line example out of
// the gate's "list on one line reads as broken" heuristic.

export const examples = {
  // ── Interpolation ──────────────────────────────────────────────────────
  hello: {
    group: "Interpolation",
    label: "Interpolation",
    view: "text",
    template: "Hello, {{name}}!",
    data: { name: "Ada" },
  },

  dotted: {
    group: "Interpolation",
    label: "Dotted names",
    view: "text",
    // A dot splits the lookup into a path: {{a.b}} reaches into nested objects.
    template: "{{name.first}} {{name.last}}",
    data: { name: { first: "Ada", last: "Lovelace" } },
  },

  missing: {
    group: "Interpolation",
    label: "Missing → empty",
    view: "text",
    // A name that resolves to nothing renders the empty string — never an error.
    template: "name=[{{name}}] missing=[{{nope}}] null=[{{nada}}]",
    data: { name: "Ada", nada: null },
  },

  escaping: {
    group: "Interpolation",
    label: "Escaping (markup in data)",
    // The ONE markup example: {{x}} HTML-escapes; {{{x}}} and {{&x}} emit raw.
    // The markup is in the DATA, not the template — the same three tags, one value.
    template: "escaped: {{html}}\nraw:     {{{html}}}\namp:     {{&html}}",
    data: { html: "<b>bold & bright</b>" },
  },

  // ── Sections ───────────────────────────────────────────────────────────
  sectionArray: {
    group: "Sections",
    label: "Section over a list",
    view: "text",
    // An ARRAY section iterates; each element is pushed as the context. Plain
    // text — a Markdown bullet per row (no HTML to bury the iteration).
    template: "Cart:\n{{#items}}\n- {{name}} ×{{qty}}\n{{/items}}",
    data: { items: [{ name: "pen", qty: 3 }, { name: "ink", qty: 1 }] },
  },

  sectionObject: {
    group: "Sections",
    label: "Section over an object",
    view: "text",
    // An OBJECT section pushes that object as the context for its body.
    template: "{{#user}}\n{{name}} <{{email}}>\n{{/user}}",
    data: { user: { name: "Ada", email: "ada@example.com" } },
  },

  sectionBool: {
    group: "Sections",
    label: "Section over a boolean",
    view: "text",
    // A boolean (or any truthy scalar) renders the body once; falsy omits it.
    template: "{{#active}}\n● online\n{{/active}}",
    data: { active: true },
  },

  sectionNotConditional: {
    group: "Sections",
    label: "No “if” — shape decides",
    view: "text",
    // THE Mustache lesson the old Handlebars examples got wrong: Mustache has no
    // `if`. `{{#admin}}` is a SECTION on the key `admin` — it shows when `admin`
    // is truthy/present and hides otherwise; there is no `else if`, no helper.
    // Here `admin` is present (object → shows) and `banned` is absent (→ hidden).
    template: "{{#admin}}admin: {{name}}\n{{/admin}}{{#banned}}BANNED\n{{/banned}}done",
    data: { admin: { name: "Ada" } },
  },

  truthyZero: {
    group: "Sections",
    label: "Truthiness gotcha (0 is truthy)",
    view: "text",
    // In MUSTACHE, 0 and "" are TRUTHY (only false, null, [] are falsy). A
    // Handlebars refugee expects {{#count}} to hide on 0 — here it renders.
    template: "{{#count}}in stock: {{count}}{{/count}}{{^count}}sold out{{/count}}",
    data: { count: 0 },
  },

  // ── Inverted sections ─────────────────────────────────────────────────────
  inverted: {
    group: "Sections",
    label: "Inverted section (empty/falsy)",
    view: "text",
    // {{^x}} renders exactly when {{#x}} would not: a falsy value or an EMPTY list.
    template: "{{#items}}- {{.}}\n{{/items}}{{^items}}(nothing yet)\n{{/items}}",
    data: { items: [] },
  },

  implicit: {
    group: "Sections",
    label: "Implicit iterator {{.}}",
    view: "text",
    inline: true,
    // {{.}} is the current item — useful when iterating a list of scalars.
    template: "{{#tags}}[{{.}}] {{/tags}}",
    data: { tags: ["math", "logic", "engines"] },
  },

  // ── Comments ──────────────────────────────────────────────────────────────
  comment: {
    group: "Comments",
    label: "Comment {{! … }}",
    view: "text",
    template: "Total{{! the bang tag is dropped entirely }}: {{total}}",
    data: { total: 99 },
  },

  // ── Partials ───────────────────────────────────────────────────────────────
  partial: {
    group: "Partials",
    label: "Partial {{> name}}",
    view: "text",
    // {{> name}} includes another template; it inherits the caller's context.
    template: "{{> card}}",
    partials: { card: "{{name}} — {{role}}\nsince {{joined}}" },
    data: { name: "Ada", role: "author", joined: 1842 },
  },

  partialList: {
    group: "Partials",
    label: "Partial per row",
    view: "text",
    // A partial reused per row. The row's newline lives INSIDE the partial body:
    // a standalone `{{> row}}` line has its own newline trimmed, so the partial
    // must own its trailing newline or the rows run together.
    template: "{{#people}}\n{{> row}}\n{{/people}}",
    partials: { row: "- {{name}} ({{role}})\n" },
    data: {
      people: [
        { name: "Ada", role: "author" },
        { name: "Charles", role: "engine" },
      ],
    },
  },

  inheritance: {
    group: "Partials",
    label: "Template inheritance",
    view: "text",
    // {{<layout}} renders a parent template; {{$title}} blocks override the
    // parent's same-named blocks (the parent supplies a default).
    template: "{{<layout}}{{$title}}Welcome{{/title}}{{$body}}Glad you came.{{/body}}{{/layout}}",
    partials: {
      layout: "== {{$title}}Untitled{{/title}} ==\n{{$body}}(empty){{/body}}",
    },
    data: {},
  },

  dynamicPartial: {
    group: "Partials",
    label: "Dynamic-name partial",
    view: "text",
    // {{>* which}} resolves the partial name from the data at render time.
    template: "{{>* which}}",
    partials: { en: "Hello, {{name}}!", de: "Hallo, {{name}}!" },
    data: { which: "de", name: "Ada" },
  },

  // ── Set delimiters ───────────────────────────────────────────────────────
  setDelimiters: {
    group: "Set delimiters",
    label: "Set delimiters {{=…=}}",
    view: "text",
    // {{=<% %>=}} changes the active delimiters mid-stream; <%={{ }}=%> restores
    // them. The set-delimiter lines are standalone, so they leave no blank line.
    template: "* {{before}}\n{{=<% %>=}}\n* <% during %>\n<%={{ }}=%>\n* {{after}}",
    data: { before: "default", during: "erb-style", after: "default again" },
  },

  // ── Lambdas → precalculated values (the "after" render) ───────────────────
  precompute: {
    group: "Lambdas",
    label: "Lambda → precomputed value",
    view: "text",
    // A value-producing lambda (fullName, initials) replaced by precalculated
    // PLAIN DATA: no function in the context, just fields. The renderer only ever
    // sees data, so the same {{fullName}} works in every engine.
    template: "{{fullName}} ({{initials}})",
    data: { first: "Ada", last: "Lovelace", fullName: "Ada Lovelace", initials: "AL" },
  },
};
