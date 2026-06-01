// SPDX-License-Identifier: Apache-2.0
//
// The Mustache reference's runnable examples — ONE source, imported by both the
// reference page (live preview + "Open in Lab") and the CI gate
// (scripts/check-tutorial-links.mjs), which renders every one through the real
// MinBars bundle and asserts it produces output. Consensus from the design
// debate: the runnable example is the source of truth; the page's prose only
// annotates it, and the normative description stays in docs/ (we never fork it).
//
// Every entry runs under MinBars (Mustache semantics). Features the Mustache
// spec defines but MinBars does NOT implement (set-delimiters, lambdas) are NOT
// here — they appear on the page as static `spec-only` callouts with no live
// button, because a preview that can't run would lie (debate consensus item 4).

export const examples = {
  // ── Interpolation ──────────────────────────────────────────────────────
  hello: {
    template: "Hello, {{name}}!",
    data: { name: "Ada" },
  },

  escaping: {
    // {{x}} HTML-escapes; {{{x}}} and {{&x}} emit raw. Same value, three tags.
    template: "escaped: {{html}}\nraw:     {{{html}}}\namp:     {{&html}}",
    data: { html: "<b>bold & bright</b>" },
  },

  dotted: {
    template: "{{name.first}} {{name.last}} — {{name.first}}'s id is {{id}}",
    data: { id: 42, name: { first: "Ada", last: "Lovelace" } },
  },

  implicit: {
    // {{.}} is the current item — useful when iterating a list of scalars.
    // Intentionally inline (bracketed, single line), so opt out of the
    // single-line-collapse heuristic in the gate.
    inline: true,
    template: "{{#tags}}[{{.}}] {{/tags}}",
    data: { tags: ["math", "logic", "engines"] },
  },

  missing: {
    // A name that resolves to nothing renders the empty string — never an error.
    template: "name=[{{name}}] missing=[{{nope}}] null=[{{nada}}]",
    data: { name: "Ada", nada: null },
  },

  // ── Sections ───────────────────────────────────────────────────────────
  sectionArray: {
    // An array section iterates; each element is pushed as the context.
    template: "<ul>{{#items}}<li>{{name}} ({{qty}})</li>{{/items}}</ul>",
    data: { items: [{ name: "pen", qty: 3 }, { name: "ink", qty: 1 }] },
  },

  sectionBool: {
    // A boolean (or any truthy scalar) renders the body once, falsy omits it.
    template: "{{#active}}● online{{/active}}{{^active}}○ offline{{/active}}",
    data: { active: true },
  },

  sectionObject: {
    // An object section pushes that object as the context for its body.
    template: "{{#user}}{{name}} <{{email}}>{{/user}}",
    data: { user: { name: "Ada", email: "ada@example.com" } },
  },

  // ── The truthiness gotcha (flagship example) ─────────────────────────────
  truthyZero: {
    // In MUSTACHE, 0 and "" are TRUTHY (only false, null, [] are falsy). A
    // Handlebars refugee expects {{#count}} to hide on 0 — here it renders.
    template: '{{#count}}in stock: {{count}}{{/count}}{{^count}}sold out{{/count}}\n{{#note}}note: "{{note}}"{{/note}}',
    data: { count: 0, note: "" },
  },

  // ── Inverted sections ────────────────────────────────────────────────────
  inverted: {
    template: "<ul>{{#items}}<li>{{.}}</li>{{/items}}{{^items}}<li><em>nothing here</em></li>{{/items}}</ul>",
    data: { items: [] },
  },

  // ── Comments ──────────────────────────────────────────────────────────────
  comment: {
    template: "Total{{! the bang tag is dropped entirely }}: {{total}}",
    data: { total: 99 },
  },

  // ── Partials ───────────────────────────────────────────────────────────────
  partial: {
    // {{> name}} includes another template; it inherits the caller's context.
    // A partial is a reusable multi-line chunk — here, a small card.
    template: "{{> card}}",
    partials: { card: "{{name}} — {{role}}\nsince {{joined}}" },
    data: { name: "Ada", role: "author", joined: 1842 },
  },

  partialList: {
    // A partial reused per row. The row's line break lives INSIDE the partial
    // body: a standalone `{{> row}}` line has its own newline trimmed, so a
    // partial owns its trailing newline — otherwise the rows run together.
    template: "{{#people}}{{> row}}{{/people}}",
    partials: { row: "- {{name}} ({{role}})\n" },
    data: {
      people: [
        { name: "Ada", role: "author" },
        { name: "Charles", role: "engine" },
      ],
    },
  },

  // ── Template inheritance ─────────────────────────────────────────────────
  inheritance: {
    // {{<layout}} renders a parent template; {{$title}} blocks override the
    // parent's same-named blocks (the parent supplies a default).
    template: "{{<layout}}{{$title}}Welcome{{/title}}{{$body}}Glad you came.{{/body}}{{/layout}}",
    partials: {
      layout: "== {{$title}}Untitled{{/title}} ==\n{{$body}}(empty){{/body}}",
    },
    data: {},
  },

  // ── Dynamic-name partials ────────────────────────────────────────────────
  dynamicPartial: {
    // {{>* which}} resolves the partial name from the data at render time.
    template: "{{>* which}}",
    partials: { en: "Hello, {{name}}!", de: "Hallo, {{name}}!" },
    data: { which: "de", name: "Ada" },
  },

  // ── Set delimiters ───────────────────────────────────────────────────────
  setDelimiters: {
    // {{=<% %>=}} changes the active delimiters mid-stream; <%={{ }}=%> restores
    // them. The set-delimiter lines are standalone, so they leave no blank line.
    template:
      "* {{before}}\n{{=<% %>=}}\n* <% during %>\n<%={{ }}=%>\n* {{after}}\n",
    data: { before: "default", during: "erb-style", after: "default again" },
  },
};
