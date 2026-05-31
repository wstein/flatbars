// SPDX-License-Identifier: Apache-2.0
//
// The conformance corpus: core-syntax templates + data exercising every
// construct the v0 compiler supports and — deliberately — the FullBars
// divergences (content-based VSafe truthiness, explicit escaping, sorted object
// iteration, @../ parent-data, includeZero). Each case is rendered by both the
// interpreter and the compiled function; the harness asserts byte-identical
// output. Keep cases within v0-supported constructs (no partials / exotic
// blocks yet).

export const cases = [
  // ── text & output ──────────────────────────────────────────────────────────
  { name: "text-only", t: "hello world", d: null },
  { name: "raw-output", t: "{{{lookup this \"x\"}}}", d: { x: "<b>&\"'" } },
  { name: "esc_html", t: "{{{esc_html (lookup this \"x\")}}}", d: { x: "<b>&\"'" } },
  { name: "safe-passthrough", t: "{{{safe (lookup this \"x\")}}}", d: { x: "<i>" } },
  { name: "esc-idempotent-on-safe", t: "{{{esc_html (safe (lookup this \"x\"))}}}", d: { x: "<i>" } },

  // ── literals & stringify ────────────────────────────────────────────────────
  { name: "number-int", t: "{{{lookup this \"n\"}}}", d: { n: 3 } },
  { name: "number-frac", t: "{{{lookup this \"n\"}}}", d: { n: 1.5 } },
  { name: "bool-true", t: "{{{lookup this \"b\"}}}", d: { b: true } },
  { name: "null-empty", t: "[{{{lookup this \"z\"}}}]", d: { z: null } },
  { name: "array-join", t: "{{{lookup this \"xs\"}}}", d: { xs: ["a", "b", "c"] } },
  { name: "string-literal-arg", t: "{{{esc_html \"a<b\"}}}", d: null },

  // ── lookup ──────────────────────────────────────────────────────────────────
  { name: "lookup-nested", t: "{{{lookup this \"u\" \"city\"}}}", d: { u: { city: "Lübeck" } } },
  { name: "lookup-miss", t: "[{{{lookup this \"u\" \"nope\"}}}]", d: { u: {} } },
  { name: "lookup-array-index", t: "{{{lookup this \"xs\" 1}}}", d: { xs: ["a", "b"] } },

  // ── if / unless / elif ──────────────────────────────────────────────────────
  { name: "if-true", t: "{{#if (lookup this \"a\")}}Y{{/if}}", d: { a: true } },
  { name: "if-false-empty", t: "[{{#if (lookup this \"a\")}}Y{{/if}}]", d: { a: false } },
  { name: "if-else", t: "{{#if (lookup this \"a\")}}Y{{else}}N{{/if}}", d: { a: false } },
  { name: "elif-mid", t: "{{#if (lookup this \"a\")}}A{{elif (lookup this \"b\")}}B{{else}}C{{/if}}", d: { a: false, b: true } },
  { name: "elif-else", t: "{{#if (lookup this \"a\")}}A{{elif (lookup this \"b\")}}B{{else}}C{{/if}}", d: { a: false, b: false } },
  { name: "unless", t: "{{#unless (lookup this \"a\")}}N{{/unless}}", d: { a: false } },
  { name: "if-zero-falsy", t: "{{#if (lookup this \"n\")}}y{{else}}n{{/if}}", d: { n: 0 } },
  { name: "if-includeZero", t: "{{#if (lookup this \"n\") (dict \"includeZero\" true)}}y{{else}}n{{/if}}", d: { n: 0 } },
  { name: "if-empty-array-falsy", t: "{{#if (lookup this \"xs\")}}y{{else}}n{{/if}}", d: { xs: [] } },
  { name: "if-empty-object-truthy", t: "{{#if (lookup this \"o\")}}y{{else}}n{{/if}}", d: { o: {} } },
  { name: "if-safe-empty-falsy", t: "{{#if (safe (lookup this \"s\"))}}y{{else}}n{{/if}}", d: { s: "" } },

  // ── each ────────────────────────────────────────────────────────────────────
  { name: "each-array", t: "{{#each (lookup this \"xs\")}}[{{{this}}}={{{index}}}]{{/each}}", d: { xs: ["a", "b"] } },
  { name: "each-first-last", t: "{{#each (lookup this \"xs\")}}{{#if first}}<{{/if}}{{{this}}}{{#if last}}>{{/if}}{{/each}}", d: { xs: ["x", "y"] } },
  { name: "each-empty-else", t: "{{#each (lookup this \"xs\")}}x{{else}}empty{{/each}}", d: { xs: [] } },
  { name: "each-object-sorted", t: "{{#each (lookup this \"o\")}}{{{key}}}={{{this}}};{{/each}}", d: { o: { b: 2, a: 1, c: 3 } } },
  { name: "each-object-index", t: "{{#each (lookup this \"o\")}}{{{index}}}:{{{key}}};{{/each}}", d: { o: { z: 1, a: 2 } } },
  { name: "each-parent-index", t: "{{#each (lookup this \"rows\")}}{{#each this}}[{{{parent-index}}}-{{{index}}}]{{/each}}{{/each}}", d: { rows: [["a", "b"], ["c"]] } },

  // ── with ────────────────────────────────────────────────────────────────────
  { name: "with", t: "{{#with (lookup this \"u\")}}{{{lookup this \"name\"}}}{{/with}}", d: { u: { name: "Ada" } } },
  { name: "with-falsy-else", t: "{{#with (lookup this \"u\")}}x{{else}}none{{/with}}", d: { u: null } },

  // ── value helpers (via the runtime registry) ────────────────────────────────
  { name: "eq-true", t: "{{{eq (lookup this \"a\") (lookup this \"b\")}}}", d: { a: 1, b: 1 } },
  { name: "ne", t: "{{{ne (lookup this \"a\") (lookup this \"b\")}}}", d: { a: 1, b: 2 } },
  { name: "lt-gt", t: "{{{lt 1 2}}}{{{gt 1 2}}}", d: null },
  { name: "and-or-not", t: "{{{and true true}}}{{{or false false}}}{{{not false}}}", d: null },
  { name: "json-pretty", t: "{{{json (lookup this \"o\") (dict \"pretty\" true)}}}", d: { o: { a: 1 } } },

  // ── nesting & escaping interplay ────────────────────────────────────────────
  { name: "nested-if-each", t: "<ul>{{#each (lookup this \"xs\")}}{{#if this}}<li>{{{esc_html this}}}</li>{{/if}}{{/each}}</ul>", d: { xs: ["a", "", "b"] } },
  { name: "auto-escape-each", t: "{{#each (lookup this \"xs\")}}{{{esc_html this}}} {{/each}}", d: { xs: ["<x>", "a&b"] } },
];
