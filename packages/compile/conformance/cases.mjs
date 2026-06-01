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

  // ── SURFACE dialect (desugars to core, then compiles) ───────────────────────
  { name: "s:bare-path", dialect: "surface", t: "Hello {{ name }}!", d: { name: "Ada" } },
  { name: "s:auto-escape", dialect: "surface", t: "{{ html }}", d: { html: "<b>&\"" } },
  { name: "s:raw", dialect: "surface", t: "{{{ html }}}", d: { html: "<b>" } },
  { name: "s:dotted-path", dialect: "surface", t: "{{ user.name }}", d: { user: { name: "Ada" } } },
  { name: "s:bracket-path", dialect: "surface", t: "{{ a.[home town] }}", d: { a: { "home town": "Lübeck" } } },
  { name: "s:if-else", dialect: "surface", t: "{{#if admin}}A{{else}}U{{/if}}", d: { admin: false } },
  { name: "s:else-if", dialect: "surface", t: "{{#if a}}A{{else if b}}B{{else}}C{{/if}}", d: { a: false, b: true } },
  { name: "s:each-this", dialect: "surface", t: "{{#each items}}[{{ this }}]{{/each}}", d: { items: ["x", "y"] } },
  { name: "s:each-blockparams", dialect: "surface", t: "{{#each items as |item i|}}{{ i }}:{{ item }};{{/each}}", d: { items: ["a", "b"] } },
  { name: "s:each-object-blockparams", dialect: "surface", t: "{{#each o as |v k|}}{{ k }}={{ v }};{{/each}}", d: { o: { b: 2, a: 1 } } },
  { name: "s:with-blockparam", dialect: "surface", t: "{{#with user as |u|}}{{ u.name }}{{/with}}", d: { user: { name: "Ada" } } },
  { name: "s:at-index", dialect: "surface", t: "{{#each xs}}{{@index}}:{{ this }};{{/each}}", d: { xs: ["a", "b"] } },
  { name: "s:at-first-last", dialect: "surface", t: "{{#each xs}}{{#if @first}}<{{/if}}{{ this }}{{#if @last}}>{{/if}}{{/each}}", d: { xs: ["x", "y"] } },
  { name: "s:at-parent-index", dialect: "surface", t: "{{#each rows}}{{#each this}}[{{@../index}}-{{@index}}]{{/each}}{{/each}}", d: { rows: [["a", "b"], ["c"]] } },
  { name: "s:at-root", dialect: "surface", t: "{{#each xs}}{{@root.title}};{{/each}}", d: { title: "T", xs: ["a"] } },
  { name: "s:hash-includeZero", dialect: "surface", t: "{{#if n includeZero=true}}y{{else}}n{{/if}}", d: { n: 0 } },
  { name: "s:helper-call", dialect: "surface", t: "{{#if (eq a b)}}eq{{else}}ne{{/if}}", d: { a: 1, b: 1 } },
  { name: "s:parent-path", dialect: "surface", t: "{{#each xs}}{{ ../title }}:{{ this }};{{/each}}", d: { title: "T", xs: ["a", "b"] } },

  // ── partials (inline-defined, self-contained) ───────────────────────────────
  { name: "p:inline-each", dialect: "surface", t: "{{#inline \"row\"}}[{{ this }}]{{/inline}}{{#each items}}{{> row}}{{/each}}", d: { items: ["a", "b"] } },
  { name: "p:inline-ctx", dialect: "surface", t: "{{#inline \"greet\"}}Hi {{ name }}!{{/inline}}{{> greet user}}", d: { user: { name: "Ada" } } },
  { name: "p:inline-hash", dialect: "surface", t: "{{#inline \"tag\"}}<{{ kind }}>{{/inline}}{{> tag this kind=\"b\"}}", d: {} },
  { name: "p:inline-nested", dialect: "surface", t: "{{#inline \"a\"}}A{{> b}}{{/inline}}{{#inline \"b\"}}B{{/inline}}{{> a}}", d: {} },

  // ── @truthiness modes (compiled per-mode codegen vs interpreter) ─────────────
  { name: "t:default-zero-falsy", dialect: "surface", t: "{{#if n}}y{{else}}m{{/if}}", d: { n: 0 } },
  { name: "t:minimal-zero-truthy", dialect: "surface", t: "{{! @truthiness:minimal }}{{#if n}}y{{else}}m{{/if}}", d: { n: 0 } },
  { name: "t:minimal-empty-string", dialect: "surface", t: "{{! @truthiness:minimal }}{{#if s}}y{{else}}m{{/if}}", d: { s: "" } },
  { name: "t:presence-empty-array", dialect: "surface", t: "{{! @truthiness:presence }}{{#if xs}}y{{else}}m{{/if}}", d: { xs: [] } },
  { name: "t:presence-empty-object", dialect: "surface", t: "{{! @truthiness:presence }}{{#if o}}y{{else}}m{{/if}}", d: { o: {} } },
  { name: "t:always-false-truthy", dialect: "surface", t: "{{! @truthiness:always }}{{#if b}}y{{else}}m{{/if}}", d: { b: false } },
  { name: "t:explicit-list", dialect: "surface", t: "{{! @truthiness: false null }}{{#if n}}y{{else}}m{{/if}}", d: { n: 0 } },
  { name: "t:and-retuned", dialect: "surface", t: "{{! @truthiness:minimal }}{{{ and 0 5 }}}", d: null },
  { name: "t:not-retuned", dialect: "surface", t: "{{! @truthiness:minimal }}{{{ not 0 }}}", d: null },
  { name: "t:includeZero-compose", dialect: "surface", t: "{{! @truthiness:empty }}{{#if n includeZero=true}}y{{else}}m{{/if}}", d: { n: 0 } },
  { name: "t:with-empty-array-minimal", dialect: "surface", t: "{{! @truthiness:minimal }}{{#with xs}}has{{else}}none{{/with}}", d: { xs: [] } },
  { name: "t:core-minimal", dialect: "core", t: "{{! @truthiness:minimal }}{{#if (lookup this \"n\")}}y{{else}}m{{/if}}", d: { n: 0 } },
  { name: "t:each-body-inherits-mode", dialect: "surface", t: "{{! @truthiness:minimal }}{{#each xs}}{{#if this}}t{{else}}f{{/if}}{{/each}}", d: { xs: [0, 1] } },

  // ── MaxBars: infix operators, pipes, bare loop variables ─────────────────────
  { name: "mx:and", dialect: "maxbars", t: "{{ a && b }}", d: { a: true, b: false } },
  { name: "mx:or", dialect: "maxbars", t: "{{ a || b }}", d: { a: false, b: true } },
  { name: "mx:not", dialect: "maxbars", t: "{{ !a }}", d: { a: false } },
  { name: "mx:cmp-gt", dialect: "maxbars", t: "{{ x > 3 }}", d: { x: 5 } },
  { name: "mx:cmp-gte", dialect: "maxbars", t: "{{ x >= 18 }}", d: { x: 18 } },
  { name: "mx:cmp-eq", dialect: "maxbars", t: "{{ x == 1 }}", d: { x: 1 } },
  { name: "mx:cmp-ne", dialect: "maxbars", t: "{{ x != 1 }}", d: { x: 2 } },
  { name: "mx:precedence", dialect: "maxbars", t: "{{ x > 0 && x < 10 }}", d: { x: 5 } },
  { name: "mx:pipe", dialect: "maxbars", t: "{{{ o | json }}}", d: { o: { a: 1 } } },
  { name: "mx:pipe-arg", dialect: "maxbars", t: "{{{ xs | lookup 0 }}}", d: { xs: ["a", "b"] } },
  { name: "mx:pipe-chain", dialect: "maxbars", t: "{{{ n | not | not }}}", d: { n: 0 } },
  { name: "mx:if-paren-infix", dialect: "maxbars", t: "{{#if (a && b)}}Y{{else}}N{{/if}}", d: { a: true, b: false } },
  { name: "mx:if-bare-infix", dialect: "maxbars", t: "{{#if a && b}}Y{{else}}N{{/if}}", d: { a: true, b: false } },
  { name: "mx:if-bare-cmp", dialect: "maxbars", t: "{{#if x >= 18}}adult{{else}}minor{{/if}}", d: { x: 21 } },
  { name: "mx:unless-bare-infix", dialect: "maxbars", t: "{{#unless a || b}}none{{/unless}}", d: { a: false, b: false } },
  { name: "mx:if-bare-precedence", dialect: "maxbars", t: "{{#if x > 0 && x < 10}}in{{else}}out{{/if}}", d: { x: 5 } },
  // bare loop variables (the canonical set + aliases).
  { name: "mx:loopvars", dialect: "maxbars", t: "{{#each xs}}[{{index0}}/{{index1}}/{{rindex0}}/{{rindex1}}/{{length}}]{{/each}}", d: { xs: ["a", "b", "c"] } },
  { name: "mx:loopvar-aliases", dialect: "maxbars", t: "{{#each xs}}{{index}}{{rindex}}{{size}}{{/each}}", d: { xs: ["a", "b", "c"] } },
  { name: "mx:loopvar-first-last", dialect: "maxbars", t: "{{#each xs}}{{#if first}}<{{/if}}{{this}}{{#if last}}>{{/if}}{{/each}}", d: { xs: ["a", "b"] } },
  { name: "mx:loopvar-key", dialect: "maxbars", t: "{{#each o}}{{key}}={{this}};{{/each}}", d: { o: { x: 1, y: 2 } } },
  // a dotted path is still a path (not a loop var) in MaxBars.
  { name: "mx:path-still-works", dialect: "maxbars", t: "{{ user.name }}", d: { user: { name: "Ada" } } },
];
