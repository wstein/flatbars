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
      "{{#each people as |p i|}}{{loop.index1}}. {{p.name}}{{#if loop.last}}!{{/if}} {{/each}}",
    data: { people: [{ name: "A" }, { name: "B" }, { name: "C" }] },
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
      "{{#each teams as |team|}}{{team.name}} ({{root.org}}): {{#each team.members}}{{this}} {{/each}}\n{{/each}}",
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

  // ── negative: outside the slice (oracle renders; emitter excludes) ───────────
  {
    id: "neg-coalesce",
    template: "{{nickname ?? name}}",
    data: { nickname: "Bo", name: "Robert" },
  },
];
