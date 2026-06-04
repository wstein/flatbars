// SPDX-License-Identifier: Apache-2.0
//
// The MaxBars reference's runnable examples — ONE source, imported by both the
// reference page (live preview + "Open in Lab") and the CI gate
// (scripts/check-tutorial-links.mjs), which renders every one through the real
// MaxBars (`maxbars`) engine and asserts it produces output. Same contract as
// fullbars.mjs / mustache.mjs / rawbars.mjs: the runnable example is the source
// of truth; the page's prose only annotates it; the normative text stays in docs/
// (maxbars.adoc) and is never forked here.
//
// MaxBars is FlatBars' flagship surface: it borrows most of FullBars and adds infix
// operators, a pipe, and bare loop variables. The
// examples lead with those deltas; the inherited FullBars constructs appear only
// to show the operators working *inside* them. Several things every example here
// is written to respect, because the engine enforces them (all verified):
//   • Tight delimiters, spaced operators: `{{price * qty}}`, `{{name | uppercase}}`.
//   • Loop variables are BARE — index1 / index0 / first / last / length / key /
//     rindex — never @-prefixed. (FullBars's @index is intentionally not shown.)
//   • Clause-separator conditions MUST be parenthesised: `{{else if (gt n 0)}}`.
//     A bare infix separator (`{{else if n > 0}}`) does not error — it silently
//     takes the wrong branch.
//   • No partials. `{{#*inline}}` is a LexError in MaxBars and the host entrypoint
//     doesn't thread external partials — partial composition is a FullBars job.
//   • Arithmetic is strictly numeric: `"x" + "y"` throws (no string concat).

export const examples = {
  // ── What MaxBars is ───────────────────────────────────────────────────────
  intro: {
    // One tag, two MaxBars features: a pipe (`customer | capitalize`) and an
    // ordinary helper call (`count items`). Both are just helper applications.
    engine: "maxbars",
    template: "{{customer | capitalize}}'s cart — {{count items}} lines",
    data: {
      customer: "ada",
      items: [{ name: "Pen" }, { name: "Ink" }, { name: "Pad" }],
    },
  },

  // ── Operators: math / comparison / logic / ?? ─────────────────────────────
  math: {
    // Infix arithmetic. `*` `+` `-` `/` `%` desugar to multiply/add/subtract/…
    // and are strictly numeric — there is no string `+`.
    engine: "maxbars",
    template: "subtotal: {{price * qty}}",
    data: { price: 1.5, qty: 3 },
  },

  comparison: {
    // `>= > <= < == !=` are infix in MaxBars; in FullBars this is the
    // subexpression {{#if (gte qty 1)}}.
    engine: "maxbars",
    template: "{{#if qty >= 1}}in stock{{else}}sold out{{/if}}",
    data: { qty: 3 },
  },

  logic: {
    // `&&` `||` `!` compose conditions. Parenthesise to control precedence —
    // `&&` binds tighter than `||`, looser than the comparisons.
    engine: "maxbars",
    template: "{{#if featured && (qty > 0)}}★ featured{{/if}}",
    data: { featured: true, qty: 3 },
  },

  coalesce: {
    // `??` is null-coalescing: it falls back on null/undefined only, independent
    // of truthiness — so an empty string or 0 on the left is kept.
    engine: "maxbars",
    template: "Hi {{nickname ?? name}}",
    data: { name: "Ada" },
  },

  // ── Pipes: value | helper ─────────────────────────────────────────────────
  pipeSimple: {
    // The pipe feeds the left value in as the helper's FIRST argument:
    // `name | uppercase` is exactly `(uppercase name)`.
    engine: "maxbars",
    template: "{{name | uppercase}}",
    data: { name: "ada" },
  },

  pipeArgs: {
    // Extra arguments follow the helper name; the piped value is still first.
    // `price | toFixed 2` is `(toFixed price 2)`.
    engine: "maxbars",
    template: "{{price | toFixed 2}}",
    data: { price: 1.5 },
  },

  pipeChain: {
    // Pipes chain left-to-right, each stage feeding the next. Read it as a
    // pipeline: pull every name out of the items, then join them.
    engine: "maxbars",
    template: "{{items | pluck \"name\" | join \", \"}}",
    data: { items: [{ name: "Pen" }, { name: "Ink" }, { name: "Pad" }] },
  },

  // ── The identity: operator ⇄ helper ⇄ subexpression ───────────────────────
  identity: {
    // The whole point of MaxBars: infix, a named helper call, and a parenthesised
    // subexpression are the SAME operation. `a * b` ≡ `multiply a b` ≡ `(multiply a b)`.
    engine: "maxbars",
    template: "infix:   {{price * qty}}\nhelper:  {{multiply price qty}}\nsubexpr: {{(multiply price qty)}}",
    data: { price: 4, qty: 3 },
  },

  // ── Loop variables (bare) ─────────────────────────────────────────────────
  loopVars: {
    // Inside {{#each}}, the loop object exposes the loop state: loop.index0 /
    // loop.index1, loop.rindex0 / loop.rindex1, loop.first, loop.last, loop.length,
    // loop.key. No @ sigil and no bare magic — it is all under `loop.`.
    engine: "maxbars",
    compiles: true,
    template: `{{#each items}}
{{loop.index1}}/{{loop.length}}. {{name}}{{#if loop.first}} (first){{/if}}{{#if loop.last}} (last){{/if}}
{{/each}}`,
    data: { items: [{ name: "Pen" }, { name: "Ink" }, { name: "Pad" }] },
  },

  loopObject: {
    // Over an object, `loop.key` is the property name and `this` the value.
    engine: "maxbars",
    template: `{{#each prefs}}
{{loop.key}} = {{this}}
{{/each}}`,
    data: { prefs: { theme: "dark", lang: "en" } },
  },

  blockParams: {
    // Block params `as |row i|` bind scoped names over the block body — the
    // element and its index. Their point is that they STAY in scope inside nested
    // blocks, so the inner loop still reaches the outer `row`. (A bar in a block
    // head is the `as |…|` delimiter, not the pipe operator — to pipe a head
    // argument, parenthesise it: `{{#each (rows | reverse) as |row i|}}`.)
    engine: "maxbars",
    compiles: true,
    template: `{{#each rows as |row i|}}
{{i}}: {{#each row.tags}}{{row.label}}#{{this}} {{/each}}
{{/each}}`,
    data: { rows: [{ label: "A", tags: ["x", "y"] }, { label: "B", tags: ["z"] }] },
  },

  labelledLoop: {
    // A `label NAME` clause names the loop FRAME, so an inner loop reads the
    // OUTER loop's full state — index1 / length / first / … — not just its element.
    // The label object exposes the bare loop variables as fields.
    engine: "maxbars",
    compiles: true,
    template: `{{#each sections as |section| label outer}}
{{outer.index1}}/{{outer.length}} {{section.title}}:{{#each section.items}} {{this}}{{/each}}{{#if outer.last}} (last){{/if}}
{{/each}}`,
    data: {
      sections: [
        { title: "Fruit", items: ["Pear", "Plum"] },
        { title: "Veg", items: ["Leek"] },
      ],
    },
  },

  contextModel: {
    // `parent` is the enclosing CONTEXT (chainable: parent.parent), `root` is the
    // root context, and `loop.parent` is the enclosing LOOP's metadata. No @ and
    // no ../ — those are gone. A bare {{title}} would be a data field on `this`.
    engine: "maxbars",
    compiles: true,
    template: `{{#each chapters}}{{#each sections}}{{#each items}}
{{loop.parent.index1}}.{{loop.index1}} {{this}} — {{parent.heading}} / {{parent.parent.title}} ({{root.book}})
{{/each}}{{/each}}{{/each}}`,
    data: {
      book: "Cookbook",
      chapters: [
        { title: "Starters", sections: [{ heading: "Soups", items: ["Pea", "Leek"] }] },
      ],
    },
  },

  // ── Inherited from FullBars (operators shown inside) ──────────────────────
  inheritedEach: {
    // Most of FullBars still works — here {{#each}}, {{#if}}, dotted
    // access — now with arithmetic, a pipe, and an == comparison woven through.
    engine: "maxbars",
    template: `{{#each items}}
{{name}}: {{(price * qty) | toFixed 2}}{{#if qty == 0}} — OUT{{/if}}
{{/each}}`,
    data: {
      items: [
        { name: "Pen", price: 1.5, qty: 3 },
        { name: "Ink", price: 4, qty: 1 },
        { name: "Pad", price: 2.25, qty: 0 },
      ],
    },
  },

  withBlock: {
    // {{#with obj}} re-roots the context, unchanged from FullBars — operators and
    // pipes apply to the shifted context just the same.
    engine: "maxbars",
    template: "{{#with totals}}{{count}} items · {{total | toFixed 2}}{{/with}}",
    data: { totals: { count: 2, total: 9.5 } },
  },

  escaping: {
    // {{x}} HTML-escapes (the safe default); {{{x}}} emits raw markup — identical
    // to FullBars.
    engine: "maxbars",
    template: "escaped: {{html}}\nraw:     {{{html}}}",
    data: { html: "<b>bold & bright</b>" },
  },

  subexpr: {
    // Parentheses still group, so operators and helper calls nest freely:
    // uppercase the coalesced name.
    engine: "maxbars",
    template: "{{uppercase (nickname ?? name)}}",
    data: { name: "ada" },
  },

  // ── Where MaxBars diverges ────────────────────────────────────────────────
  separatorParens: {
    // The ONE place infix is not allowed: a clause separator. `{{else if (gt n 0)}}`
    // must parenthesise. The bare form `{{else if n > 0}}` parses but silently
    // takes the wrong branch — so always wrap the condition.
    engine: "maxbars",
    template: `{{#if (gt n 9)}}
big
{{else if (gt n 0)}}
small
{{else}}
non-positive
{{/if}}`,
    data: { n: 5 },
  },
};
