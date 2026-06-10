// The Trussbars conformance corpus. Each case is rendered by the interpreter (the
// oracle) and by the emitted Rust, and asserted byte-identical. A case the active
// emitter cannot compile would be recorded in the exclusion ledger (never silently
// dropped); the corpus currently has none — both emitters cover every case.
//
// Control flow uses the native Django-style `{% … %}` statement tags (docs/19);
// `{{ … }}` stays the output/interpolation surface. Data keys are
// Rust-identifier-safe and numbers are JSON numbers (typed `f64`).

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
    template: "{% if count >= 3 %}many ({{count}}){% else %}few{% endif %}",
    data: { count: 5 },
  },
  {
    id: "logic",
    template: "{% if a && b %}both{% else %}no{% endif %}",
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
    template: "{% if active %}on{% else %}off{% endif %}",
    data: { active: false },
  },
  {
    id: "unless",
    template: "{% unless done %}todo{% endunless %}",
    data: { done: false },
  },

  // ── case / when (multi-arm conditional, docs/12) ─────────────────────────────
  {
    id: "case-hit",
    template:
      '{% case status %}{% when "shipped" %}On its way{% when "pending" "queued" %}Waiting{% else %}Unknown{% endcase %}',
    data: { status: "queued" },
  },
  {
    id: "case-else",
    template:
      '{% case status %}{% when "shipped" %}On its way{% else %}Unknown{% endcase %}',
    data: { status: "lost" },
  },
  {
    id: "case-no-else-miss",
    template: "{% case n %}{% when 1 %}one{% when 2 %}two{% endcase %}",
    data: { n: 3 },
  },
  {
    id: "case-standalone",
    template:
      '{% case status %}\n{% when "a" %}A\n{% when "b" %}B\n{% else %}Z\n{% endcase %}\n',
    data: { status: "b" },
  },
  {
    id: "case-numeric-subject",
    template: "{% case level %}{% when 1 %}low{% when 2 3 %}mid{% else %}high{% endcase %}",
    data: { level: 3 },
  },
  {
    id: "case-nested",
    template:
      '{% case outer %}{% when "a" %}A:{% case inner %}{% when 1 %}one{% else %}other{% endcase %}{% else %}Z{% endcase %}',
    data: { outer: "a", inner: 1 },
  },

  // ── each & loop metadata ─────────────────────────────────────────────────────
  {
    id: "each-strings",
    template: "{% for tags %}#{{this}} {% endfor %}",
    data: { tags: ["x", "y", "z"] },
  },
  {
    id: "each-empty",
    template: "{% for items %}- {{this}}\n{% else %}(none){% endfor %}",
    data: { items: [] },
  },
  {
    id: "each-loopmeta",
    template:
      "{% for p in people %}{{loop.index1}}. {{p.name}}{% if loop.last %}!{% endif %} {% endfor %}",
    data: { people: [{ name: "A" }, { name: "B" }, { name: "C" }] },
  },
  {
    // Object iteration: keys in sorted order, `loop.key` bound. `maps` types the
    // field as a BTreeMap rather than a struct.
    id: "each-object",
    template: "{% for prefs %}{{loop.key}} = {{this}}\n{% endfor %}",
    data: { prefs: { en: "English", de: "German" } },
    maps: ["prefs"],
  },
  {
    id: "scope",
    template: "{% scope user %}{{name}} ({{age}}){% else %}?{% endscope %}",
    data: { user: { name: "Bo", age: 30 } },
  },
  {
    id: "nested-each-root",
    // Param name avoids the blessed-op collision (`t` is the translate operation).
    template:
      "{% for team in teams %}{{team.name}} ({{root.org}}): {% for team.members %}{{this}} {% endfor %}\n{% endfor %}",
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

  // ── {% local %} — block-scoped sequential aliases (computed once, never re-roots;
  //    the bounded binding, docs-17 — `let` is retired) ────────────────────────
  {
    id: "local-bindings",
    template:
      "{% local subtotal=(multiply price qty) tax=(multiply subtotal rate) %}{{qty}} x {{price}} = {{subtotal}}, tax {{tax}}, total {{add subtotal tax}}{% endlocal %}",
    data: { price: 20, qty: 3, rate: 0.1 },
  },

  // ── list literals `[…]` → a Rust array (homogeneous; rustc enforces) ──────────
  {
    id: "list-each-int",
    template: "{% for [1, 2, 3] %}{{this}} {% endfor %}",
    data: {},
  },
  {
    id: "list-each-str",
    template: '{% for ["a", "b", "c"] %}#{{this}} {% endfor %}',
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
    ctxFromData: true, // inference gap: filter/find element body-fields (docs/03 §Not-yet)
    template: '{% for (where items "age" "gt" 20) %}{{this.name}} {% endfor %}',
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
    ctxFromData: true, // inference gap: filter/find element body-fields (docs/03 §Not-yet)
    template: '{% for (where items "active") %}{{this.name}} {% endfor %}',
    data: {
      items: [
        { name: "Ann", active: true },
        { name: "Bo", active: false },
      ],
    },
  },
  {
    id: "reject-truthiness",
    ctxFromData: true, // inference gap: filter/find element body-fields (docs/03 §Not-yet)
    template: '{% for (reject items "active") %}{{this.name}} {% endfor %}',
    data: {
      items: [
        { name: "Ann", active: true },
        { name: "Bo", active: false },
      ],
    },
  },
  {
    id: "where-startswith",
    ctxFromData: true, // inference gap: where-key / with-into-dict re-root mis-hoist root fields (docs/03 §Not-yet)
    template: '{% for (where items "name" "startsWith" "A") %}{{this.name}} {% endfor %}',
    data: { items: [{ name: "Ann" }, { name: "Bo" }, { name: "Al" }] },
  },
  {
    id: "some-every",
    template:
      "{% if (some items \"active\") %}some {% endif %}{% if (every items \"active\") %}all{% else %}not-all{% endif %}",
    data: {
      items: [
        { active: true },
        { active: false },
      ],
    },
  },
  {
    // find → Option, unwrapped by an Option-aware {% scope %} (hit / miss) and read
    // by {% if %} (truthiness of the Option).
    id: "find-with-hit",
    ctxFromData: true, // inference gap: filter/find element body-fields (docs/03 §Not-yet)
    template: '{% scope (find items "name" "eq" "Bo") %}{{age}}{% else %}none{% endscope %}',
    data: { items: [{ name: "Ann", age: 30 }, { name: "Bo", age: 17 }] },
  },
  {
    id: "find-with-miss",
    ctxFromData: true, // inference gap: filter/find element body-fields (docs/03 §Not-yet)
    template: '{% scope (find items "name" "eq" "Zz") %}{{age}}{% else %}none{% endscope %}',
    data: { items: [{ name: "Ann", age: 30 }, { name: "Bo", age: 17 }] },
  },
  {
    id: "find-if",
    template: '{% if (find items "age" "gt" 99) %}has{% else %}no{% endif %}',
    data: { items: [{ name: "Ann", age: 30 }] },
  },

  // ── loop.parent / loop.root chains (Option-threaded) ─────────────────────────
  {
    id: "loop-parent",
    template:
      "{% for row in rows %}{% for row %}{{loop.parent.index0}}:{{this}} {% endfor %}{% endfor %}",
    data: { rows: [["a", "b"], ["c"]] },
  },
  {
    id: "loop-root",
    template:
      "{% for g in groups %}{% for g %}{{loop.root.length}}/{{this}} {% endfor %}{% endfor %}",
    data: { groups: [["x"], ["y", "z"]] },
  },

  // ── parent context chain ─────────────────────────────────────────────────────
  {
    id: "parent-context",
    template:
      "{% for team in teams %}{% for team.members %}{{parent.name}}={{this}} {% endfor %}{% endfor %}",
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
    template: '{% inline "greet" %}Hello {{name}}!{% endinline %}{% include "greet" %}',
    data: { name: "World" },
  },
  {
    id: "partial-in-each",
    template:
      '{% inline "row" %}<li>{{name}}</li>{% endinline %}{% each items %}{% include "row" %}{% endeach %}',
    data: { items: [{ name: "a" }, { name: "b" }] },
  },
  {
    id: "partial-context",
    template: '{% inline "card" %}[{{title}}]{% endinline %}{% include "card" section %}',
    data: { section: { title: "Intro" } },
  },

  // ── labelled loop (outer) + the pluck key-path helper ────────────────────────
  {
    id: "outer-label",
    template:
      "{% for row in rows label outer %}{% for row %}{{outer.index1}}:{{this}} {% endfor %}{% endfor %}",
    data: { rows: [["a", "b"], ["c"]] },
  },
  {
    id: "pluck",
    template: '{{items | pluck "name"}}',
    data: { items: [{ name: "a" }, { name: "b" }] },
  },

  // ── block partials + {% yield %} (body rendered in the caller frame) ───────────
  {
    id: "block-partial",
    template:
      '{% inline "card" %}<div>{% yield %}</div>{% endinline %}{% partial "card" %}{{name}}{% endpartial %}',
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
    ctxFromData: true, // inference gap: filter/find element body-fields (docs/03 §Not-yet)
    template:
      '{% for (groupBy items "kind") %}{{loop.key}}:{% for this %}{{name}}{% endfor %} {% endfor %}',
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
    template: "{% raw %}Literal {{x}} & <b>kept</b>{% endraw %}",
    data: {},
  },

  // ── enum context types (S4) — a unit enum renders the variant name + is truthy ─
  {
    id: "enum-render",
    template: "Status: {{status}}",
    data: { status: "Pending" },
    enums: { status: ["Active", "Pending", "Closed"] },
  },
  {
    id: "enum-truthy",
    template: "{% if status %}set{% else %}unset{% endif %}: {{status}}",
    data: { status: "Active" },
    enums: { status: ["Active", "Pending"] },
  },

  // ── hardening edges ──────────────────────────────────────────────────────────
  {
    // escaping-heavy: repeated escapable characters in one value.
    id: "escape-heavy",
    template: "{{s}}",
    data: { s: "a & b < c > d \" e ' f & g < h" },
  },
  {
    // deep nesting: each → if → nested each, with a deep path and a `root` reach.
    id: "deep-nesting",
    template:
      "{% for row in rows %}{% if row.on %}[{{row.meta.lbl}}/{{root.tag}}:{% for n in row.ns %}{{n}}{% endfor %}]{% endif %}{% endfor %}",
    data: {
      tag: "T",
      rows: [
        { on: true, meta: { lbl: "a" }, ns: [1, 2] },
        { on: false, meta: { lbl: "b" }, ns: [3] },
        { on: true, meta: { lbl: "c" }, ns: [] },
      ],
    },
  },

  // ── standalone-line whitespace (the Handlebars/MaxBars trim rule) ────────────
  // A block open/close alone on its line leaves no blank line; an interpolation
  // never trims. These pin the v2 lexer's `trim_standalone` against v1 (and the
  // oracle) byte-for-byte — the rule the example apps' multi-line templates need.
  {
    id: "standalone-each",
    template: "items:\n{% for xs %}\n- {{this}}\n{% endfor %}\ndone\n",
    data: { xs: ["a", "b"] },
  },
  {
    id: "standalone-if-else",
    template: "a\n{% if on %}\nyes\n{% else %}\nno\n{% endif %}\nb\n",
    data: { on: false },
  },
  {
    id: "standalone-indented",
    template: "<ul>\n  {% for xs %}\n  <li>{{this}}</li>\n  {% endfor %}\n</ul>\n",
    data: { xs: ["x"] },
  },
  {
    id: "standalone-not-when-inline",
    template: "{% for xs %}{{this}} {% endfor %}\n",
    data: { xs: ["a", "b"] },
  },

  // ── dict literals → synthesized records ──────────────────────────────────────
  // A dict literal `{k: v}` (or the `(dict "k" v)` call form) compiles to a typed,
  // block-local generic struct (both emitters synthesize it; the oracle renders it
  // from a dynamic map). Field types are inferred at instantiation.
  {
    id: "dict-with-literal",
    ctxFromData: true, // inference gap: where-key / with-into-dict re-root mis-hoist root fields (docs/03 §Not-yet)
    template: "{% scope {name: \"Ann\", age: 30} %}{{name}} is {{age}}{% endscope %}",
    data: {},
  },
  {
    id: "dict-call-form",
    ctxFromData: true, // inference gap: where-key / with-into-dict re-root mis-hoist root fields (docs/03 §Not-yet)
    template: '{% scope (dict "a" 1) %}{{a}}{% endscope %}',
    data: {},
  },
  {
    id: "dict-local-literal",
    ctxFromData: true, // inference gap: with-into-dict re-root mis-hoists root fields (docs/03 §Not-yet)
    template: "{% local cfg={theme: \"dark\", size: 12} %}{{cfg.theme}}/{{cfg.size}}{% endlocal %}",
    data: {},
  },
  {
    id: "dict-path-value",
    ctxFromData: true, // inference gap: where-key / with-into-dict re-root mis-hoist root fields (docs/03 §Not-yet)
    template: "{% scope {who: name} %}hi {{who}}{% endscope %}",
    data: { name: "Zed" },
  },
  {
    id: "dict-nested",
    ctxFromData: true, // inference gap: where-key / with-into-dict re-root mis-hoist root fields (docs/03 §Not-yet)
    template: "{% scope {a: {b: 1}} %}{{a.b}}{% endscope %}",
    data: {},
  },
];
