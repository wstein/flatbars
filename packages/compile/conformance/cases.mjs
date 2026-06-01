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
  { name: "each-array-key-null", t: "{{#each (lookup this \"xs\")}}[{{{key}}}]{{/each}}", d: { xs: ["a", "b"] } },
  { name: "each-object-sorted", t: "{{#each (lookup this \"o\")}}{{{key}}}={{{this}}};{{/each}}", d: { o: { b: 2, a: 1, c: 3 } } },
  { name: "each-object-index", t: "{{#each (lookup this \"o\")}}{{{index}}}:{{{key}}};{{/each}}", d: { o: { z: 1, a: 2 } } },
  { name: "each-parent-index", t: "{{#each (lookup this \"rows\")}}{{#each this}}[{{{parent-index}}}-{{{index}}}]{{/each}}{{/each}}", d: { rows: [["a", "b"], ["c"]] } },

  // ── apply (dynamic block dispatch; compiled via rt.block) ────────────────────
  { name: "apply-each", t: "{{#apply \"each\" (lookup this \"xs\")}}[{{{this}}}]{{/apply}}", d: { xs: ["a", "b"] } },
  { name: "apply-each-else", t: "{{#apply \"each\" (lookup this \"xs\")}}x{{else}}none{{/apply}}", d: { xs: [] } },
  { name: "apply-if-true", t: "{{#apply \"if\" (lookup this \"c\")}}Y{{else}}N{{/apply}}", d: { c: true } },
  { name: "apply-if-false", t: "{{#apply \"if\" (lookup this \"c\")}}Y{{else}}N{{/apply}}", d: { c: false } },
  { name: "apply-unless", t: "{{#apply \"unless\" (lookup this \"c\")}}N{{/apply}}", d: { c: false } },
  { name: "apply-with", t: "{{#apply \"with\" (lookup this \"o\")}}{{{lookup this \"k\"}}}{{/apply}}", d: { o: { k: "v" } } },
  { name: "apply-inline-helper", t: "{{#apply \"esc_html\" (lookup this \"x\")}}ignored{{/apply}}", d: { x: "<b>" } },

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
];
