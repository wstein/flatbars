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
  { name: "escapeHtml", t: "{{{escapeHtml (lookup this \"x\")}}}", d: { x: "<b>&\"'" } },
  { name: "safe-passthrough", t: "{{{safe (lookup this \"x\")}}}", d: { x: "<i>" } },
  { name: "esc-idempotent-on-safe", t: "{{{escapeHtml (safe (lookup this \"x\"))}}}", d: { x: "<i>" } },

  // ── literals & stringify ────────────────────────────────────────────────────
  { name: "number-int", t: "{{{lookup this \"n\"}}}", d: { n: 3 } },
  { name: "number-frac", t: "{{{lookup this \"n\"}}}", d: { n: 1.5 } },
  { name: "bool-true", t: "{{{lookup this \"b\"}}}", d: { b: true } },
  { name: "null-empty", t: "[{{{lookup this \"z\"}}}]", d: { z: null } },
  { name: "array-join", t: "{{{lookup this \"xs\"}}}", d: { xs: ["a", "b", "c"] } },
  { name: "string-literal-arg", t: "{{{escapeHtml \"a<b\"}}}", d: null },

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
  { name: "each-array-key-null", t: "{{#each (lookup this \"xs\")}}[{{{key}}}]{{/each}}", d: { xs: ["a", "b"] } },
  { name: "each-object-sorted", t: "{{#each (lookup this \"o\")}}{{{key}}}={{{this}}};{{/each}}", d: { o: { b: 2, a: 1, c: 3 } } },
  { name: "each-object-index", t: "{{#each (lookup this \"o\")}}{{{index}}}:{{{key}}};{{/each}}", d: { o: { z: 1, a: 2 } } },
  { name: "each-parent-index", t: "{{#each (lookup this \"rows\")}}{{#each this}}[{{{lookup loop \"parent\" \"index0\"}}}-{{{index}}}]{{/each}}{{/each}}", d: { rows: [["a", "b"], ["c"]] } },
  // the `loop` object (ADR-021) reached as a core operation: current metadata, the
  // enclosing loop via loop.parent (chainable), and the outermost via loop.root.
  { name: "loop-chain", t: "{{#each (lookup this \"rows\")}}{{#each this}}[{{{lookup loop \"index0\"}}}@{{{lookup (lookup loop \"parent\") \"index0\"}}}]{{/each}}{{/each}}", d: { rows: [["a", "b"], ["c"]] } },
  { name: "loop-root", t: "{{#each (lookup this \"rows\")}}{{#each this}}{{{lookup (lookup loop \"root\") \"length\"}}} {{/each}}{{/each}}", d: { rows: [["a", "b"], ["c"]] } },
  { name: "loop-this-key", t: "{{#each (lookup this \"o\")}}{{{lookup loop \"key\"}}}={{{lookup loop \"this\"}}};{{/each}}", d: { o: { b: 2, a: 1 } } },

  // ── apply (dynamic block dispatch; compiled via rt.block) ────────────────────
  { name: "apply-each", t: "{{#apply \"each\" (lookup this \"xs\")}}[{{{this}}}]{{/apply}}", d: { xs: ["a", "b"] } },
  { name: "apply-each-else", t: "{{#apply \"each\" (lookup this \"xs\")}}x{{else}}none{{/apply}}", d: { xs: [] } },
  { name: "apply-if-true", t: "{{#apply \"if\" (lookup this \"c\")}}Y{{else}}N{{/apply}}", d: { c: true } },
  { name: "apply-if-false", t: "{{#apply \"if\" (lookup this \"c\")}}Y{{else}}N{{/apply}}", d: { c: false } },
  { name: "apply-unless", t: "{{#apply \"unless\" (lookup this \"c\")}}N{{/apply}}", d: { c: false } },
  { name: "apply-with", t: "{{#apply \"with\" (lookup this \"o\")}}{{{lookup this \"k\"}}}{{/apply}}", d: { o: { k: "v" } } },
  { name: "apply-inline-helper", t: "{{#apply \"escapeHtml\" (lookup this \"x\")}}ignored{{/apply}}", d: { x: "<b>" } },

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
  { name: "nested-if-each", t: "<ul>{{#each (lookup this \"xs\")}}{{#if this}}<li>{{{escapeHtml this}}}</li>{{/if}}{{/each}}</ul>", d: { xs: ["a", "", "b"] } },
  { name: "auto-escape-each", t: "{{#each (lookup this \"xs\")}}{{{escapeHtml this}}} {{/each}}", d: { xs: ["<x>", "a&b"] } },

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

  // ── partials (inline-defined, self-contained; the {{#*inline}} decorator) ────
  { name: "p:inline-each", dialect: "surface", t: "{{#*inline \"row\"}}[{{ this }}]{{/inline}}{{#each items}}{{> row}}{{/each}}", d: { items: ["a", "b"] } },
  { name: "p:inline-ctx", dialect: "surface", t: "{{#*inline \"greet\"}}Hi {{ name }}!{{/inline}}{{> greet user}}", d: { user: { name: "Ada" } } },
  { name: "p:inline-hash", dialect: "surface", t: "{{#*inline \"tag\"}}<{{ kind }}>{{/inline}}{{> tag this kind=\"b\"}}", d: {} },
  { name: "p:inline-nested", dialect: "surface", t: "{{#*inline \"a\"}}A{{> b}}{{/inline}}{{#*inline \"b\"}}B{{/inline}}{{> a}}", d: {} },
  // ── block partials + body-yield (the rt-stack: a {{#>name}}/{{#partial}} block
  //     threads its body so {{> @partial-block}} / {{yield}} inside the partial
  //     renders it — must match the interpreter's pushed frame, Prelude.partialH) ─
  // FullBars: the {{#>name}} sigil + the {{> @partial-block}} body reference.
  { name: "p:block-yield", dialect: "surface", t: "{{#*inline \"layout\"}}[{{> @partial-block}}]{{/inline}}{{#>layout}}hi{{/layout}}", d: {} },
  // the body renders in the CALLER frame: the partial's hash (title) is invisible
  // to the yielded body, so {{title}} there is empty — proves frame separation.
  { name: "p:block-yield-caller-frame", dialect: "surface", t: "{{#*inline \"layout\"}}{{title}}:{{> @partial-block}}{{/inline}}{{#>layout title=\"T\"}}{{title}}{{/layout}}", d: {} },
  // a missing block partial ⇒ the body itself is the fallback (rendered raw).
  { name: "p:block-missing-fallback", dialect: "surface", t: "{{#>missing}}fb{{/missing}}", d: {} },
  // MaxBars: the bare {{#inline}}/{{#partial}} blocks + the reserved {{yield}}
  // keyword (the cross-dialect synonym; MaxBars reserves @, so no @partial-block).
  { name: "p:max-yield", dialect: "maxbars", t: "{{#inline \"layout\"}}<{{yield}}>{{/inline}}{{#partial \"layout\"}}HI{{/partial}}", d: {} },

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
  // the loop variables, read through the `loop` object (ADR-021).
  { name: "mx:loopvars", dialect: "maxbars", t: "{{#each xs}}[{{loop.index0}}/{{loop.index1}}/{{loop.rindex0}}/{{loop.rindex1}}/{{loop.length}}]{{/each}}", d: { xs: ["a", "b", "c"] } },
  { name: "mx:loopvar-first-last", dialect: "maxbars", t: "{{#each xs}}{{#if loop.first}}<{{/if}}{{this}}{{#if loop.last}}>{{/if}}{{/each}}", d: { xs: ["a", "b"] } },
  { name: "mx:loopvar-key", dialect: "maxbars", t: "{{#each o}}{{loop.key}}={{this}};{{/each}}", d: { o: { x: 1, y: 2 } } },
  // a dotted path is still a path (not a loop var) in MaxBars.
  { name: "mx:path-still-works", dialect: "maxbars", t: "{{ user.name }}", d: { user: { name: "Ada" } } },
  // ?: (Elvis) — truthy-coalesce: the first truthy value, so an empty "" falls
  // through to name (where ?? keeps the non-null "" and || yields a boolean).
  { name: "mx:elvis-empty", dialect: "maxbars", t: "Hi {{ nickname ?: name }}", d: { nickname: "", name: "Ada" } },
  { name: "mx:elvis-present", dialect: "maxbars", t: "Hi {{ nickname ?: name }}", d: { nickname: "Ace", name: "Ada" } },
  { name: "mx:elvis-vs-coalesce", dialect: "maxbars", t: "{{ a ?: b }}|{{ a ?? b }}", d: { a: "", b: "B" } },
  { name: "mx:elvis-chain", dialect: "maxbars", t: "{{ a ?: b ?: c }}", d: { a: "", b: 0, c: "C" } },
  // cond ? a : b (ternary) — an inline conditional picking a/b by truthiness.
  { name: "mx:ternary-true", dialect: "maxbars", t: "{{ ok ? yes : no }}", d: { ok: true, yes: "Y", no: "N" } },
  { name: "mx:ternary-false", dialect: "maxbars", t: "{{ ok ? yes : no }}", d: { ok: false, yes: "Y", no: "N" } },
  // the condition is a full expression (comparison binds tighter than `?`).
  { name: "mx:ternary-cmp", dialect: "maxbars", t: "{{ n > 3 ? \"big\" : \"small\" }}", d: { n: 5 } },
  // right-associative chaining: a ? b : c ? d : e == a ? b : (c ? d : e).
  { name: "mx:ternary-chain", dialect: "maxbars", t: "{{ a ? \"A\" : b ? \"B\" : \"none\" }}", d: { a: false, b: true } },
  // empty-string condition is falsy under MaxBars' nonEmpty rule.
  { name: "mx:ternary-empty", dialect: "maxbars", t: "{{ s ? s : \"fallback\" }}", d: { s: "" } },

  // arithmetic + coalesce prelude helpers (explicit call form — the desugar
  // targets). Strictly numeric; the interpreter and the runtime must agree.
  { name: "add", dialect: "surface", t: "{{ add a b }}", d: { a: 2, b: 3 } },
  { name: "subtract", dialect: "surface", t: "{{ subtract a b }}", d: { a: 7, b: 4 } },
  { name: "multiply", dialect: "surface", t: "{{ multiply a b }}", d: { a: 6, b: 7 } },
  { name: "divide", dialect: "surface", t: "{{ divide a b }}", d: { a: 9, b: 2 } },
  { name: "modulo", dialect: "surface", t: "{{ modulo a b }}", d: { a: 17, b: 5 } },
  { name: "modulo-neg", dialect: "surface", t: "{{ modulo a b }}", d: { a: -17, b: 5 } },
  { name: "divide-zero", dialect: "surface", t: "{{ divide a b }}", d: { a: 1, b: 0 } },
  { name: "arith-nested", dialect: "surface", t: "{{ add (multiply a b) c }}", d: { a: 3, b: 4, c: 5 } },
  { name: "coalesce-first", dialect: "surface", t: "{{ coalesce a b }}", d: { a: null, b: "fallback" } },
  { name: "coalesce-zero", dialect: "surface", t: "{{ coalesce a b }}", d: { a: 0, b: "x" } },
  { name: "coalesce-chain", dialect: "surface", t: "{{ coalesce a b c }}", d: { a: null, b: null, c: "third" } },
  { name: "firsttruthy-skip-empty", dialect: "surface", t: "{{ firstTruthy a b }}", d: { a: "", b: "x" } },
  { name: "firsttruthy-chain", dialect: "surface", t: "{{ firstTruthy a b c }}", d: { a: null, b: "", c: "third" } },
  { name: "ternary-true", dialect: "surface", t: "{{ ternary c a b }}", d: { c: true, a: "A", b: "B" } },
  { name: "ternary-false", dialect: "surface", t: "{{ ternary c a b }}", d: { c: false, a: "A", b: "B" } },
  // handlebars-helpers arithmetic aliases (render identically to add/sub/mul).
  { name: "plus-alias", dialect: "surface", t: "{{ plus a b }}", d: { a: 2, b: 3 } },
  { name: "minus-alias", dialect: "surface", t: "{{ minus a b }}", d: { a: 7, b: 4 } },
  { name: "times-alias", dialect: "surface", t: "{{ times a b }}", d: { a: 4, b: 5 } },

  // value primitives — string pack (helper-packs-spec §4). Subject-first; the
  // interpreter and the JS runtime must produce byte-identical output (the
  // `slice` negative-index / `truncate` boundary semantics are pinned by this).
  { name: "str-lowercase", dialect: "surface", t: "{{ lowercase s }}", d: { s: "HeLLo" } },
  { name: "str-uppercase", dialect: "surface", t: "{{ uppercase s }}", d: { s: "HeLLo" } },
  { name: "str-uppercase-number", dialect: "surface", t: "{{ uppercase n }}", d: { n: 42 } },
  { name: "str-capitalize", dialect: "surface", t: "{{ capitalize s }}", d: { s: "hello world" } },
  { name: "str-capitalize-empty", dialect: "surface", t: "[{{ capitalize s }}]", d: { s: "" } },
  { name: "str-trim", dialect: "surface", t: "[{{ trim s }}]", d: { s: "  hi \t\n " } },
  { name: "str-trimStart", dialect: "surface", t: "[{{ trimStart s }}]", d: { s: "  hi  " } },
  { name: "str-trimEnd", dialect: "surface", t: "[{{ trimEnd s }}]", d: { s: "  hi  " } },
  { name: "str-trim-allspace", dialect: "surface", t: "[{{ trimStart s }}][{{ trimEnd s }}]", d: { s: "   " } },
  { name: "str-split", dialect: "surface", t: "{{#each (split s sep)}}<{{ this }}>{{/each}}", d: { s: "a,b,c", sep: "," } },
  { name: "str-split-empty-sep", dialect: "surface", t: "{{#each (split s sep)}}<{{ this }}>{{/each}}", d: { s: "abc", sep: "" } },
  { name: "str-replace", dialect: "surface", t: "{{ replace s find rep }}", d: { s: "a-b-c", find: "-", rep: "+" } },
  { name: "str-replace-all", dialect: "surface", t: "{{ replace s find rep }}", d: { s: "foo foo foo", find: "foo", rep: "bar" } },
  { name: "str-slice", dialect: "surface", t: "{{ slice s a b }}", d: { s: "hello", a: 1, b: 4 } },
  { name: "str-slice-open", dialect: "surface", t: "{{ slice s a }}", d: { s: "hello", a: 2 } },
  { name: "str-slice-neg-start", dialect: "surface", t: "{{ slice s a }}", d: { s: "hello", a: -3 } },
  { name: "str-slice-neg-end", dialect: "surface", t: "{{ slice s a b }}", d: { s: "hello", a: 0, b: -2 } },
  { name: "str-slice-neg-both", dialect: "surface", t: "{{ slice s a b }}", d: { s: "hello", a: -4, b: -1 } },
  { name: "str-slice-overshoot", dialect: "surface", t: "[{{ slice s a b }}]", d: { s: "hi", a: 5, b: 10 } },
  { name: "str-slice-inverted", dialect: "surface", t: "[{{ slice s a b }}]", d: { s: "hello", a: 4, b: 1 } },
  { name: "str-includes-true", dialect: "surface", t: "{{ includes s sub }}", d: { s: "hello", sub: "ell" } },
  { name: "str-includes-false", dialect: "surface", t: "{{ includes s sub }}", d: { s: "hello", sub: "xyz" } },
  { name: "str-startsWith", dialect: "surface", t: "{{ startsWith s x }}", d: { s: "hello", x: "he" } },
  { name: "str-endsWith", dialect: "surface", t: "{{ endsWith s x }}", d: { s: "hello", x: "lo" } },
  { name: "str-truncate-long", dialect: "surface", t: "{{ truncate s n }}", d: { s: "hello world", n: 5 } },
  { name: "str-truncate-short", dialect: "surface", t: "{{ truncate s n }}", d: { s: "hi", n: 5 } },
  { name: "str-truncate-boundary", dialect: "surface", t: "{{ truncate s n }}", d: { s: "hello", n: 5 } },
  { name: "str-truncate-suffix", dialect: "surface", t: "{{ truncate s n suf }}", d: { s: "hello world", n: 5, suf: "..." } },
  { name: "str-append", dialect: "surface", t: "{{ append s x }}", d: { s: "foo", x: "bar" } },
  { name: "str-prepend", dialect: "surface", t: "{{ prepend s x }}", d: { s: "foo", x: "bar" } },
  { name: "str-append-number", dialect: "surface", t: "{{ append s x }}", d: { s: "v", x: 2 } },
  { name: "str-unicode-upper", dialect: "surface", t: "{{ uppercase s }}", d: { s: "café" } },
  // case aliases (downcase/upcase) render identically to lowercase/uppercase.
  { name: "str-downcase-alias", dialect: "surface", t: "{{ downcase s }}", d: { s: "HeLLo" } },
  { name: "str-upcase-alias", dialect: "surface", t: "{{ upcase s }}", d: { s: "HeLLo" } },

  // value primitives — number pack (helper-packs-spec §4). abs/floor/ceil/round
  // are Math.* on both targets; toFixed is `n.toFixed(d)`; toInt/toFloat parse
  // (parseFloat gated by isFinite = Data.Number.fromString). Only unambiguous
  // parse inputs are tested (edge cases like "", "abc", " 3 ", "0x10" excluded —
  // see report). Negatives via subtract to avoid lexer minus.
  { name: "num-abs", dialect: "surface", t: "{{ abs n }}", d: { n: -7 } },
  { name: "num-abs-neg-expr", dialect: "surface", t: "{{ abs (subtract 0 4.5) }}", d: {} },
  { name: "num-floor", dialect: "surface", t: "{{ floor n }}", d: { n: 3.9 } },
  { name: "num-floor-neg", dialect: "surface", t: "{{ floor (subtract 0 3.1) }}", d: {} },
  { name: "num-ceil", dialect: "surface", t: "{{ ceil n }}", d: { n: 3.1 } },
  { name: "num-round-half", dialect: "surface", t: "{{ round n }}", d: { n: 2.5 } },
  { name: "num-round-down", dialect: "surface", t: "{{ round n }}", d: { n: 2.4 } },
  { name: "num-toFixed", dialect: "surface", t: "{{ toFixed n d }}", d: { n: 3.14159, d: 2 } },
  { name: "num-toFixed-round", dialect: "surface", t: "{{ toFixed n d }}", d: { n: 2.5, d: 0 } },
  { name: "num-toFixed-pad", dialect: "surface", t: "{{ toFixed n d }}", d: { n: 1, d: 3 } },
  { name: "num-toInt", dialect: "surface", t: "{{ toInt s }}", d: { s: "42" } },
  { name: "num-toInt-trunc", dialect: "surface", t: "{{ toInt s }}", d: { s: "3.9" } },
  { name: "num-toFloat", dialect: "surface", t: "{{ toFloat s }}", d: { s: "3.5" } },
  { name: "num-toFloat-neg", dialect: "surface", t: "{{ toFloat s }}", d: { s: "-1.5" } },

  // value primitives — array pack (helper-packs-spec §4, §6). The interpreter
  // and the JS runtime must produce byte-identical output. Key-based forms use a
  // dotted key string over object arrays; sortBy uses homogeneous keys.
  { name: "arr-join", dialect: "surface", t: "{{ join xs sep }}", d: { xs: ["a", "b", "c"], sep: "-" } },
  { name: "arr-join-numbers", dialect: "surface", t: "{{ join xs sep }}", d: { xs: [1, 2, 3], sep: ", " } },
  { name: "arr-count", dialect: "surface", t: "{{ count xs }}", d: { xs: ["a", "b", "c"] } },
  { name: "arr-count-object", dialect: "surface", t: "{{ count o }}", d: { o: { a: 1, b: 2 } } },
  { name: "arr-size-alias", dialect: "surface", t: "{{ size xs }}", d: { xs: ["a", "b"] } },
  { name: "arr-at", dialect: "surface", t: "{{ at xs i }}", d: { xs: ["a", "b", "c"], i: 1 } },
  { name: "arr-at-neg", dialect: "surface", t: "{{ at xs i }}", d: { xs: ["a", "b", "c"], i: -1 } },
  { name: "arr-at-oob", dialect: "surface", t: "[{{ at xs i }}]", d: { xs: ["a"], i: 5 } },
  { name: "arr-take", dialect: "surface", t: "{{ join (take xs n) sep }}", d: { xs: ["a", "b", "c", "d"], n: 2, sep: "," } },
  { name: "arr-take-clamp", dialect: "surface", t: "{{ join (take xs n) sep }}", d: { xs: ["a", "b"], n: 9, sep: "," } },
  { name: "arr-takeRight", dialect: "surface", t: "{{ join (takeRight xs n) sep }}", d: { xs: ["a", "b", "c", "d"], n: 2, sep: "," } },
  { name: "arr-takeRight-clamp", dialect: "surface", t: "{{ join (takeRight xs n) sep }}", d: { xs: ["a", "b"], n: 9, sep: "," } },
  { name: "arr-take-zero", dialect: "surface", t: "[{{ join (take xs n) sep }}]", d: { xs: ["a", "b"], n: 0, sep: "," } },
  { name: "arr-reverse", dialect: "surface", t: "{{ join (reverse xs) sep }}", d: { xs: ["a", "b", "c"], sep: "," } },
  { name: "arr-reverse-string", dialect: "surface", t: "{{ reverse s }}", d: { s: "abc" } },
  { name: "arr-unique", dialect: "surface", t: "{{ join (unique xs) sep }}", d: { xs: ["a", "b", "a", "c", "b"], sep: "," } },
  { name: "arr-includes-true", dialect: "surface", t: "{{ includes xs v }}", d: { xs: ["a", "b", "c"], v: "b" } },
  { name: "arr-includes-false", dialect: "surface", t: "{{ includes xs v }}", d: { xs: ["a", "b"], v: "z" } },
  { name: "arr-includes-number", dialect: "surface", t: "{{ includes xs v }}", d: { xs: [1, 2, 3], v: 2 } },
  { name: "arr-sortBy-num", dialect: "surface", t: "{{#each (sortBy xs \"age\")}}{{ name }}:{{ age }};{{/each}}", d: { xs: [{ name: "c", age: 3 }, { name: "a", age: 1 }, { name: "b", age: 2 }] } },
  { name: "arr-sortBy-str", dialect: "surface", t: "{{#each (sortBy xs \"name\")}}{{ name }};{{/each}}", d: { xs: [{ name: "charlie" }, { name: "alice" }, { name: "bob" }] } },
  { name: "arr-sortBy-dotted", dialect: "surface", t: "{{#each (sortBy xs \"u.age\")}}{{ u.age }};{{/each}}", d: { xs: [{ u: { age: 30 } }, { u: { age: 10 } }, { u: { age: 20 } }] } },
  { name: "arr-sortBy-stable", dialect: "surface", t: "{{#each (sortBy xs \"k\")}}{{ id }};{{/each}}", d: { xs: [{ k: 1, id: "a" }, { k: 1, id: "b" }, { k: 1, id: "c" }] } },
  { name: "arr-pluck", dialect: "surface", t: "{{ join (pluck xs \"id\") sep }}", d: { xs: [{ id: 1 }, { id: 2 }, { id: 3 }], sep: "," } },
  { name: "arr-pluck-dotted", dialect: "surface", t: "{{ join (pluck xs \"u.name\") sep }}", d: { xs: [{ u: { name: "a" } }, { u: { name: "b" } }], sep: "," } },
  { name: "arr-groupBy", dialect: "surface", t: "{{#each (groupBy xs \"type\")}}{{ @key }}=[{{#each this}}{{ id }}{{/each}}];{{/each}}", d: { xs: [{ type: "x", id: "1" }, { type: "y", id: "2" }, { type: "x", id: "3" }] } },

  // MaxBars infix arithmetic + `??` operators (desugar to the prelude helpers;
  // the compiled path and the interpreter must agree).
  { name: "mx:add", dialect: "maxbars", t: "{{ a + b }}", d: { a: 2, b: 3 } },
  { name: "mx:subtract", dialect: "maxbars", t: "{{ a - b }}", d: { a: 7, b: 4 } },
  { name: "mx:multiply", dialect: "maxbars", t: "{{ a * b }}", d: { a: 6, b: 7 } },
  { name: "mx:divide", dialect: "maxbars", t: "{{ a / b }}", d: { a: 9, b: 2 } },
  { name: "mx:modulo", dialect: "maxbars", t: "{{ a % b }}", d: { a: 17, b: 5 } },
  { name: "mx:arith-precedence", dialect: "maxbars", t: "{{ a + b * c }}", d: { a: 2, b: 3, c: 4 } },
  { name: "mx:arith-parens", dialect: "maxbars", t: "{{ (a + b) * c }}", d: { a: 2, b: 3, c: 4 } },
  { name: "mx:arith-cmp", dialect: "maxbars", t: "{{#if n + 1 > 5}}big{{else}}small{{/if}}", d: { n: 5 } },
  { name: "mx:arith-path", dialect: "maxbars", t: "{{ price.net * qty }}", d: { price: { net: 10 }, qty: 3 } },
  { name: "mx:coalesce-null", dialect: "maxbars", t: "{{ a ?? b }}", d: { a: null, b: "fb" } },
  { name: "mx:coalesce-zero", dialect: "maxbars", t: "{{ a ?? b }}", d: { a: 0, b: "fb" } },
  { name: "mx:coalesce-chain", dialect: "maxbars", t: '{{ a ?? b ?? "x" }}', d: { a: null, b: null } },

  // `elif` honours an `includeZero=true` options hash (like the head `if`): a
  // bare 0 in the elif is truthy only with the flag. Compiled ≡ interpreter.
  { name: "mx:elif-includeZero-pass", dialect: "maxbars", t: "{{#if score >= 100}}P{{elif 0 includeZero=true}}F{{/if}}", d: { score: 150 } },
  { name: "mx:elif-includeZero-fire", dialect: "maxbars", t: "{{#if score >= 100}}P{{elif 0 includeZero=true}}F{{/if}}", d: { score: 50 } },
  { name: "mx:elif-no-includeZero", dialect: "maxbars", t: "{{#if score >= 100}}P{{elif n}}Z{{else}}E{{/if}}", d: { score: 50, n: 0 } },
  { name: "mx:elif-includeZero-else", dialect: "maxbars", t: "{{#if a}}A{{elif n includeZero=true}}Z{{else}}E{{/if}}", d: { a: false, n: 0 } },
  // surface (FullBars) elif + includeZero hash.
  { name: "s:elif-includeZero", dialect: "surface", t: "{{#if a}}A{{elif n includeZero=true}}Z{{else}}E{{/if}}", d: { a: false, n: 0 } },
  // the `{{else if …}}` spelling carries a trailing hash through to `elif`, so it
  // behaves identically to the `{{elif …}}` form above (both targets).
  { name: "s:else-if-includeZero", dialect: "surface", t: "{{#if a}}A{{else if n includeZero=true}}Z{{else}}E{{/if}}", d: { a: false, n: 0 } },
  { name: "mx:else-if-includeZero", dialect: "maxbars", t: "{{#if a}}A{{else if n includeZero=true}}Z{{else}}E{{/if}}", d: { a: false, n: 0 } },
  // block params parse in MaxBars (head ladder omits the pipe rung) — built-ins
  // bind them exactly as FullBars does, compiled ≡ interpreted.
  { name: "mx:blockparams-each", dialect: "maxbars", t: "{{#each xs as |item i|}}[{{i}}:{{item}}]{{/each}}", d: { xs: ["a", "b", "c"] } },
  { name: "mx:blockparams-with", dialect: "maxbars", t: "{{#with o as |c|}}{{c.n}}{{/with}}", d: { o: { n: "Z" } } },
  // a parenthesised pipe coexists with a trailing block-param clause.
  { name: "mx:blockparams-paren-pipe", dialect: "maxbars", t: "{{#each (xs | reverse) as |x|}}{{x}}{{/each}}", d: { xs: ["a", "b", "c"] } },
  // an OUTER block param stays visible inside a nested loop (frame binds inherit).
  { name: "mx:blockparams-nested-outer", dialect: "maxbars", t: "{{#each rows as |row|}}{{#each row}}[{{row}}={{this}}]{{/each}}{{/each}}", d: { rows: [["a", "b"], ["c"]] } },
  // ── labelled loops (ADR-013): the label binds the frame reified as an object ──
  { name: "mx:label-outer-array", dialect: "maxbars", t: "{{#each rows as |row| label outer}}{{#each row}}{{outer.index1}}/{{outer.length}}:{{this}}{{#if outer.first}}*{{/if}} {{/each}}{{/each}}", d: { rows: [["a", "b"], ["c"]] } },
  { name: "mx:label-single", dialect: "maxbars", t: "{{#each xs label l}}{{l.index0}}:{{this}}/{{l.last}} {{/each}}", d: { xs: ["a", "b", "c"] } },
  { name: "mx:label-object-key", dialect: "maxbars", t: "{{#each rows as |r| label outer}}{{#each r}}[{{r}}@{{outer.key}}]{{/each}}{{/each}}", d: { rows: { A: ["x"], B: ["y", "z"] } } },
  // ── ADR-021 reserved variable model: loop / root / parent (chainable) ─────────
  { name: "mx:loop-fields", dialect: "maxbars", t: "{{#each xs}}{{loop.index1}}/{{loop.length}}{{#if loop.first}}<{{/if}}{{#if loop.last}}>{{/if}} {{/each}}", d: { xs: ["a", "b", "c"] } },
  { name: "mx:loop-parent", dialect: "maxbars", t: "{{#each rows}}{{#each this}}[{{loop.index0}}@{{loop.parent.index0}}/{{loop.root.length}}]{{/each}}{{/each}}", d: { rows: [["a", "b"], ["c"]] } },
  { name: "mx:root", dialect: "maxbars", t: "{{#each xs}}{{root.title}}:{{this}} {{/each}}", d: { title: "T", xs: ["a", "b"] } },
  { name: "mx:parent-chain", dialect: "maxbars", t: "{{#each rows}}{{#each cells}}[{{parent.tag}}|{{parent.parent.title}}|{{parent.root.title}}]{{/each}}{{/each}}", d: { title: "R", rows: [{ tag: "A", cells: ["x", "y"] }, { tag: "B", cells: ["z"] }] } },

  // canonical escapers escapeHtml/escapeJson (compiled ≡ interpreter).
  { name: "escapeHtml-canonical", t: "{{{escapeHtml (lookup this \"x\")}}}", d: { x: "<b>&\"'" } },
  { name: "escapeJson-canonical", t: "{{{escapeJson (lookup this \"o\")}}}", d: { o: { a: 1 } } },

  // ── MinBars (Mustache) — ADR-016 compile slice 1 ────────────────────────────
  // Interpolation: escaped `{{x}}`, raw `{{{x}}}` / `{{&x}}`, dotted names,
  // implicit iterator `{{.}}`, missing → "". The compiled `rt.mlookup`/`rt.esc`
  // must match the interpreter's context-stack resolve + escape byte for byte.
  { name: "mn:interp-escaped", dialect: "minbars", t: "Hi {{html}}!", d: { html: "<b>&\"'" } },
  { name: "mn:interp-raw-triple", dialect: "minbars", t: "{{{html}}}", d: { html: "<b>&\"'" } },
  { name: "mn:interp-raw-amp", dialect: "minbars", t: "{{&html}}", d: { html: "<b>&" } },
  { name: "mn:dotted", dialect: "minbars", t: "{{name.first}} {{name.last}}", d: { name: { first: "Ada", last: "L" } } },
  { name: "mn:implicit", dialect: "minbars", t: "{{#tags}}[{{.}}]{{/tags}}", d: { tags: ["a", "b", "c"] } },
  { name: "mn:missing", dialect: "minbars", t: "[{{nope}}]", d: { name: "Ada" } },
  { name: "mn:parent-fallback", dialect: "minbars", t: "{{#user}}{{org}}:{{name}}{{/user}}", d: { org: "X", user: { name: "Ada" } } },
  // Sections: array iterate (each element pushed), truthy non-list once, falsy
  // skipped, object opens a scope.
  { name: "mn:section-array", dialect: "minbars", t: "<ul>{{#items}}<li>{{name}}({{qty}})</li>{{/items}}</ul>", d: { items: [{ name: "pen", qty: 3 }, { name: "ink", qty: 1 }] } },
  { name: "mn:section-bool-true", dialect: "minbars", t: "{{#active}}on{{/active}}", d: { active: true } },
  { name: "mn:section-bool-false", dialect: "minbars", t: "{{#active}}on{{/active}}", d: { active: false } },
  { name: "mn:section-object", dialect: "minbars", t: "{{#user}}{{name}} <{{email}}>{{/user}}", d: { user: { name: "Ada", email: "a@x" } } },
  // Inverted sections: render iff falsy under the mustache mode.
  { name: "mn:inverted-empty", dialect: "minbars", t: "{{#items}}<li>{{.}}</li>{{/items}}{{^items}}none{{/items}}", d: { items: [] } },
  { name: "mn:inverted-truthy", dialect: "minbars", t: "{{^items}}none{{/items}}", d: { items: ["x"] } },
  // The truthiness gotcha: in Mustache 0 and "" are TRUTHY (only false/null/[]
  // are falsy), so the section renders — the compiled `$falsy` is the mustache set.
  { name: "mn:truthy-zero", dialect: "minbars", t: "{{#count}}in stock: {{count}}{{/count}}{{^count}}sold out{{/count}}", d: { count: 0 } },
  { name: "mn:truthy-empty-string", dialect: "minbars", t: "{{#note}}has{{/note}}{{^note}}none{{/note}}", d: { note: "" } },

  // ── MinBars partials — ADR-016 compile slice 2 (inlined `{{> p}}`) ───────────
  // A partial inherits the caller's context (the partial body resolves against
  // the same stack), and is reused per row of a section.
  { name: "mn:partial-basic", dialect: "minbars", t: "{{> greeting}} & {{> greeting}}", d: { name: "Ada" }, partials: { greeting: "Hi {{name}}!" } },
  { name: "mn:partial-row", dialect: "minbars", t: "{{#people}}{{> row}}\n{{/people}}", d: { people: [{ name: "Ada", role: "author" }, { name: "Lin", role: "guest" }] }, partials: { row: "- {{name}} ({{role}})" } },
  // a missing partial renders "" (never an error), like the interpreter.
  { name: "mn:partial-missing", dialect: "minbars", t: "[{{> nope}}]", d: {}, partials: {} },
  // nested partials (a partial that includes another) inline transitively.
  { name: "mn:partial-nested", dialect: "minbars", t: "{{> outer}}", d: { name: "Ada" }, partials: { outer: "<{{> inner}}>", inner: "{{name}}" } },
  // standalone-indentation (mustache/spec): a lone `{{>p}}` on an indented line
  // re-indents the partial's STATIC lines, but NOT a newline produced by an
  // interpolated value — the byte-exactness proof that the compiled path applies
  // `indentTemplate` at the template level, not to the rendered string.
  { name: "mn:partial-standalone-indent", dialect: "minbars", t: "\\\n {{>part}}\n/\n", d: { content: "<\n->" }, partials: { part: "|\n{{{content}}}\n|\n" } },

  // ── MinBars inheritance — ADR-016 compile slice 3 (inlined {{<p}} / {{$b}}) ──
  // All from the mustache/spec ~inheritance module; the compiler resolves the
  // (static) block-override stack at compile time, matching the interpreter.
  { name: "inh:default", dialect: "minbars", t: "{{$title}}Default title{{/title}}\n", d: {} },
  { name: "inh:overridden-content", dialect: "minbars", t: "{{<super}}{{$title}}sub template title{{/title}}{{/super}}", d: {}, partials: { super: "...{{$title}}Default title{{/title}}..." } },
  // a data key of the same name never overrides a block.
  { name: "inh:data-does-not-override", dialect: "minbars", t: "{{<include}}{{$var}}var in template{{/var}}{{/include}}", d: { var: "var in data" }, partials: { include: "{{$var}}var in include{{/var}}" } },
  // multi-level chain (sub → parent → older → grandParent), outer-wins.
  { name: "inh:multi-level", dialect: "minbars", t: "{{<parent}}{{$a}}c{{/a}}{{/parent}}", d: {}, partials: { parent: "{{<older}}{{$a}}p{{/a}}{{/older}}", older: "{{<grandParent}}{{$a}}o{{/a}}{{/grandParent}}", grandParent: "{{$a}}g{{/a}}" } },
  // override-broken recursion (parent → parent2 → parent, terminates).
  { name: "inh:recursion", dialect: "minbars", t: "{{<parent}}{{$foo}}override{{/foo}}{{/parent}}", d: {}, partials: { parent: "{{$foo}}default content{{/foo}} {{$bar}}{{<parent2}}{{/parent2}}{{/bar}}", parent2: "{{$foo}}parent2 default content{{/foo}} {{<parent}}{{$bar}}don't recurse{{/bar}}{{/parent}}" } },
  // §4.6.2 reindentation: standalone parent / standalone block / explicit block
  // reindent / intrinsic (column-0 block uses the default's intrinsic indent) /
  // nested block reindentation.
  { name: "inh:standalone-parent", dialect: "minbars", t: "Hi,\n  {{<parent}}{{/parent}}\n", d: {}, partials: { parent: "one\ntwo\n" } },
  { name: "inh:standalone-block", dialect: "minbars", t: "{{<parent}}{{$block}}\none\ntwo{{/block}}\n{{/parent}}\n", d: {}, partials: { parent: "Hi,\n  {{$block}}{{/block}}\n" } },
  { name: "inh:block-reindentation", dialect: "minbars", t: "{{<parent}}{{$block}}\n    one\n    two\n{{/block}}{{/parent}}\n", d: {}, partials: { parent: "Hi,\n  {{$block}}\n  {{/block}}\n" } },
  { name: "inh:intrinsic-indentation", dialect: "minbars", t: "{{<parent}}{{$block}}\none\ntwo\n{{/block}}{{/parent}}\n", d: {}, partials: { parent: "Hi,\n{{$block}}\n  default\n{{/block}}\n" } },
  { name: "inh:nested-block-reindentation", dialect: "minbars", t: "{{<parent}}{{$nested}}\nthree\n{{/nested}}{{/parent}}\n", d: {}, partials: { parent: "{{<grandparent}}{{$block}}\n  one\n  {{$nested}}\n    two\n  {{/nested}}\n{{/block}}{{/grandparent}}\n", grandparent: "{{$block}}default{{/block}}" } },

  // ── blockHelperMissing — FullBars' Handlebars-style implicit sections ─────────
  // A `{{#x}}` whose head names no helper is treated as data (array ⇒ each,
  // truthy ⇒ with-once, falsy/empty ⇒ {{else}}), matching Handlebars. The gate
  // pins that the interpreter (lenient `resolve`) and the compiled `rt.block`
  // fallback render this identically. (See fullbars-compat.adoc §4.)
  { name: "bhm:array-iterates", dialect: "surface", t: "{{#tags}}[{{.}}] {{/tags}}", d: { tags: ["math", "logic", "engines"] } },
  { name: "bhm:truthy-once", dialect: "surface", t: "{{#person}}{{name}}{{/person}}", d: { person: { name: "Ada" } } },
  { name: "bhm:falsy-empty", dialect: "surface", t: "[{{#person}}{{name}}{{/person}}]", d: { person: false } },
  { name: "bhm:empty-array-else", dialect: "surface", t: "{{#tags}}{{.}}{{else}}none{{/tags}}", d: { tags: [] } },
  { name: "bhm:nested-section", dialect: "surface", t: "{{#user}}{{name}}: {{#roles}}{{.}} {{/roles}}{{/user}}", d: { user: { name: "Ada", roles: ["admin", "dev"] } } },

  // ── value-helper shadow — a bare `{{#count}}` is a section, not a helper call ──
  // A prelude *value* helper (`count`, `uppercase`, …) used as a bare block has no
  // argument to apply, so the lenient dialects read the head as DATA — the same
  // Handlebars section path as blockHelperMissing — instead of raising the helper's
  // arity error (`Kernel.Prelude.valueOrSection`; the runtime's `channel.section`).
  // With an argument it stays a real helper call (body ignored), and the field
  // falls back through truthiness (0 ⇒ {{else}}) exactly like blockHelperMissing.
  { name: "vsh:count-with-once", dialect: "surface", t: "{{#count}}{{.}} unread{{/count}}", d: { count: 5 } },
  { name: "vsh:count-array-iterates", dialect: "surface", t: "{{#count}}[{{.}}]{{/count}}", d: { count: ["a", "b"] } },
  { name: "vsh:count-zero-else", dialect: "surface", t: "{{#count}}some{{else}}none{{/count}}", d: { count: 0 } },
  { name: "vsh:count-inline-helper", dialect: "surface", t: "{{count items}}", d: { items: ["a", "b", "c"] } },
  { name: "vsh:count-block-with-arg", dialect: "surface", t: "{{#count items}}body{{/count}}", d: { items: ["a", "b"] } },
  { name: "vsh:uppercase-section", dialect: "surface", t: "{{#uppercase}}{{.}}{{/uppercase}}", d: { uppercase: "hi" } },
  // An EMPTY-body block sections too (Handlebars renders it as an empty section,
  // not an arity error): empty args ⟹ block position, since a bare inline
  // `{{count}}` desugars to a data path and never resolves the helper.
  { name: "vsh:count-empty-body", dialect: "surface", t: "[{{#count}}{{/count}}]", d: { count: 5 } },
  { name: "vsh:count-empty-body-zero", dialect: "surface", t: "[{{#count}}{{/count}}]", d: { count: 0 } },

  // ── MinBars mustache.js-compat truthiness (ADR-022, the renderMinbarsCompat /
  // compileMinbarsCompat pair) ────────────────────────────────────────────────
  // mustache.js skips a section on `!value`, so 0 and "" are FALSY (unlike the
  // language-agnostic spec rule, where they are truthy). These gate that the
  // compat render and the compat compile agree byte-for-byte on exactly that flip
  // (section + inverted together); {} stays truthy and [] falsy in both rules.
  { name: "mjs:zero-falsy", dialect: "minbars-compat", t: "{{#n}}has{{/n}}{{^n}}none{{/n}}", d: { n: 0 } },
  { name: "mjs:empty-string-falsy", dialect: "minbars-compat", t: "{{#s}}has{{/s}}{{^s}}none{{/s}}", d: { s: "" } },
  { name: "mjs:nonzero-truthy", dialect: "minbars-compat", t: "{{#n}}has{{/n}}{{^n}}none{{/n}}", d: { n: 5 } },
  { name: "mjs:empty-object-truthy", dialect: "minbars-compat", t: "{{#o}}has{{/o}}{{^o}}none{{/o}}", d: { o: {} } },
  { name: "mjs:empty-array-falsy", dialect: "minbars-compat", t: "{{#xs}}x{{/xs}}{{^xs}}none{{/xs}}", d: { xs: [] } },

  // ── i18n fallback (ADR-029) ──────────────────────────────────────────────────
  // The blessed i18n ops with NO host translator seeded: the interpreter prelude
  // and the compiled runtime must both fall back to the argument's plain text.
  // This gates ADR-029's compile ≡ interpret constraint for the unwired path (the
  // permanent invariant); the wired-translator path is gated by check:i18n.
  { name: "i18n-t-fallback", dialect: "surface", t: "{{ t \"greeting\" }}", d: {} },
  { name: "i18n-number-fallback", dialect: "surface", t: "{{ number n }}", d: { n: 1234 } },
  { name: "i18n-date-fallback", dialect: "surface", t: "{{ date d }}", d: { d: "2020-01-02" } },

  // ── i18n WIRED (ADR-029) ─────────────────────────────────────────────────────
  // With a host translator seeded on BOTH paths (interpreter via renderSurfaceI18n,
  // compiled via rt.registerTranslator), the i18n ops return its text identically —
  // gating the compile ≡ interpret invariant for the wired seam path (#1 complete).
  { name: "i18n-t-wired", dialect: "surface", t: "{{ t \"hi\" }}", d: {},
    translator: (name, args) => (name === "t" && args[0] === "hi" ? "salut" : undefined), expect: "salut" },
  { name: "i18n-number-wired", dialect: "surface", t: "{{ number n }}", d: { n: 1234.5 },
    translator: (name) => (name === "number" ? "1,234.5" : undefined), expect: "1,234.5" },
];
