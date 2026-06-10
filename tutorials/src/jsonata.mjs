// SPDX-License-Identifier: Apache-2.0
//
// The "Data shaping" guide content — ONE source for the page (TryJsonata cells)
// and the gate (scripts/check-jsonata.mjs). Every cell carries its `expect`, the
// value the vendored engine (lab/vendor/jsonata.mjs) must return for {expr,data};
// the gate asserts it, so a snippet can never silently drift from what the Lab
// runs. Each section declares the JSONata `functions` it teaches; the gate
// asserts every `$fn` used anywhere on the page is taught here, and that every
// declared function is actually demonstrated (no over-claiming).
//
// JSONata reshapes raw input into the exact view-model a logic-less template
// renders — the "logic" the surfaces deliberately exclude lives here, upstream
// of the template, as plain data.

const cart = { items: [{ name: "Pen", price: 3 }, { name: "Ink", price: 9 }, { name: "Pad", price: 5 }] };

export const sections = [
  {
    id: "basics",
    title: "The basics — paths, filters, shaping",
    lead:
      "JSONata is an expression language over JSON. A bare path navigates; square " +
      "brackets filter; a dot-paren maps; braces build a new object. These four moves " +
      "cover most data shaping before you reach for a single function.",
    functions: [],
    cells: [
      { id: "paths", label: "Navigate with a path", note: "Dotted paths walk into objects; arrays flatten automatically.",
        data: { order: { customer: { name: "Ada", tier: "gold" } } }, expr: "order.customer.name", expect: "Ada" },
      { id: "filter", label: "Filter with a predicate", note: "[ … ] keeps only the items matching a boolean expression.",
        data: cart, expr: "items[price >= 5].name", expect: ["Ink", "Pad"] },
      { id: "map", label: "Map with dot-paren", note: ".( … ) evaluates an expression per item; & concatenates strings.",
        data: cart, expr: 'items.(name & ": " & price)', expect: ["Pen: 3", "Ink: 9", "Pad: 5"] },
      { id: "construct", label: "Build a new object", note: "{ } constructs a view-model — exactly the shape your template wants.",
        data: cart, expr: `{
  "count": $count(items),
  "total": $sum(items.price)
}`, expect: { count: 3, total: 17 } },
      { id: "ternary", label: "Choose with ? :", note: "The ternary computes a branch up front, so the template stays logic-less.",
        data: { user: { name: "Ada", admin: true } }, expr: 'user.admin ? "admin" : "member"', expect: "admin" },
      { id: "chain", label: "Pipe with ~>", note: "x ~> $f() feeds x as the first argument of $f — read left to right.",
        data: cart, expr: "items.price ~> $sum() ~> $round(1)", expect: 17 },
    ],
  },
  {
    id: "strings",
    title: "Strings",
    lead: "Format and recombine text for the view.",
    functions: ["$uppercase", "$substring", "$join", "$split", "$replace"],
    cells: [
      { id: "upper", label: "$uppercase", note: "Also $lowercase. Case-fold for display.",
        data: { first: "ada" }, expr: "$uppercase(first)", expect: "ADA" },
      { id: "substr", label: "$substring", note: "$substring(str, start, length) — here, build initials.",
        data: { first: "ada", last: "Lovelace" }, expr: "$uppercase($substring(first,0,1)) & $substring(last,0,1)", expect: "AL" },
      { id: "join", label: "$join", note: "Collapse an array of strings into one with a separator.",
        data: { tags: ["b", "a", "c"] }, expr: '$join(tags, ", ")', expect: "b, a, c" },
      { id: "split", label: "$split", note: "The inverse of $join — string to array.",
        data: {}, expr: '$split("a-b-c", "-")', expect: ["a", "b", "c"] },
      { id: "replace", label: "$replace (with regex)", note: "A /…/ literal replaces by pattern; here, redact a date.",
        data: { line: "2024-01-01 ERROR disk full" }, expr: `$replace(line, /\\d{4}-\\d{2}-\\d{2}/,
  "<date>")`, expect: "<date> ERROR disk full" },
    ],
  },
  {
    id: "numbers",
    title: "Numbers & aggregation",
    lead: "Roll a list of numbers up into the totals a summary needs.",
    functions: ["$round", "$sum", "$average", "$min", "$max"],
    cells: [
      { id: "sum", label: "$sum", note: "Aggregate a numeric path in one call.",
        data: cart, expr: "$sum(items.price)", expect: 17 },
      { id: "round", label: "$round", note: "$round(x, places) — half-to-even.",
        data: {}, expr: "$round(2.345, 2)", expect: 2.34 },
      { id: "avg", label: "$average", note: "Wrap in $round so the view shows a tidy number.",
        data: cart, expr: "$round($average(items.price), 2)", expect: 5.67 },
      { id: "minmax", label: "$min / $max", note: "Bounds for a range label.",
        data: cart, expr: `{
  "lo": $min(items.price),
  "hi": $max(items.price)
}`, expect: { lo: 3, hi: 9 } },
    ],
  },
  {
    id: "arrays",
    title: "Arrays",
    lead: "Order, de-duplicate, and count before the template iterates.",
    functions: ["$sort", "$distinct", "$reverse", "$count"],
    cells: [
      { id: "sort", label: "$sort", note: "Pass a comparator function($a,$b){…} for a custom order.",
        data: { nums: [3, 1, 2, 3] }, expr: "$sort(nums, function($a, $b) { $a > $b })", expect: [1, 2, 3, 3] },
      { id: "distinct", label: "$distinct", note: "Drop duplicates, keeping first-seen order.",
        data: { tags: ["b", "a", "b", "c"] }, expr: "$distinct(tags)", expect: ["b", "a", "c"] },
      { id: "reverse", label: "$reverse", note: "Flip order — newest-first lists, etc.",
        data: { tags: ["b", "a", "c"] }, expr: "$reverse(tags)", expect: ["c", "a", "b"] },
      { id: "count", label: "$count", note: "Length of an array — for badges and 'N items'.",
        data: cart, expr: "$count(items)", expect: 3 },
    ],
  },
  {
    id: "objects",
    title: "Objects",
    lead: "Read keys dynamically and combine fragments.",
    functions: ["$lookup", "$keys", "$merge"],
    cells: [
      { id: "lookup", label: "$lookup", note: "Read a property by a computed key — a lookup table.",
        data: { titles: { feat: "Features", fix: "Fixes" }, key: "fix" }, expr: "$lookup(titles, key)", expect: "Fixes" },
      { id: "keys", label: "$keys", note: "The property names of an object, as an array.",
        data: { order: { customer: { name: "Ada", tier: "gold" } } }, expr: "$keys(order.customer)", expect: ["name", "tier"] },
      { id: "merge", label: "$merge", note: "Combine an array of objects into one (later wins).",
        data: {}, expr: '$merge([{ "a": 1 }, { "b": 2 }])', expect: { a: 1, b: 2 } },
    ],
  },
  {
    id: "booleans",
    title: "Booleans & tests",
    lead: "Precompute flags the template can branch on with a plain {% if %}.",
    functions: ["$exists", "$not", "$contains"],
    cells: [
      { id: "exists", label: "$exists", note: "True when a path resolves to anything — guard optional fields.",
        data: { user: { name: "Ada", admin: true } }, expr: "$exists(user.email)", expect: false },
      { id: "not", label: "$not", note: "Boolean negation.",
        data: { user: { name: "Ada", admin: true } }, expr: "$not(user.admin)", expect: false },
      { id: "contains", label: "$contains (with regex)", note: "Membership test; a /…/ literal makes it a pattern match.",
        data: { line: "2024-01-01 ERROR disk full" }, expr: "$contains(line, /ERROR|WARN/)", expect: true },
    ],
  },
  {
    id: "datetime",
    title: "Date & time",
    lead:
      "Convert between epoch milliseconds and ISO/formatted strings. (Avoid $now() in " +
      "fixed examples — it isn’t reproducible; pass the instant in as data.)",
    functions: ["$fromMillis", "$toMillis"],
    cells: [
      { id: "fromMillis", label: "$fromMillis", note: "Format epoch ms with a picture string.",
        data: { ms: 1704067200000 }, expr: '$fromMillis(ms, "[Y0001]-[M01]-[D01]")', expect: "2024-01-01" },
      { id: "toMillis", label: "$toMillis", note: "Parse an ISO 8601 string back to epoch ms.",
        data: {}, expr: '$toMillis("2024-01-01T00:00:00.000Z")', expect: 1704067200000 },
    ],
  },
  {
    id: "regex",
    title: "Regular expressions",
    lead: "A /…/ literal is a first-class value — extract structure from raw text.",
    functions: ["$match"],
    cells: [
      { id: "match", label: "$match", note: "Returns match objects; .match maps to the matched strings.",
        data: { line: "2024-01-01 ERROR disk full" }, expr: "$match(line, /[A-Z]+/).match", expect: "ERROR" },
    ],
  },
  {
    id: "higher-order",
    title: "Higher-order functions",
    lead:
      "Pass functions as arguments. $map / $filter / $reduce take a lambda " +
      "function($x){…} and are the general form behind the path shorthands above.",
    functions: ["$map", "$filter", "$reduce"],
    cells: [
      { id: "hofMap", label: "$map", note: "Transform each element with a lambda.",
        data: cart, expr: "$map(items, function($i) { $i.name })", expect: ["Pen", "Ink", "Pad"] },
      { id: "hofFilter", label: "$filter", note: "Keep elements a lambda returns true for.",
        data: { people: [{ n: "Ada", age: 36 }, { n: "Lin", age: 41 }, { n: "Bo", age: 29 }] },
        expr: `$filter(people,
  function($p) { $p.age >= 35 }
).n`, expect: ["Ada", "Lin"] },
      { id: "hofReduce", label: "$reduce", note: "Fold a list to a single value with an accumulator.",
        data: cart, expr: `$reduce(items.price,
  function($acc, $v) { $acc + $v },
  0
)`, expect: 17 },
    ],
  },
];

// The flagship: a flat commit list → a grouped, ordered changelog view-model
// (JSONata), rendered to Markdown by a logic-less MaxBars template. The template
// has zero branching — all the shaping is upstream, in the transform.
export const flagship = {
  engine: "maxbars",
  data: {
    project: "flatbars",
    version: "0.2.0",
    commits: [
      { type: "feat", scope: "lab", desc: "live transform pane" },
      { type: "fix", scope: "parser", desc: "trim standalone comments" },
      { type: "feat", scope: "cli", desc: "emit-jsonata scaffold" },
      { type: "chore", scope: "deps", desc: "bump esbuild" },
    ],
  },
  transform: `(
  $titles := {
    "feat": "Features",
    "fix": "Fixes",
    "chore": "Chores"
  };
  $order := ["feat", "fix", "chore"];
  {
    "project": project,
    "version": version,
    "sections": $order.($t := $; {
      "title": $lookup($titles, $t),
      "items": [
        $$.commits[type = $t]
          .(scope & ": " & desc)
      ]
    })[$count(items) > 0]
  }
)`,
  template: `# {{project}} {{version}}
{% for sections %}
## {{title}}
{% for items %}- {{this}}
{% endfor %}
{% endfor %}`,
  expect: "# flatbars 0.2.0\n## Features\n- lab: live transform pane\n- cli: emit-jsonata scaffold\n## Fixes\n- parser: trim standalone comments\n## Chores\n- deps: bump esbuild\n",
};

// Every JSONata function the guide teaches (union of the section declarations) —
// the contract the gate enforces against what the cells actually use.
export const taughtFunctions = [...new Set(sections.flatMap((s) => s.functions))];
