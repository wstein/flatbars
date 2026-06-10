// SPDX-License-Identifier: Apache-2.0
//
// The MaxBars reference's runnable examples — ONE source, consumed by THREE
// places so they can never drift:
//   1. the /maxbars reference page (live preview + "Open in Lab"),
//   2. the CI gate scripts/check-tutorial-links.mjs (renders each through the real
//      MaxBars `maxbars` engine and asserts output; `compiles: true` also asserts
//      the compiled JS), and
//   3. the FlatBars Lab's MaxBars example dropdown — generated into
//      lab/examples/maxbars/ by scripts/gen-examples.mjs, snapshot-gated by
//      check:examples. (Helper-bearing entries carry a `helpers` field — ADR-018 —
//      and are page-only: the Lab dropdown skips them.)
//
// This set is the MaxBars MIRROR of the ClassicBars reference (classicbars.mjs): every
// ClassicBars concept is reimplemented in IDIOMATIC MaxBars, then the MaxBars-only
// features are GROUPED into a few larger examples. Like the other references it is
// NON-HTML by default (the `card` capstone is the one HTML preview; `escaping`
// keeps its markup in the DATA). ORDER IS DISPLAY ORDER and each `label` carries
// its tier — the Lab dropdown is a flat list, read simple → advanced.
//
// MaxBars is FlatBars' flagship surface: it borrows MOST of ClassicBars and adds infix
// operators, a pipe `|`, defaults (`??` `?:` `? :`), and a different loop/context
// model. The deltas the engine ENFORCES, that shape every example here:
//   • Operators are infix and spaced: `{{price * qty}}`, `{{qty >= 1}}`, and the
//     pipe `{{name | uppercase}}` feeds the left value as the helper's first arg.
//   • Loop variables are BARE under `loop.` — `loop.index0/index1/first/last/
//     length/key/rindex0` — never @-prefixed. Context climbs with `parent`
//     (chainable) and `root`, never `../` or `@root`.
//   • A clause-separator condition MUST be parenthesised: `{{else if (gte n 1)}}`.
//     A bare infix separator parses but silently takes the wrong branch.
//   • Partials: EXTERNAL host-threaded `{{> name}}` (the partials registry, each
//     partial itself MaxBars source — ADR/commit cfadebc) AND template-local
//     `{{#inline "x"}}…{{/inline}}` both work, plus the `{{yield}}` layout pattern
//     via `{{#partial}}` (inline wins on a name clash). Only the `{{#*inline}}`
//     decorator stays ClassicBars-only. Raw blocks use the `{{{{#op}}}}` hash sigil.
//   • Arithmetic is strictly numeric: `"x" + "y"` throws (no string concat).

export const examples = {
  // ── Simple: interpolation & paths ──────────────────────────────────────────
  hello: {
    engine: "maxbars",
    label: "Simple — Hello World",
    template: "Hello, {{name}}!",
    data: { name: "Ada" },
  },

  dotted: {
    engine: "maxbars",
    label: "Simple — Dotted paths",
    template: "{{user.name}} — {{user.address.city}}",
    data: { user: { name: "Ada", address: { city: "London" } } },
  },

  missing: {
    engine: "maxbars",
    label: "Simple — Missing → empty",
    // A path that resolves to nothing renders the empty string — never an error.
    template: "name=[{{name}}] missing=[{{nope}}] null=[{{nada}}]",
    data: { name: "Ada", nada: null },
  },

  escaping: {
    engine: "maxbars",
    label: "Simple — Escaping (markup in data)",
    // {{x}} HTML-escapes (the safe default); {{{x}}} emits raw — identical to ClassicBars.
    // The markup is in the DATA; shown as plain text so the entities are visible.
    template: "escaped: {{html}}\nraw:     {{{html}}}",
    data: { html: "<b>bold & bright</b>" },
  },

  comment: {
    engine: "maxbars",
    label: "Simple — Comments",
    template: "Total{{! dropped }}: {{total}}{{!-- not shown: }} --}}",
    data: { total: 99 },
  },

  // ── Intermediate: operators, pipes, defaults, control flow ─────────────────
  identity: {
    engine: "maxbars",
    label: "Intermediate — One operation, three spellings",
    // THE point of MaxBars: an infix operator, a named helper call, and a
    // parenthesised subexpression are the SAME operation. `a * b` ≡ `multiply a b`
    // ≡ `(multiply a b)`. Arithmetic is strictly numeric (no string `+`).
    template: "infix:   {{price * qty}}\nhelper:  {{multiply price qty}}\nsubexpr: {{(multiply price qty)}}",
    data: { price: 4, qty: 3 },
  },

  pipes: {
    engine: "maxbars",
    label: "Intermediate — Pipes (value | helper)",
    // The pipe feeds the left value in as the helper's FIRST argument and chains
    // left-to-right: `name | uppercase` is `(uppercase name)`; extra args follow
    // the helper name; and `lookup` reads a data-chosen key — the MaxBars idiom for
    // ClassicBars's `{{uppercase (lookup …)}}` subexpression.
    template: "{{name | uppercase}}\n{{price | toFixed 2}}\n{{items | pluck \"name\" | join \", \"}}\n{{lookup colours selected | uppercase}}",
    data: {
      name: "ada",
      price: 1.5,
      items: [{ name: "Pen" }, { name: "Ink" }, { name: "Pad" }],
      colours: ["red", "green", "blue"],
      selected: 1,
    },
  },

  filters: {
    engine: "maxbars",
    label: "Intermediate — Collection filters (where / find / some)",
    // Key-based filters (ADR-036/037), pipe-able like any collection op. `where`
    // keeps items by a field: truthy (`"inStock"`), or a comparator + value
    // (`"price" "<=" 100`). The comparator is a name (`lte`) or its glyph alias
    // (`<=`) — the same operator you write infix. `find` returns the first match;
    // `some` tests membership (`includes` is array-membership or substring). No
    // lambdas — you filter by a key, not an arbitrary predicate (ADR-020).
    template:
      "In stock under 100:\n" +
      "{{#each p in (products | where \"inStock\" | where \"price\" \"<=\" 100)}}- {{p.name}} ({{p.price}})\n{{/each}}" +
      "Premium pick: {{lookup (products | find \"price\" \">\" 100) \"name\"}}\n" +
      "Has a sale tag? {{#if (products | some \"tags\" \"includes\" \"sale\")}}yes{{else}}no{{/if}}",
    data: {
      products: [
        { name: "Keyboard", price: 45, inStock: true, tags: ["new"] },
        { name: "Monitor", price: 220, inStock: true, tags: ["sale", "pro"] },
        { name: "Mouse", price: 25, inStock: false, tags: ["sale"] },
        { name: "Webcam", price: 70, inStock: true, tags: [] },
      ],
    },
  },

  defaults: {
    engine: "maxbars",
    label: "Intermediate — Defaults: ?? ?: and ternary",
    // Three coalescing forms. `??` (null-coalesce) falls back on null/undefined
    // ONLY — a present "" or 0 is kept. `?:` (Elvis) falls back on any FALSY value,
    // so a blank "" passes through. `cond ? a : b` chooses between two values.
    template: "coalesce: {{nickname ?? name}}\nelvis:    {{label ?: \"untitled\"}}\nternary:  {{count > 0 ? \"in stock\" : \"sold out\"}}",
    data: { name: "Ada", label: "", count: 0 },
  },

  conditionals: {
    engine: "maxbars",
    label: "Intermediate — If / else if / unless (infix)",
    // Infix comparisons make the condition direct — `{{#if stock >= 10}}` instead of
    // ClassicBars's `{{#if (gte stock 10)}}`. The ONE catch: a clause SEPARATOR must
    // parenthesise its condition (`{{else if (gte stock 1)}}`) — a bare infix there
    // silently takes the wrong branch. {{#unless}} is the inverse.
    compiles: true,
    template:
      "{{name}}: {{#if stock >= 10}}in stock{{else if (gte stock 1)}}low ({{stock}}){{else}}sold out{{/if}}{{#unless shipsFree}} · shipping extra{{/unless}}",
    data: { name: "Keyboard", stock: 3, shipsFree: false },
  },

  caseBlock: {
    engine: "maxbars",
    label: "Intermediate — Case / when (multi-arm)",
    // `{{#case s}}` dispatches the subject against each `{{when}}` arm by equality —
    // clearer than a chain of `{{else if (eq s …)}}`. One arm can list several values
    // (`{{when "pending" "queued"}}`); `{{else}}` is the catch-all. It is a first-class
    // construct: the Trussbars compiler lowers it to a Rust `match` (the subject read once).
    compiles: true,
    template:
      "{{#case status}}{{when \"shipped\"}}📦 On its way{{when \"pending\" \"queued\"}}⏳ Waiting{{when \"delivered\"}}✓ Delivered{{else}}Unknown status{{/case}}",
    data: { status: "queued" },
  },

  eachList: {
    engine: "maxbars",
    label: "Intermediate — Each: loop vars, nesting & context",
    // {{#each}} iterates. The loop state is BARE under `loop.` (loop.index0,
    // loop.last, loop.length, …) — never @index. Context climbs with `parent` (the
    // enclosing context) and `root` (the top-level data) — never `../` or @root.
    compiles: true,
    template: `{{#each teams}}
{{name}} ({{root.org}}):
{{#each members}}
  {{loop.index0}}. {{this}}{{#if loop.last}} (last){{/if}} — {{parent.name}}
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
    engine: "maxbars",
    label: "Intermediate — Each: the empty case ({{else}})",
    // {{#each}} carries its own {{else}} for an empty list — inherited from ClassicBars.
    template: `{{#each items}}
- {{this}}
{{else}}
(nothing yet)
{{/each}}`,
    data: { items: [] },
  },

  eachObject: {
    engine: "maxbars",
    label: "Intermediate — Each over an object (loop.key)",
    // Over an object, `loop.key` is the property name and `this` the value (ClassicBars's
    // @key, bare).
    template: `{{#each prefs}}
{{loop.key}} = {{this}}
{{/each}}`,
    data: { prefs: { theme: "dark", lang: "en" } },
  },

  rangeOp: {
    engine: "maxbars",
    label: "Intermediate — Ranges: the `..` operator",
    // `a..b` is the inclusive integer range (sugar for the `range` helper), so
    // `{{#each 1..n}}` counts without a data array. Bounds are expressions and
    // additive binds tighter than `..`, so `1..pages` and `start..start+2` both
    // read naturally. Descending bounds yield the empty list (the `{{else}}`).
    compiles: true,
    template: `{{#each 1..rounds}}Round {{this}}{{#unless loop.last}} · {{/unless}}{{/each}}`,
    data: { rounds: 3 },
  },

  collections: {
    engine: "maxbars",
    label: "Intermediate — Collection literals: [list] & {dict}",
    // `[…]` is a list literal (sugar for the `list` helper) and `{k: v}` a dict
    // (sugar for `dict`). Elements/values are full expressions, so they nest and
    // take infix. The structural scanner is brace-aware, so a dict needs no space
    // before the closing `}}`.
    compiles: true,
    template: `{{#each [{name: lead, role: "lead"}, {name: "Lin", role: "dev"}]}}{{name}} ({{role}}){{#unless loop.last}}, {{/unless}}{{/each}}`,
    data: { lead: "Ada" },
  },

  letBindings: {
    engine: "maxbars",
    label: "Intermediate — Let: block-scoped aliases",
    // `{{#let name=value}}` binds template-local constants for the body WITHOUT
    // re-rooting the context (unlike `with`). Bindings are sequential — a later
    // value sees an earlier name — so `tax` can build on `subtotal`.
    compiles: true,
    template: `{{#let subtotal=(multiply price qty) tax=(multiply subtotal rate)}}
{{qty}} × {{price}} = {{subtotal}}, tax {{tax}}, total {{add subtotal tax}}
{{/let}}`,
    data: { price: 20, qty: 3, rate: 0.1 },
  },

  withBlock: {
    engine: "maxbars",
    label: "Intermediate — With: re-root the context",
    // {{#with obj}} re-roots the context, unchanged from ClassicBars — operators and
    // pipes apply to the shifted context just the same.
    template: "{{#with totals}}{{count}} items · {{total | toFixed 2}}{{/with}}",
    data: { totals: { count: 2, total: 9.5 } },
  },

  // ── Advanced: loop params, partials, helpers, capstones ────────────────────
  loopParams: {
    engine: "maxbars",
    label: "Advanced — Loop bindings & labelled loops",
    // MaxBars binds loop variables Liquid-style: `{{#each elem i j in xs}}` binds
    // the element, the 0-based index, and the 1-based index — scoped names that stay
    // visible in nested blocks. A `label NAME` clause (MaxBars-only) names the loop
    // FRAME, so an inner loop reads the OUTER loop's full state — `outer.index1`,
    // `outer.length`, `outer.last` — not just its element.
    compiles: true,
    template: `{{#each section in sections label outer}}
{{outer.index1}}/{{outer.length}} {{section.title}}:{{#each item in section.items}} {{item}}{{/each}}{{#if outer.last}} (last){{/if}}
{{/each}}`,
    data: {
      sections: [
        { title: "Fruit", items: ["Pear", "Plum"] },
        { title: "Veg", items: ["Leek"] },
      ],
    },
  },

  partials: {
    engine: "maxbars",
    label: "Advanced — External partials: per-row & dynamic",
    // MaxBars resolves EXTERNAL {{> name}} against host-supplied partials (each
    // itself MaxBars source — render AND compile, commit cfadebc), exactly like
    // ClassicBars. Combined with {{#each}} it templates a row each, and the name can
    // be an EXPRESSION resolved per row — {{> (lookup this "kind")}} picks the
    // partial from the data. (A template-local {{#inline}} of the same name wins.)
    template: `{{#each people}}{{> (lookup this "kind")}}
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
    engine: "maxbars",
    label: "Advanced — Layout partials ({{yield}})",
    // The MaxBars layout pattern, the bare spelling of Handlebars' block partials:
    // {{#inline "x"}}…{{yield}}…{{/inline}} DEFINES a layout with a hole, and
    // {{#partial "x"}}body{{/partial}} invokes it, dropping `body` in at {{yield}}.
    template: '{{#inline "frame"}}== {{title}} ==\n{{yield}}\n== end =={{/inline}}{{#partial "frame"}}Glad you came.{{/partial}}',
    data: { title: "Welcome" },
  },

  helpers: {
    engine: "maxbars",
    label: "Advanced — Custom & block operations",
    // MaxBars is a native dialect, so a host registers with the native
    // registerOperation(name, fn[, arity]) at the JS boundary (ADR-019 addendum;
    // `registerHelper` is the Handlebars-named alias ClassicBars keeps). Three
    // shapes: `loud` (inline), `link` (reads trailing hash args), `list` (a BLOCK
    // operation whose options.fn(item, { blockParams }) binds the drop-pipes `as p i`).
    helpers:
      "registerOperation('loud', (s) => String(s).toUpperCase(), 1);\n" +
      "registerOperation('link', (text, o) => safe('<a href=\"' + (o.url || '#') + '\">' + text + '</a>'));\n" +
      "registerOperation('list', (items, o) =>\n" +
      "  safe('<ul>' + items.map((p, i) => o.fn(p, { blockParams: [p, i] })).join('') + '</ul>'));",
    template:
      '{{loud name}}\n{{{link "Home" url="/home"}}}\n{{#list people as p i}}<li>{{i}}: {{p.name}}</li>{{/list}}',
    data: { name: "ada", people: [{ name: "Ada" }, { name: "Lin" }] },
  },

  rawBlock: {
    engine: "maxbars",
    label: "Advanced — Raw blocks ({{{{#op}}}})",
    // A raw block hands its body to the head OPERATION completely UNPROCESSED: the
    // inner {{bar}} is never interpreted — it is literal text the operation receives
    // via options.fn(). `rawloud` upper-cases that raw body, so the verbatim {{bar}}
    // comes out {{BAR}} (the data is never read). MaxBars uses the FlatBars
    // {{{{#name}}}} spelling (hash sigil), like RawBars — NOT the bare ClassicBars form;
    // the op name has no hyphen (a `-` would parse as subtraction). The head must
    // resolve to a defined operation (an undefined head is a hard error).
    helpers: "registerOperation('rawloud', (options) => options.fn().toUpperCase());",
    template: "{{{{#rawloud}}}}\n  {{bar}}\n{{{{/rawloud}}}}",
    data: { bar: "ignored" },
  },

  email: {
    engine: "maxbars",
    label: "Advanced — Putting it together (email)",
    // The capstone reusing familiar pieces in one realistic, non-HTML template:
    // interpolation, a dotted path, an {{#each}} with its built-in {{else}}, and an
    // external {{> item}} partial — a plain-text shipping notice.
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
    engine: "maxbars",
    label: "Advanced — HTML card (styling in a partial)",
    // The one example whose OUTPUT is HTML — so it previews as HTML, not text. An
    // external {{> styles}} partial holds the CSS once, {{> card}} is one row's
    // markup with a {{#if lead}} badge, and {{#each}} iterates.
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
