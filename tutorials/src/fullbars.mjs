// SPDX-License-Identifier: Apache-2.0
//
// The FullBars reference's runnable examples — ONE source, consumed by THREE
// places so they can never drift:
//   1. the /fullbars reference page (live preview + "Open in Lab"),
//   2. the CI gate scripts/check-tutorial-links.mjs (renders each through the real
//      FullBars `surface` engine and asserts output; `compiles: true` also asserts
//      the compiled JS), and
//   3. the FlatBars Lab's FullBars example dropdown — generated into
//      lab/examples/fullbars/ by scripts/gen-examples.mjs, snapshot-gated by
//      check:examples. (Helper-bearing entries carry a `helpers` field — ADR-018
//      registerHelper source — and are page-only: the Lab dropdown skips them.)
//
// This set is the FullBars MIRROR of the MinBars reference (mustache.mjs): every
// MinBars concept is reimplemented in IDIOMATIC Handlebars, then the
// Handlebars-only features are GROUPED into a few larger examples to keep the
// count low. Like MinBars the examples are NON-HTML by default (plain text is
// where templating lives); the two exceptions earn their markup — `escaping`
// (the markup is in the DATA, shown as text) and the capstone `card` (its OUTPUT
// is HTML, so it previews as HTML). ORDER IS DISPLAY ORDER and each `label`
// carries its tier — the Lab dropdown is a flat list, read simple → advanced.
//
// Two rules keep every entry honest to FullBars and off its neighbours:
//   • No MaxBars operators. `score >= 50` is MaxBars; FullBars writes the
//     subexpression `(gte score 50)`.
//   • No Mustache sections / set delimiters. `{{#each}}`/`{{#if}}` are explicit;
//     `{{#person}}` is not an implicit section, and `{{=A B=}}` is MinBars-only
//     (no Handlebars equivalent — the one MinBars concept with no mirror here).
// Spacing is tight — `{{name}}`, never `{{ name }}`.

export const examples = {
  // ── Simple: interpolation & paths ──────────────────────────────────────────
  hello: {
    engine: "fullbars",
    label: "Simple — Hello World",
    template: "Hello, {{name}}!",
    data: { name: "Ada" },
  },

  dotted: {
    engine: "fullbars",
    label: "Simple — Dotted paths",
    // A dot walks into nested objects; missing segments stop at empty, not error.
    template: "{{user.name}} — {{user.address.city}}",
    data: { user: { name: "Ada", address: { city: "London" } } },
  },

  missing: {
    engine: "fullbars",
    label: "Simple — Missing → empty",
    // A path that resolves to nothing renders the empty string — never an error.
    template: "name=[{{name}}] missing=[{{nope}}] null=[{{nada}}]",
    data: { name: "Ada", nada: null },
  },

  escaping: {
    engine: "fullbars",
    label: "Simple — Escaping (markup in data)",
    // {{x}} HTML-escapes (the safe default — Handlebars's defining feature); {{{x}}}
    // and the {{&x}} alias emit raw. The markup is in the DATA; shown as plain text
    // so the escaped entities are visible.
    template: "escaped: {{html}}\nraw:     {{{html}}}\namp:     {{&html}}",
    data: { html: "<b>bold & bright</b>" },
  },

  comment: {
    engine: "fullbars",
    label: "Simple — Comments",
    // {{! … }} (and the {{!-- … --}} form, which may itself contain }}) is dropped.
    template: "Total{{! dropped }}: {{total}}{{!-- not shown: }} --}}",
    data: { total: 99 },
  },

  // ── Intermediate: control flow ─────────────────────────────────────────────
  conditionals: {
    engine: "fullbars",
    label: "Intermediate — If / else if / else / unless",
    // Handlebars control flow is EXPLICIT (unlike Mustache's shape-decides
    // sections): {{#if}} takes a helper application — here the subexpression
    // `(gte stock 10)`, the FullBars way to write `stock >= 10` — and chains via
    // `else if`; {{#unless}} is its inverse. Note 0 is falsy in FullBars (the
    // opposite of MinBars). Compiles to JS (the pane below).
    compiles: true,
    template:
      "{{name}}: {{#if (gte stock 10)}}in stock{{else if (gte stock 1)}}low stock ({{stock}}){{else}}sold out{{/if}}{{#unless shipsFree}} · shipping extra{{/unless}}",
    data: { name: "Keyboard", stock: 3, shipsFree: false },
  },

  eachList: {
    engine: "fullbars",
    label: "Intermediate — Each: nesting, loop data & parent paths",
    // {{#each}} iterates — the idiomatic form of a Mustache list section. Nested,
    // it shows the loop-data variables (@index, @last) AND the path climbers
    // unique to Handlebars: `../name` reaches the enclosing context and `@root`
    // jumps to the top-level data, however deep the nesting.
    template: `{{#each teams}}
{{name}} ({{@root.org}}):
{{#each members}}
  {{@index}}. {{this}}{{#if @last}} (last){{/if}} — {{../name}}
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

  eachElse: {
    engine: "fullbars",
    label: "Intermediate — Each: the empty case ({{else}})",
    // {{#each}} carries its own {{else}} for an empty (or absent) list — the
    // idiomatic Handlebars form of a Mustache inverted section. No separate tag.
    template: `{{#each items}}
- {{this}}
{{else}}
(nothing yet)
{{/each}}`,
    data: { items: [] },
  },

  eachObject: {
    engine: "fullbars",
    label: "Intermediate — Each over an object (@key)",
    // Over an object, @key is the property name and `this` the value — there is no
    // Mustache equivalent (sections push an object as context; they don't iterate).
    template: `{{#each prefs}}
{{@key}} = {{this}}
{{/each}}`,
    data: { prefs: { theme: "dark", lang: "en" } },
  },

  withBlock: {
    engine: "fullbars",
    label: "Intermediate — With: re-root the context",
    // {{#with obj}} makes obj the body's context — the idiomatic Handlebars form of
    // a Mustache object section ({{#user}}…{{/user}}), handy for a deep path.
    template: `{{#with user}}
{{name}} <{{email}}>
{{/with}}`,
    data: { user: { name: "Ada", email: "ada@example.com" } },
  },

  // ── Advanced: compose helpers, partials, capstones ─────────────────────────
  subexprLookup: {
    engine: "fullbars",
    label: "Advanced — Subexpressions & lookup",
    // Parentheses nest one helper's result into another's arguments — how FullBars
    // composes its ~80 prelude helpers instead of "write a JS helper for
    // everything". {{lookup obj key}} reads a field whose name isn't known until
    // render (an array index or a data-chosen property); here its result is upper-
    // cased by `uppercase`.
    template: "{{uppercase (lookup colours selected)}}",
    data: { selected: 1, colours: ["red", "green", "blue"] },
  },

  partials: {
    engine: "fullbars",
    label: "Advanced — Partials: per-row & dynamic",
    // {{> name}} includes another template, inheriting the caller's context — the
    // natural unit of reuse. Combined here with {{#each}} (a partial per row) and a
    // DYNAMIC name `{{> (lookup this "kind")}}`, resolved from the data per row.
    template: `{{#each people}}
{{> (lookup this "kind")}}
{{/each}}`,
    partials: {
      author: "- {{name}} writes",
      engineer: "- {{name}} builds",
    },
    data: {
      people: [
        { name: "Ada", kind: "author" },
        { name: "Charles", kind: "engineer" },
      ],
    },
  },

  layoutPartials: {
    engine: "fullbars",
    label: "Advanced — Layout & inline partials",
    // Two Handlebars-only partial forms. {{#*inline "name"}}…{{/inline}} DEFINES a
    // partial inline (scoped to the rest of the template); {{#> layout}}…{{/layout}}
    // calls a partial and hands it a block, which the partial drops in with
    // {{> @partial-block}} — Handlebars-style layout reuse.
    template: `{{#*inline "hi"}}Hi {{name}}!{{/inline}}{{#> frame}}{{> hi}}{{/frame}}`,
    partials: { frame: "== Welcome ==\n{{> @partial-block}}\n== Bye ==" },
    data: { name: "Ada" },
  },

  helpers: {
    engine: "fullbars",
    label: "Advanced — Custom & block helpers",
    // A host registers its own with the Handlebars-style registerHelper(name,
    // fn[, arity]) — the single most common extension, grouped here three ways:
    // `loud` is a plain inline helper; `link` reads hash (key=value) arguments off
    // options.hash; `list` is a BLOCK helper (ADR-020) whose options.fn(item, {
    // blockParams }) renders the body with a shifted context and binds `as |p i|`.
    helpers:
      "registerHelper('loud', (s) => String(s).toUpperCase(), 1);\n" +
      "registerHelper('link', (text, o) => safe('<a href=\"' + (o.url || '#') + '\">' + text + '</a>'));\n" +
      "registerHelper('list', (items, o) =>\n" +
      "  safe('<ul>' + items.map((p, i) => o.fn(p, { blockParams: [p, i] })).join('') + '</ul>'));",
    template:
      '{{loud name}}\n{{{link "Home" url="/home"}}}\n{{#list people as |p i|}}<li>{{i}}: {{p.name}}</li>{{/list}}',
    data: { name: "ada", people: [{ name: "Ada" }, { name: "Lin" }] },
  },

  rawBlock: {
    engine: "fullbars",
    label: "Advanced — Raw blocks",
    // A raw block {{{{helper}}}}…{{{{/helper}}}} hands its body to the helper
    // UNPROCESSED: the inner `{{bar}}` is never interpreted — it's literal text the
    // helper receives via options.fn(). `raw-loud` upper-cases that raw body, so
    // the verbatim `{{bar}}` comes out as `{{BAR}}` (the data's `bar` is never
    // read). The Handlebars raw-block feature, verbatim.
    helpers: "registerHelper('raw-loud', (options) => options.fn().toUpperCase());",
    template: "{{{{raw-loud}}}}\n  {{bar}}\n{{{{/raw-loud}}}}",
    data: { bar: "ignored" },
  },

  email: {
    engine: "fullbars",
    label: "Advanced — Putting it together (email)",
    // The capstone reusing familiar pieces in one realistic, non-HTML template:
    // interpolation, dotted paths, an {{#each}} with its built-in {{else}} for the
    // empty case, and a {{> item}} partial — a plain-text shipping notice.
    template: `Hi {{name}},

Your order shipped. Items:
{{#each items}}
{{> item}}
{{else}}
- (none)
{{/each}}

— {{store.name}} ({{store.url}})`,
    partials: { item: "- {{title}} ×{{qty}}" },
    data: {
      name: "Ada",
      items: [{ title: "Pen", qty: 3 }, { title: "Ink", qty: 1 }],
      store: { name: "FlatMart", url: "flatmart.example" },
    },
  },

  card: {
    engine: "fullbars",
    label: "Advanced — HTML card (styling in a partial)",
    // The one example whose OUTPUT is HTML — so it previews as HTML, not text.
    // Partials compose the markup: {{> styles}} holds the CSS once, {{> card}} is
    // one row's markup, {{#each}} iterates, and a {{#if lead}} badge shows a
    // conditional inside the partial.
    view: "rendered",
    template: "{{> styles}}\n{{#each people}}\n{{> card}}\n{{/each}}",
    partials: {
      styles:
        "<style>\n" +
        "  .card { border: 1px solid #d0d7de; border-radius: 8px; padding: .5rem .8rem; margin: .5rem 0; font-family: system-ui, sans-serif; }\n" +
        "  .card h3 { margin: 0 0 .15rem; font-size: 1rem; }\n" +
        "  .card p  { margin: 0; color: #57606a; }\n" +
        "</style>",
      card: '<div class="card">\n  <h3>{{name}}{{#if lead}} ★{{/if}}</h3>\n  <p>{{role}}</p>\n</div>',
    },
    data: {
      people: [
        { name: "Ada Lovelace", role: "Author", lead: true },
        { name: "Charles Babbage", role: "Engine" },
      ],
    },
  },
};
