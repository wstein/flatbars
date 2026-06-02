// SPDX-License-Identifier: Apache-2.0
//
// The FullBars reference's runnable examples — ONE source, imported by both the
// reference page (live preview + "Open in Lab") and the CI gate
// (scripts/check-tutorial-links.mjs), which renders every one through the real
// FullBars (`surface`) engine and asserts it produces output. Same contract as
// mustache.mjs / rawbars.mjs: the runnable example is the source of truth; the
// page's prose only annotates it; the normative text stays in docs/ (surface.adoc,
// fullbars-compat.adoc, appendix-handlebars.adoc) and is never forked here.
//
// EVERY entry runs under FullBars — the Handlebars-faithful surface. Two rules
// keep the examples honest to *this* dialect and off its neighbours:
//   • No MaxBars operators. `score >= 50` is MaxBars; FullBars writes the
//     subexpression `(gte score 50)`. Conditions and transforms compose helpers.
//   • No Mustache sections. `{{#person}}` is *not* an implicit truthy/list
//     section here — control flow is explicit `{{#if}}` / `{{#each}}`.
// Spacing is tight throughout — `{{name}}`, never `{{ name }}` — matching the
// Mustache reference and the official Handlebars guide (the engine also forbids a
// space after `{{` in a block tag, so block sigils have to stay tight regardless).
// Custom-helper entries carry a `helpers` field (ADR-018 `registerHelper` source);
// the page and the gate render those through the engine facade's `renderWith`.

export const examples = {
  // ── Expressions & escaping ───────────────────────────────────────────────
  hello: {
    engine: "fullbars",
    template: "Hello, {{name}}!",
    data: { name: "Ada" },
  },

  escaping: {
    // {{x}} HTML-escapes (the safe default); {{{x}}} emits raw markup. Handlebars's
    // {{&x}} is accepted as an alias; the triple-stash is the canonical spelling.
    engine: "fullbars",
    template: "escaped: {{html}}\nraw:     {{{html}}}",
    data: { html: "<b>bold & bright</b>" },
  },

  // ── Paths ──────────────────────────────────────────────────────────────────
  dotted: {
    // Dotted paths reach into nested objects; `this` is the current context.
    engine: "fullbars",
    template: "{{user.name}} — {{user.address.city}}",
    data: { user: { name: "Ada", address: { city: "London" } } },
  },

  paths: {
    // Inside a block, `../` climbs to the enclosing context and `@root` jumps to
    // the top-level data — both regardless of how deep the nesting goes.
    engine: "fullbars",
    template: `{{#each teams}}
{{name}}:
{{#each members}}
  - {{this}} ({{../name}} @ {{@root.org}})
{{/each}}
{{/each}}`,
    data: {
      org: "Acme",
      teams: [
        { name: "Engine", members: ["Ada", "Charles"] },
        { name: "Docs", members: ["Grace"] },
      ],
    },
  },

  // ── Conditionals: if / else / else if / unless ───────────────────────────
  ifBlock: {
    // {{#if}} takes a helper application, never an implicit Mustache section. The
    // `else if` chain lowers to the engine's `elif` clause; the condition here is
    // a subexpression, the FullBars way to write `score >= 90`.
    engine: "fullbars",
    template: `{{#if (gte score 90)}}
grade: A
{{else if (gte score 50)}}
grade: pass
{{else}}
grade: fail
{{/if}}`,
    data: { score: 72 },
  },

  unless: {
    // {{#unless x}} renders when x is falsy — the explicit inverse of {{#if}}.
    engine: "fullbars",
    template: `{{#unless inStock}}
<em>out of stock</em>
{{/unless}}`,
    data: { inStock: false },
  },

  // ── each: lists, objects, loop data, the empty case ───────────────────────
  eachList: {
    // {{#each}} iterates; @index is the position, @last the end-of-list flag.
    // This example also compiles to JS (the compiled-JS pane below).
    engine: "fullbars",
    compiles: true,
    template: `<ol>
{{#each items}}
  <li>{{@index}}: {{name}} (×{{qty}})</li>
{{/each}}
</ol>`,
    data: { items: [{ name: "pen", qty: 3 }, { name: "ink", qty: 1 }] },
  },

  eachObject: {
    // Over an object, @key is the property name and `this` the value.
    engine: "fullbars",
    template: `{{#each prefs}}
{{@key}} = {{this}}
{{/each}}`,
    data: { prefs: { theme: "dark", lang: "en" } },
  },

  eachElse: {
    // {{#each}} has its own {{else}} for the empty-list case — no separate inverse.
    engine: "fullbars",
    template: `<ul>
{{#each items}}
  <li>{{this}}</li>
{{else}}
  <li><em>nothing here</em></li>
{{/each}}
</ul>`,
    data: { items: [] },
  },

  // ── with: re-root the context ─────────────────────────────────────────────
  withBlock: {
    // {{#with obj}} makes obj the context for its body — handy for a deep path.
    engine: "fullbars",
    template: `{{#with user.address}}
{{street}}, {{city}}
{{/with}}`,
    data: { user: { address: { street: "12 Newport", city: "London" } } },
  },

  // ── lookup: dynamic keys ───────────────────────────────────────────────────
  lookup: {
    // {{lookup obj key}} reads a field whose name isn't known until render —
    // an index into an array, or a property chosen by the data.
    engine: "fullbars",
    template: "{{lookup colours selected}}",
    data: { selected: 1, colours: ["red", "green", "blue"] },
  },

  // ── Subexpressions: compose the prelude ────────────────────────────────────
  subexpr: {
    // Parentheses nest one helper's result into another's arguments. This is how
    // FullBars replaces "write a JS helper for everything": compose the ~80 that
    // ship. Here: uppercase the looked-up name.
    engine: "fullbars",
    template: "{{uppercase (lookup user \"name\")}}",
    data: { user: { name: "ada" } },
  },

  // ── Custom helpers (ADR-018) ───────────────────────────────────────────────
  customHelper: {
    // A host registers its own helper with the Handlebars-style
    // registerHelper(name, fn[, arity]). `loud` returns a string (escaped in
    // {{ }}); `shout` returns safe(...) to emit raw markup (the SafeString form).
    engine: "fullbars",
    helpers:
      "registerHelper('loud', (s) => String(s).toUpperCase(), 1);\n" +
      "registerHelper('shout', (s) => safe('<strong>' + String(s).toUpperCase() + '!</strong>'), 1);",
    template: "{{loud name}}\n{{{shout name}}}",
    data: { name: "ada" },
  },

  customHelperHash: {
    // Surface hash arguments (key=value) arrive as a trailing object — the natural
    // shape for a helper with named options, e.g. an anchor builder.
    engine: "fullbars",
    helpers:
      "registerHelper('link', (text, opts) =>\n" +
      "  safe('<a href=\"' + (opts.url || '#') + '\">' + text + '</a>'));",
    template: "{{{link \"Home\" url=\"/home\"}}}",
    data: {},
  },

  // ── Partials ───────────────────────────────────────────────────────────────
  partial: {
    // {{> name}} includes another template; it inherits the caller's context.
    engine: "fullbars",
    template: "{{> card}}",
    partials: { card: "{{name}} — {{role}}" },
    data: { name: "Ada", role: "author" },
  },

  partialList: {
    // A partial reused per row. The {{#each}} and {{> row}} tags sit on their own
    // lines, so standalone trimming drops the tag lines but keeps one newline per
    // row — the partial body is just the row, no trailing newline of its own.
    engine: "fullbars",
    template: `{{#each people}}
{{> row}}
{{/each}}`,
    partials: { row: "- {{name}} ({{role}})" },
    data: {
      people: [
        { name: "Ada", role: "author" },
        { name: "Charles", role: "engine" },
      ],
    },
  },

  dynamicPartial: {
    // The partial name is itself an expression, resolved at render time — here a
    // language chosen from the data via lookup.
    engine: "fullbars",
    template: "{{> (lookup this \"lang\")}}",
    partials: { en: "Hello, {{name}}!", de: "Hallo, {{name}}!" },
    data: { lang: "de", name: "Ada" },
  },

  inlinePartial: {
    // {{#*inline "name"}}…{{/inline}} defines a partial inline, scoped to the rest
    // of the template — a reusable row without a separate file. Deliberately inline
    // (bracketed, single line), so opt out of the single-line-collapse heuristic.
    inline: true,
    engine: "fullbars",
    template: `{{#*inline "tag"}}[{{this}}]{{/inline}}{{#each tags}}{{> tag}}{{/each}}`,
    data: { tags: ["math", "logic"] },
  },

  blockPartial: {
    // {{#> layout}}…{{/layout}} calls a partial and hands it a block; the partial
    // drops it in with {{> @partial-block}} — Handlebars-style layout reuse.
    engine: "fullbars",
    template: `{{#> frame}}Glad you came.{{/frame}}`,
    partials: { frame: "== Welcome ==\n{{> @partial-block}}" },
    data: {},
  },

  // ── Comments ────────────────────────────────────────────────────────────────
  comment: {
    // {{! … }} (and the {{!-- … --}} form, which may contain }}) is dropped from
    // the output entirely.
    engine: "fullbars",
    template: "Total{{! dropped }}: {{total}}{{!-- not shown: }} --}}",
    data: { total: 99 },
  },

  // ── Whitespace control (~) ──────────────────────────────────────────────────
  whitespace: {
    // A tilde on either side of a tag trims the run of whitespace next to it —
    // here the newline + indent before and after `name` — so a readably-formatted
    // template can still emit tight output. Reach for it sparingly; overuse makes
    // the template hard to read.
    engine: "fullbars",
    template: `<p>
  {{~name~}}
</p>`,
    data: { name: "Ada" },
  },
};
