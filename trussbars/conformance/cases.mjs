// The Trussbars conformance corpus (the vertical slice the v1 emitter supports).
// Each case is rendered by the interpreter (the oracle) and by the emitted Rust,
// and asserted byte-identical. The two `neg-*` cases use constructs outside the
// slice: the oracle renders them, the emitter returns "unsupported …", and the
// harness records them in the exclusion ledger (it never silently drops them).
//
// Data keys are Rust-identifier-safe and numbers are JSON numbers (typed `f64`).

export const cases = [
  // ── output & paths ─────────────────────────────────────────────────────────
  { id: "hello", template: "Hello, {{name}}!", data: { name: "<b>Ann</b>" } },
  { id: "raw", template: "raw: {{{html}}}", data: { html: "<i>x</i>" } },
  {
    id: "dotted",
    template: "{{user.name}} from {{user.city}}",
    data: { user: { name: "Ann", city: "NYC & co" } },
  },

  // ── operators ──────────────────────────────────────────────────────────────
  {
    id: "arithmetic",
    template: "{{price}} x {{qty}} = {{price * qty}}",
    data: { price: 3, qty: 4 },
  },
  {
    id: "comparison",
    template: "{{#if count >= 3}}many ({{count}}){{else}}few{{/if}}",
    data: { count: 5 },
  },
  {
    id: "logic",
    template: "{{#if a && b}}both{{else}}no{{/if}}",
    data: { a: true, b: true },
  },
  {
    id: "float",
    template: "ratio = {{a / b}}",
    data: { a: 1, b: 8 },
  },

  // ── string helpers & pipes ───────────────────────────────────────────────────
  { id: "uppercase", template: "{{name | uppercase}}", data: { name: "ann" } },
  {
    id: "pipe-chain",
    template: '{{name | capitalize | append "!"}}',
    data: { name: "bob" },
  },

  // ── conditionals ─────────────────────────────────────────────────────────────
  {
    id: "if-else",
    template: "{{#if active}}on{{else}}off{{/if}}",
    data: { active: false },
  },
  {
    id: "unless",
    template: "{{#unless done}}todo{{/unless}}",
    data: { done: false },
  },

  // ── each & loop metadata ─────────────────────────────────────────────────────
  {
    id: "each-strings",
    template: "{{#each tags}}#{{this}} {{/each}}",
    data: { tags: ["x", "y", "z"] },
  },
  {
    id: "each-empty",
    template: "{{#each items}}- {{this}}\n{{else}}(none){{/each}}",
    data: { items: [] },
  },
  {
    id: "each-loopmeta",
    template:
      "{{#each p in people}}{{loop.index1}}. {{p.name}}{{#if loop.last}}!{{/if}} {{/each}}",
    data: { people: [{ name: "A" }, { name: "B" }, { name: "C" }] },
  },
  {
    // Object iteration: keys in sorted order, `loop.key` bound. `maps` types the
    // field as a BTreeMap rather than a struct.
    id: "each-object",
    template: "{{#each prefs}}{{loop.key}} = {{this}}\n{{/each}}",
    data: { prefs: { en: "English", de: "German" } },
    maps: ["prefs"],
  },
  {
    id: "with",
    template: "{{#with user}}{{name}} ({{age}}){{else}}?{{/with}}",
    data: { user: { name: "Bo", age: 30 } },
  },
  {
    id: "nested-each-root",
    // Param name avoids the blessed-op collision (`t` is the translate operation).
    template:
      "{{#each team in teams}}{{team.name}} ({{root.org}}): {{#each team.members}}{{this}} {{/each}}\n{{/each}}",
    data: {
      org: "Acme",
      teams: [
        { name: "T1", members: ["a", "b"] },
        { name: "T2", members: ["c"] },
      ],
    },
  },

  // ── integer-argument string/array helpers ───────────────────────────────────
  { id: "slice", template: "{{greeting | slice 0 5}}", data: { greeting: "Hello World" } },
  {
    id: "truncate",
    template: "{{title | truncate 5}}",
    data: { title: "Hello World" },
  },
  { id: "count", template: "{{items | count}} items", data: { items: ["a", "b", "c"] } },
  { id: "at-negative", template: "last = {{nums | at -1}}", data: { nums: [10, 20, 30] } },
  { id: "join", template: "{{tags | join \", \"}}", data: { tags: ["a", "b", "c"] } },

  // ── number pack ──────────────────────────────────────────────────────────────
  { id: "round", template: "{{ratio | round}}", data: { ratio: 3.7 } },
  { id: "to-fixed", template: "${{price | toFixed 2}}", data: { price: 3.5 } },

  // ── ternary ──────────────────────────────────────────────────────────────────
  {
    id: "ternary",
    template: '{{count > 0 ? "in stock" : "sold out"}}',
    data: { count: 5 },
  },

  // ── {{#let}} — block-scoped sequential aliases (computed once, never re-roots) ─
  {
    id: "let-bindings",
    template:
      "{{#let subtotal=(multiply price qty) tax=(multiply subtotal rate)}}{{qty}} x {{price}} = {{subtotal}}, tax {{tax}}, total {{add subtotal tax}}{{/let}}",
    data: { price: 20, qty: 3, rate: 0.1 },
  },

  // ── list literals `[…]` → a Rust array (homogeneous; rustc enforces) ──────────
  {
    id: "list-each-int",
    template: "{{#each [1, 2, 3]}}{{this}} {{/each}}",
    data: {},
  },
  {
    id: "list-each-str",
    template: '{{#each ["a", "b", "c"]}}#{{this}} {{/each}}',
    data: {},
  },
  {
    id: "list-count",
    template: "{{[1, 2, 3, 4] | count}} items",
    data: {},
  },
  {
    // S1: a list literal in OUTPUT position stringifies like a slice (join ",").
    id: "list-output",
    template: "nums: {{[1, 2, 3]}}",
    data: {},
  },

  // ── collection filters (ADR-036/037): where/reject/some/every ────────────────
  {
    id: "where-comparator",
    template: '{{#each (where items "age" "gt" 20)}}{{this.name}} {{/each}}',
    data: {
      items: [
        { name: "Ann", age: 30 },
        { name: "Bo", age: 17 },
        { name: "Cy", age: 25 },
      ],
    },
  },
  {
    id: "where-truthiness",
    template: '{{#each (where items "active")}}{{this.name}} {{/each}}',
    data: {
      items: [
        { name: "Ann", active: true },
        { name: "Bo", active: false },
      ],
    },
  },
  {
    id: "reject-truthiness",
    template: '{{#each (reject items "active")}}{{this.name}} {{/each}}',
    data: {
      items: [
        { name: "Ann", active: true },
        { name: "Bo", active: false },
      ],
    },
  },
  {
    id: "where-startswith",
    template: '{{#each (where items "name" "startsWith" "A")}}{{this.name}} {{/each}}',
    data: { items: [{ name: "Ann" }, { name: "Bo" }, { name: "Al" }] },
  },
  {
    id: "some-every",
    template:
      "{{#if (some items \"active\")}}some {{/if}}{{#if (every items \"active\")}}all{{else}}not-all{{/if}}",
    data: {
      items: [
        { active: true },
        { active: false },
      ],
    },
  },
  {
    // find → Option, unwrapped by an Option-aware {{#with}} (hit / miss) and read
    // by {{#if}} (truthiness of the Option).
    id: "find-with-hit",
    template: '{{#with (find items "name" "eq" "Bo")}}{{age}}{{else}}none{{/with}}',
    data: { items: [{ name: "Ann", age: 30 }, { name: "Bo", age: 17 }] },
  },
  {
    id: "find-with-miss",
    template: '{{#with (find items "name" "eq" "Zz")}}{{age}}{{else}}none{{/with}}',
    data: { items: [{ name: "Ann", age: 30 }, { name: "Bo", age: 17 }] },
  },
  {
    id: "find-if",
    template: '{{#if (find items "age" "gt" 99)}}has{{else}}no{{/if}}',
    data: { items: [{ name: "Ann", age: 30 }] },
  },

  // ── loop.parent / loop.root chains (Option-threaded) ─────────────────────────
  {
    id: "loop-parent",
    template:
      "{{#each row in rows}}{{#each row}}{{loop.parent.index0}}:{{this}} {{/each}}{{/each}}",
    data: { rows: [["a", "b"], ["c"]] },
  },
  {
    id: "loop-root",
    template:
      "{{#each g in groups}}{{#each g}}{{loop.root.length}}/{{this}} {{/each}}{{/each}}",
    data: { groups: [["x"], ["y", "z"]] },
  },

  // ── parent context chain ─────────────────────────────────────────────────────
  {
    id: "parent-context",
    template:
      "{{#each team in teams}}{{#each team.members}}{{parent.name}}={{this}} {{/each}}{{/each}}",
    data: {
      teams: [
        { name: "T1", members: ["a", "b"] },
        { name: "T2", members: ["c"] },
      ],
    },
  },

  // ── coalescers (?? requires the left to be Option, hence null in the data) ───
  {
    id: "coalesce",
    template: "{{nickname ?? name}}",
    data: { nickname: null, name: "Robert" },
  },
  {
    id: "first-truthy",
    template: "{{nick ?: name}}",
    data: { nick: "", name: "Robert" },
  },

  // ── partials (inline definitions, inlined at the call site) ──────────────────
  {
    id: "partial-simple",
    template: '{{#inline "greet"}}Hello {{name}}!{{/inline}}{{> greet}}',
    data: { name: "World" },
  },
  {
    id: "partial-in-each",
    template:
      '{{#inline "row"}}<li>{{name}}</li>{{/inline}}{{#each items}}{{> row}}{{/each}}',
    data: { items: [{ name: "a" }, { name: "b" }] },
  },
  {
    id: "partial-context",
    template: '{{#inline "card"}}[{{title}}]{{/inline}}{{> card section}}',
    data: { section: { title: "Intro" } },
  },

  // ── labelled loop (outer) + the pluck key-path helper ────────────────────────
  {
    id: "outer-label",
    template:
      "{{#each row in rows label outer}}{{#each row}}{{outer.index1}}:{{this}} {{/each}}{{/each}}",
    data: { rows: [["a", "b"], ["c"]] },
  },
  {
    id: "pluck",
    template: '{{items | pluck "name"}}',
    data: { items: [{ name: "a" }, { name: "b" }] },
  },

  // ── block partials + {{yield}} (body rendered in the caller frame) ───────────
  {
    id: "block-partial",
    template:
      '{{#inline "card"}}<div>{{yield}}</div>{{/inline}}{{#partial "card"}}{{name}}{{/partial}}',
    data: { name: "Ann & Bo" },
  },

  // ── sortBy (stable, literal-key closure) ─────────────────────────────────────
  {
    id: "sort-by",
    template: '{{items | sortBy "name" | pluck "name" | join ", "}}',
    data: { items: [{ name: "b" }, { name: "a" }, { name: "c" }] },
  },

  // ── groupBy → a map, iterated (group key via loop.key, group via this) ───────
  {
    id: "group-by",
    template:
      '{{#each (groupBy items "kind")}}{{loop.key}}:{{#each this}}{{name}}{{/each}} {{/each}}',
    data: {
      items: [
        { kind: "b", name: "x" },
        { kind: "a", name: "y" },
        { kind: "b", name: "z" },
      ],
    },
  },

  // ── raw blocks (verbatim body, unescaped) ────────────────────────────────────
  {
    id: "rawblock",
    template: "{{{{#raw}}}}Literal {{x}} & <b>kept</b>{{{{/raw}}}}",
    data: {},
  },

  // ── negative: dict / collection literals — still excluded ────────────────────
  {
    id: "neg-dict",
    template: '{{#with (dict "a" 1)}}{{a}}{{/with}}',
    data: {},
  },
];
