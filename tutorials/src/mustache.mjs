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
// Brief (design-debate consensus): every example is MINBARS-valid Mustache and
// NON-HTML — Mustache's home turf is plain text, Markdown, config and email, and
// angle brackets only bury the idea. The two honest exceptions: `escaping` needs
// markup, but it lives in the DATA (rendered as text), and lambdas can't run (a
// static spec-only note on the page).
//
// ORDER IS DISPLAY ORDER: the Lab dropdown is a flat list, so examples run
// strictly simple → advanced and each `label` carries its tier ("Simple — …",
// "Intermediate — …", "Advanced — …"). Simple examples teach one concept;
// advanced ones may combine several familiar concepts. Redundant examples were
// cut (one iteration example, one partial-shape example, no separate "no-if" or
// "lambda" example — those points live in the surviving examples' page notes).
//
// The Lab projection defaults MinBars to the "source" (Plain Text) output view
// via the generator's `defaultView`, so there's no per-example `view` field here.
// `inline: true` opts a single-line example out of the gate's "list on one line
// reads as broken" heuristic.

export const examples = {
  // ── Simple: interpolation basics ───────────────────────────────────────────
  hello: {
    label: "Simple — Hello World",
    template: "Hello, {{name}}!",
    data: { name: "Ada" },
  },

  dotted: {
    label: "Simple — Dotted names",
    // A dot splits the lookup into a path: {{a.b}} reaches into nested objects.
    template: "{{name.first}} {{name.last}}",
    data: { name: { first: "Ada", last: "Lovelace" } },
  },

  missing: {
    label: "Simple — Missing → empty",
    // A name that resolves to nothing renders the empty string — never an error.
    template: "name=[{{name}}] missing=[{{nope}}] null=[{{nada}}]",
    data: { name: "Ada", nada: null },
  },

  escaping: {
    label: "Simple — Escaping (markup in data)",
    // {{x}} HTML-escapes; {{{x}}} and {{&x}} emit raw. The markup is in the DATA,
    // not the template — the same three tags, one value. Shown as plain text so
    // the escaped entities are visible (an HTML preview would hide the point).
    template: "escaped: {{html}}\nraw:     {{{html}}}\namp:     {{&html}}",
    data: { html: "<b>bold & bright</b>" },
  },

  comment: {
    label: "Simple — Comment {{! … }}",
    template: "Total{{! the bang tag is dropped entirely }}: {{total}}",
    data: { total: 99 },
  },

  // ── Intermediate: sections ─────────────────────────────────────────────────
  sectionArray: {
    label: "Intermediate — Section over a list",
    // An ARRAY section iterates; each element is pushed as the context. For a
    // list of scalars, {{.}} is the current item itself (the implicit iterator).
    // Plain text — one Markdown bullet per row.
    template: "Tags:\n{{#tags}}\n- {{.}}\n{{/tags}}",
    data: { tags: ["math", "logic", "engines"] },
  },

  sectionObject: {
    label: "Intermediate — Section over an object",
    // An OBJECT section pushes that object as the context for its body.
    template: "{{#user}}\n{{name}} <{{email}}>\n{{/user}}",
    data: { user: { name: "Ada", email: "ada@example.com" } },
  },

  inverted: {
    label: "Intermediate — Inverted section",
    // {{^x}} renders exactly when {{#x}} would not: a falsy value or an EMPTY list.
    template: "{{#items}}- {{.}}\n{{/items}}{{^items}}(nothing yet)\n{{/items}}",
    data: { items: [] },
  },

  truthyZero: {
    label: "Intermediate — Truthiness (0 is truthy)",
    // Two lessons in one. (1) In MUSTACHE, 0 and "" are TRUTHY (only false, null,
    // [] are falsy), so {{#count}} renders on 0 — a Handlebars refugee expects it
    // to hide. (2) There is no `if`: {{#count}} is a SECTION on the key, the shape
    // decides whether the body shows — not a conditional, not a helper.
    template: "{{#count}}in stock: {{count}}{{/count}}{{^count}}sold out{{/count}}",
    data: { count: 0 },
  },

  // ── Advanced: combine familiar concepts ────────────────────────────────────
  partialList: {
    label: "Advanced — Partial per row",
    // A partial reused per row (a section + a partial). The row's newline lives
    // INSIDE the partial body: a standalone `{{> row}}` line has its own newline
    // trimmed, so the partial must own its trailing newline or rows run together.
    template: "{{#people}}\n{{> row}}\n{{/people}}",
    partials: { row: "- {{name}} ({{role}})\n" },
    data: {
      people: [
        { name: "Ada", role: "author" },
        { name: "Charles", role: "engine" },
      ],
    },
  },

  dynamicPartial: {
    label: "Advanced — Dynamic-name partial",
    // {{>* which}} resolves the partial name from the data at render time.
    template: "{{>* which}}",
    partials: { en: "Hello, {{name}}!", de: "Hallo, {{name}}!" },
    data: { which: "de", name: "Ada" },
  },

  setDelimiters: {
    label: "Advanced — Set delimiters {{=…=}}",
    // {{=<% %>=}} changes the active delimiters mid-stream; <%={{ }}=%> restores
    // them. The set-delimiter lines are standalone, so they leave no blank line.
    template: "* {{before}}\n{{=<% %>=}}\n* <% during %>\n<%={{ }}=%>\n* {{after}}",
    data: { before: "default", during: "erb-style", after: "default again" },
  },

  email: {
    label: "Advanced — Putting it together (email)",
    // An ADVANCED example reusing familiar concepts in one realistic, non-HTML
    // template: interpolation, dotted paths, a list section over OBJECTS, an
    // inverted fallback, and a closing signature — a plain-text shipping notice.
    template:
      "Hi {{name}},\n\nYour order shipped. Items:\n{{#items}}\n- {{title}} ×{{qty}}\n{{/items}}{{^items}}\n- (none)\n{{/items}}\n\n— {{store.name}} ({{store.url}})",
    data: {
      name: "Ada",
      items: [{ title: "Pen", qty: 3 }, { title: "Ink", qty: 1 }],
      store: { name: "FlatMart", url: "flatmart.example" },
    },
  },
};
